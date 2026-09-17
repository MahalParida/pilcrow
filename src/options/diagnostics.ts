import type { RpcClient } from '@/shared/rpc';
import type { Settings } from '@/shared/types';
import { PRODUCT } from '@/shared/constants';
import { describeCapability } from '@/engine/availability';

/**
 * End-to-end self-test.
 *
 * Pilcrow spans four contexts — page, content script, service worker and
 * offscreen document — and each has a different slice of the platform. A
 * failure in one usually surfaces as a confusing symptom in another, so this
 * exercises the whole path and reports where it actually broke.
 */

export interface Check {
  name: string;
  status: 'ok' | 'warn' | 'fail';
  detail: string;
  ms?: number;
}

const AI_GLOBALS = [
  'LanguageModel',
  'Proofreader',
  'Rewriter',
  'Writer',
  'Summarizer',
  'Translator',
  'LanguageDetector',
] as const;

const SAMPLE = 'I has two apple and she dont like it, their going too the store tomorow.';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function timed<T>(work: () => Promise<T>): Promise<{ value?: T; error?: unknown; ms: number }> {
  const started = performance.now();
  try {
    const value = await work();
    return { value, ms: Math.round(performance.now() - started) };
  } catch (error) {
    return { error, ms: Math.round(performance.now() - started) };
  }
}

function chromeVersion(): string {
  const match = navigator.userAgent.match(/Chrome\/(\d+\.\d+\.\d+\.\d+)/);
  return match?.[1] ?? 'unknown';
}

