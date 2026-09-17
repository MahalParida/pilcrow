import { test as base, chromium, type BrowserContext } from '@playwright/test';
import { resolve } from 'node:path';
export const test = base.extend<{ context: BrowserContext; extensionId: string; realEngine: boolean }>({
  realEngine: [false, { option: true }],
  context: async ({ realEngine }, use, testInfo) => {
    const extension = resolve(realEngine ? '.tmp/e2e-real-extension' : '.tmp/e2e-extension');
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium', headless: true, viewport: { width: 1280, height: 900 },
      ...(process.env.RECORD_DEMO ? { recordVideo: { dir: testInfo.outputPath('video'), size: { width: 1280, height: 900 } } } : {}),
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    await context.tracing.start({ screenshots: true, snapshots: true });
    try { await use(context); }
    finally {
      await context.tracing.stop(testInfo.status !== testInfo.expectedStatus
        ? { path: testInfo.outputPath('trace.zip') } : {});
      await context.close();
    }
  },
  extensionId: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    await use(new URL(worker.url()).host);
  },
  page: async ({ context, extensionId }, use) => {
    void extensionId;
    const page = await context.newPage();
    await use(page);
  },
});
export { expect } from '@playwright/test';
