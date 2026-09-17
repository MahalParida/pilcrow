import type {
  RpcCall,
  RpcEvent,
  RpcInbound,
  RpcMethod,
  RpcOutbound,
  RpcReply,
  RpcRequests,
} from './types';
import { ENSURE_BACKEND, PORT_NAME } from './constants';
import { uid } from './text';

/** Chrome's messaging errors are opaque; say what the user can actually do. */
export function friendlyError(detail: string): string {
  if (/context invalidated/i.test(detail)) {
    return 'Pilcrow was updated or reloaded. Refresh this page to reconnect.';
  }
  if (/Receiving end does not exist|Could not establish connection/i.test(detail)) {
    return 'The Pilcrow engine is not running yet. If this persists, reload the extension from chrome://extensions.';
  }
  return detail;
}

const isFatal = (detail: string) => /context invalidated/i.test(detail);

type Pending = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  cleanup: () => void;
};

/**
 * Typed request/response over a long-lived `chrome.runtime` port.
 *
 * A port is used rather than one-shot `sendMessage` for two reasons: it lets a
 * caller cancel an in-flight model request, and an open port keeps the service
 * worker from being shut down mid-inference.
 */
export class RpcClient {
  private port: chrome.runtime.Port | null = null;
  private readonly pending = new Map<string, Pending>();
  private readonly eventListeners = new Set<(event: RpcEvent) => void>();
  private ready: Promise<void> | null = null;
  private disposed = false;
  /** Set when the extension context is gone; retrying can never succeed. */
  private dead = false;

  /**
   * The engine lives in an offscreen document, which only the service worker
   * can create. Ask it to do so before opening the port, otherwise the first
   * call would arrive with nobody listening.
   */
  private ensureBackend(): Promise<void> {
    if (!this.ready) {
      const pending = (async () => {
        // The worker may be asleep on the first attempt; one retry covers the
        // wake-up window without masking a genuine failure.
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            const response = (await chrome.runtime.sendMessage({ type: ENSURE_BACKEND })) as
              | { ok: boolean; error?: string }
              | undefined;
            if (response?.ok) return;
            throw new Error(response?.error ?? 'Could not start the Pilcrow engine.');
          } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            if (isFatal(detail)) {
              this.dead = true;
              throw new Error(friendlyError(detail));
            }
            if (attempt === 1) throw new Error(friendlyError(detail));
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
        }
      })();
      this.ready = pending;
      pending.catch(() => {
        // Let the next call try again rather than caching the failure.
        if (this.ready === pending) this.ready = null;
      });
    }
    return this.ready;
  }

  connect(): chrome.runtime.Port {
    if (this.port) return this.port;
    const port = chrome.runtime.connect({ name: PORT_NAME });
    port.onMessage.addListener((message: RpcOutbound) => this.handle(message));
    port.onDisconnect.addListener(() => {
      this.port = null;
      // The offscreen document may have been torn down with the worker.
      this.ready = null;
      const error = new Error(
        friendlyError(chrome.runtime.lastError?.message ?? 'Background worker disconnected'),
      );
      for (const [, pending] of this.pending) pending.reject(error);
      this.pending.clear();
    });
    this.port = port;
    return port;
  }

  private handle(message: RpcOutbound): void {
    if (message.kind === 'event') {
      for (const listener of this.eventListeners) listener(message);
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    pending.cleanup();
    if (message.ok) pending.resolve(message.result);
    else pending.reject(new Error(message.error));
  }

  async call<M extends RpcMethod>(
    method: M,
    params: RpcRequests[M]['params'],
    signal?: AbortSignal,
  ): Promise<RpcRequests[M]['result']> {
    if (this.disposed) throw new Error('RPC client disposed');
    if (this.dead) throw new Error(friendlyError('context invalidated'));
    await this.ensureBackend();
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const id = uid('r');
    const call: RpcCall<M> = { kind: 'call', id, method, params };

    return new Promise<RpcRequests[M]['result']>((resolve, reject) => {
      const onAbort = () => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        pending.cleanup();
        this.post({ kind: 'cancel', id });
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        cleanup: () => signal?.removeEventListener('abort', onAbort),
      });

      try {
        this.post(call);
      } catch (error) {
        this.pending.delete(id);
        signal?.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private post(message: RpcInbound): void {
    try {
      this.connect().postMessage(message);
    } catch {
      // The service worker was shut down between calls; reconnect and retry.
      this.port = null;
      this.connect().postMessage(message);
    }
  }

  onEvent(listener: (event: RpcEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  /**
   * Drops the port without retiring the client. Used when the page is about to
   * be frozen into the back/forward cache: an open port there is closed by
   * Chrome anyway, and holding one can keep the page out of the cache
   * entirely. The next call reconnects on its own.
   */
  release(): void {
    this.ready = null;
    this.port?.disconnect();
    this.port = null;
    for (const [, pending] of this.pending) {
      pending.cleanup();
      pending.reject(new Error('The page was suspended; run this again.'));
    }
    this.pending.clear();
  }

  dispose(): void {
    this.disposed = true;
    this.ready = null;
    this.port?.disconnect();
    this.port = null;
    // Settle rather than drop: a cleared map leaves every awaiting caller
    // hanging forever.
    for (const [, pending] of this.pending) {
      pending.cleanup();
      pending.reject(new Error('RPC client disposed'));
    }
    this.pending.clear();
  }
}

export type RpcHandlers = {
  [M in RpcMethod]: (
    params: RpcRequests[M]['params'],
    context: { signal: AbortSignal; port: chrome.runtime.Port },
  ) => Promise<RpcRequests[M]['result']>;
};

/** Registers the service-worker side of the channel. */
export function serveRpc(handlers: RpcHandlers): void {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== PORT_NAME) return;
    const inFlight = new Map<string, AbortController>();

    port.onMessage.addListener((message: RpcInbound) => {
      if (message.kind === 'cancel') {
        inFlight.get(message.id)?.abort();
        inFlight.delete(message.id);
        return;
      }

      const controller = new AbortController();
      inFlight.set(message.id, controller);

      const handler = handlers[message.method] as (
        params: unknown,
        context: { signal: AbortSignal; port: chrome.runtime.Port },
      ) => Promise<unknown>;

      void handler(message.params, { signal: controller.signal, port })
        .then((result) => {
          send(port, { kind: 'reply', id: message.id, ok: true, result } as RpcReply);
        })
        .catch((error: unknown) => {
          const detail = error instanceof Error ? error.message : String(error);
          send(port, { kind: 'reply', id: message.id, ok: false, error: detail });
        })
        .finally(() => inFlight.delete(message.id));
    });

    port.onDisconnect.addListener(() => {
      // Reading lastError is what marks it handled. A disconnect carries one
      // whenever the other end did not close the port itself — most often a
      // page moving into the back/forward cache, which closes the channel from
      // under us. Leaving it unread makes Chrome log "Unchecked
      // runtime.lastError" against this context, which is the offscreen
      // document. There is nothing to do about it beyond stopping the work.
      void chrome.runtime.lastError;
      for (const [, controller] of inFlight) controller.abort();
      inFlight.clear();
    });
  });
}

function send(port: chrome.runtime.Port, message: RpcOutbound): void {
  try {
    port.postMessage(message);
  } catch {
    // The other end went away mid-flight; nothing useful to do.
  }
}