export async function runDiagnostics(rpc: RpcClient, settings: Settings): Promise<Check[]> {
  const checks: Check[] = [];

  /* -- Environment -------------------------------------------------------- */

  const major = Number.parseInt(chromeVersion(), 10);
  checks.push({
    name: 'Chrome version',
    status: Number.isFinite(major) && major >= 138 ? 'ok' : 'fail',
    detail: `${chromeVersion()} — ${PRODUCT} needs 138 or newer on desktop`,
  });

  checks.push({
    name: 'Custom Highlight API',
    status: 'highlights' in CSS ? 'ok' : 'fail',
    detail:
      'highlights' in CSS
        ? 'available — contenteditable fields can be underlined'
        : 'missing — underlines in rich editors will not render',
  });

  /* -- What this page can see (a normal Window) --------------------------- */

  const localGlobals = AI_GLOBALS.filter((name) => name in globalThis);
  checks.push({
    name: 'AI globals in this page',
    status: localGlobals.includes('LanguageModel') ? 'ok' : 'fail',
    detail:
      localGlobals.length > 0
        ? localGlobals.join(', ')
        : 'none — Chrome exposes no built-in AI APIs to this profile',
  });

  /* -- The engine host ---------------------------------------------------- */

  const capabilities = await timed(() => rpc.call('capabilities', undefined));
  if (capabilities.error) {
    checks.push({
      name: 'Engine host (offscreen document)',
      status: 'fail',
      detail: errorText(capabilities.error),
      ms: capabilities.ms,
    });
    // Nothing downstream can work; report what we have.
    return checks;
  }

  const report = capabilities.value!;
  checks.push({
    name: 'Engine host (offscreen document)',
    status: 'ok',
    detail: 'reachable and answering',
    ms: capabilities.ms,
  });

  checks.push({
    name: 'Prompt API in engine host',
    status: report.usable ? 'ok' : 'fail',
    detail: describeCapability(report.languageModel),
  });

  for (const [key, label] of [
    ['translator', 'Translator'],
    ['summarizer', 'Summarizer'],
    ['languageDetector', 'Language detector'],
    ['proofreader', 'Proofreader'],
    ['rewriter', 'Rewriter'],
    ['writer', 'Writer'],
  ] as const) {
    const state = report[key];
    checks.push({
      name: `${label} in engine host`,
      status: state === 'available' || state === 'readily' ? 'ok' : 'warn',
      detail: describeCapability(state),
    });
  }

  /* -- End-to-end model calls --------------------------------------------- */

  const analysis = await timed(() =>
    rpc.call('analyze', { text: SAMPLE, settings, dictionary: [] }),
  );
  if (analysis.error) {
    checks.push({
      name: 'End-to-end check',
      status: 'fail',
      detail: errorText(analysis.error),
      ms: analysis.ms,
    });
  } else {
    const result = analysis.value!;
    const found = result.suggestions.length;
    checks.push({
      name: 'End-to-end check (cold)',
      status: found > 0 ? 'ok' : 'warn',
      detail:
        found > 0
          ? `${found} suggestion(s): ` +
            result.suggestions.map((s) => `“${s.original}”→“${s.replacement}”`).join(', ')
          : 'the model returned no suggestions for text full of errors — it may not be loaded',
      ms: analysis.ms,
    });

    // The first pass pays for session setup. The second is what typing feels
    // like, so it is the number that actually matters.
    const warm = await timed(() =>
      rpc.call('analyze', {
        text: SAMPLE,
        language: result.language,
        settings,
        dictionary: [],
      }),
    );
    const warmResult = warm.value;
    checks.push({
      name: 'End-to-end check (warm)',
      status: warm.error ? 'fail' : warm.ms < 2500 ? 'ok' : 'warn',
      detail: warm.error
        ? errorText(warm.error)
        : `${warmResult!.reuse.cached} sentence(s) from cache, ${warmResult!.reuse.prompted} prompted` +
          (warm.ms < 2500 ? '' : ' — typing will lag behind by this much'),
      ms: warm.ms,
    });

    // Attribute a slow pass to a stage instead of leaving it a single number.
    const t = result.timings;
    checks.push({
      name: 'Cold pass breakdown',
      status: 'ok',
      detail: `detect ${t.detect} ms · proofreader ${t.proofread} ms · prompt ${t.model} ms · tone ${t.tone} ms`,
    });
  }

  const translation = await timed(() =>
    rpc.call('translate', { text: 'Good morning, how are you?', target: 'es', source: 'en' }),
  );
  checks.push({
    name: 'Translate',
    status: translation.error ? 'fail' : 'ok',
    detail: translation.error
      ? errorText(translation.error)
      : `“${translation.value!.text}”`,
    ms: translation.ms,
  });

  /* -- The content script on a real web page ------------------------------ */

  // Not `active: true`: this page is itself the active tab, and content scripts
  // never run on chrome-extension:// URLs. Test the most recent web page.
  try {
    const webTabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
    const target = webTabs
      .filter((tab) => !tab.discarded)
      .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];

    if (!target?.id || !target.url) {
      checks.push({
        name: 'Content script',
        status: 'warn',
        detail:
          webTabs.length > 0
            ? 'the only web tabs open have been discarded by Chrome — click one and re-run'
            : 'no ordinary web page is open to test against — open one and re-run',
      });
    } else {
      const tabId = target.id;
      const host = new URL(target.url).hostname;
      const ping = () =>
        chrome.tabs.sendMessage(tabId, { type: 'panel:request-state' }, { frameId: 0 }) as Promise<{
          mode?: string;
          hasEditor?: boolean;
        } | null>;

      let probe = await timed(ping);
      let repaired = false;

      if (probe.error) {
        // The tab predates the extension being installed or reloaded. Inject on
        // the spot rather than asking for a manual refresh.
        try {
          await chrome.scripting.insertCSS({
            target: { tabId, allFrames: true },
            files: ['content.css'],
          });
          await chrome.scripting.executeScript({
            target: { tabId, allFrames: true },
            files: ['content.js'],
          });
          repaired = true;
          probe = await timed(ping);
        } catch (error) {
          checks.push({
            name: 'Content script',
            status: 'fail',
            detail: `${host}: cannot inject — ${errorText(error)}`,
          });
        }
      }

      if (!checks.some((check) => check.name === 'Content script')) {
        if (probe.error) {
          checks.push({
            name: 'Content script',
            status: 'fail',
            detail: `${host}: ${errorText(probe.error)} even after injecting`,
            ms: probe.ms,
          });
        } else {
          const state = probe.value;
          const suffix = repaired ? ' (injected just now — it was a stale tab)' : '';
          checks.push({
            name: 'Content script',
            status: state?.mode === 'disabled' ? 'warn' : 'ok',
            detail:
              state?.mode === 'disabled'
                ? `${host}: loaded, but Pilcrow is switched off for this site`
                : state?.hasEditor
                  ? `${host}: attached to a text field${suffix}`
                  : `${host}: loaded, no text field focused${suffix}`,
            ms: probe.ms,
          });
        }
      }
    }
  } catch (error) {
    checks.push({ name: 'Content script', status: 'fail', detail: errorText(error) });
  }

  return checks;
}

export function formatReport(checks: Check[]): string {
  const header = [
    `${PRODUCT} diagnostics`,
    `extension ${chrome.runtime.getManifest().version} · Chrome ${chromeVersion()} · ${navigator.platform}`,
    '',
  ];
  const width = Math.max(...checks.map((check) => check.name.length));
  const body = checks.map((check) => {
    const badge = check.status === 'ok' ? '[ ok ]' : check.status === 'warn' ? '[warn]' : '[FAIL]';
    const timing = check.ms === undefined ? '' : ` (${check.ms} ms)`;
    return `${badge} ${check.name.padEnd(width)}  ${check.detail}${timing}`;
  });
  return [...header, ...body].join('\n');
}
