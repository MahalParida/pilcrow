import { test, expect } from './fixtures';

test.beforeEach(async ({ page }) => { await page.goto('http://127.0.0.1:4173'); });

for (const editor of ['#draft', '#subject', '#rich']) {
  test(`accept two corrections without losing text in ${editor}`, async ({ page }) => {
    const field = page.locator(editor);
    await field.fill('Please recieve teh updated document today.');
    await expect(page.locator('.badge')).toHaveAttribute('data-state', 'issues');
    await page.locator('.badge').click();
    await page.getByRole('button', { name: 'Accept', exact: true }).click();
    await page.getByRole('button', { name: 'Accept', exact: true }).click();
    if (editor === '#rich') await expect(field).toHaveText('Please receive the updated document today.');
    else await expect(field).toHaveValue('Please receive the updated document today.');
    await expect(page.locator('.badge')).toHaveAttribute('data-state', 'clean');
  });
}

test('rich-text highlights preserve markup and accepting keeps undo', async ({ page }) => {
  const field = page.locator('#rich');
  await field.evaluate(el => { el.innerHTML = '<b>Please</b> recieve the document.<br><i>Thank you.</i>'; });
  await field.click();
  await expect(page.locator('.badge')).toHaveAttribute('data-state', 'issues');
  await expect(field.locator('b')).toHaveText('Please');
  expect(await page.evaluate(() => CSS.highlights.size)).toBeGreaterThan(0);
  await page.locator('.badge').click();
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(field.locator('b')).toHaveText('Please');
  await expect(field.locator('i')).toHaveText('Thank you.');
  await field.press('ControlOrMeta+z');
  await expect(field).toContainText('recieve');
});

test('dismiss does not edit and Escape closes the card', async ({ page }) => {
  await page.locator('#draft').fill('Please recieve teh updated document today.');
  await expect(page.locator('.badge')).toHaveAttribute('data-state', 'issues');
  await page.locator('.badge').click();
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await expect(page.locator('#draft')).toHaveValue('Please recieve teh updated document today.');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Accept', exact: true })).toBeHidden();
});

test('typing during analysis discards stale suggestions', async ({ page }) => {
  await page.locator('#draft').fill('SLOW Please recieve the updated document.');
  await expect(page.locator('.badge')).toHaveAttribute('data-state', 'busy');
  await page.locator('#draft').fill('This sentence is already correct.');
  await expect(page.locator('.badge')).toHaveAttribute('data-state', 'clean');
  await expect(page.locator('.pilcrow-hl')).toHaveCount(0);
  await expect(page.locator('#draft')).toHaveValue('This sentence is already correct.');
});

test('passwords excluded and removing an editor cleans up decorations', async ({ page }) => {
  await page.locator('#password').fill('Please recieve teh updated document today.');
  await expect(page.locator('#pilcrow-overlay')).toHaveCount(0);
  await page.locator('#draft').fill('Please recieve the updated document today.');
  await expect(page.locator('.badge')).toHaveAttribute('data-state', 'issues');
  await page.locator('#draft').evaluate(el => el.remove());
  await expect(page.locator('.pilcrow-mirror')).toHaveCount(0);
  await expect(page.locator('.badge')).toBeHidden();
});

test('corrections work offline with the test engine and send no page requests', async ({ page, context }) => {
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  await context.setOffline(true);
  await page.locator('#draft').fill('Please recieve the updated document today.');
  await expect(page.locator('.badge')).toHaveAttribute('data-state', 'issues');
  await page.locator('.badge').click();
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(page.locator('#draft')).toHaveValue('Please receive the updated document today.');
  expect(requests).toEqual([]);
});
