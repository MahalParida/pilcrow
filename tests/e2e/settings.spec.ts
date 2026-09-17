import { test, expect } from './fixtures';
// Use the unmodified release extension: no engine or storage mocks.
test.use({ realEngine: true });
test('settings and personal dictionary survive page reload', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/options/index.html`);
  await expect(page.locator('#enabled')).toBeChecked();
  await page.locator('#enabled').uncheck();
  await page.locator('#dict-input').fill('PilcrowTestWord');
  await page.locator('#dict-add').click();
  await expect(page.locator('#dictionary')).toContainText('PilcrowTestWord');
  await page.reload();
  await expect(page.locator('#enabled')).not.toBeChecked();
  await expect(page.locator('#dictionary')).toContainText('PilcrowTestWord');
});
