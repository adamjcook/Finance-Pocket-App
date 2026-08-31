import { expect, test, type Page } from '@playwright/test';

/**
 * End-to-end flows against the production build (vite preview).
 * The two-device test uses window.__syncTest, which pipes the real QR frame
 * codec + merge + persistence, bypassing only the camera optics.
 */

async function completeSetup(page: Page, me: string, partner: string) {
  await page.goto('.');
  await page.getByRole('button', { name: 'Set up on this phone first' }).click();
  await page.getByPlaceholder('e.g. Adam').fill(me);
  await page.getByPlaceholder('e.g. Sam').fill(partner);
  await page.getByRole('button', { name: 'Get started' }).click();
  await expect(page.getByRole('heading', { name: 'New account' })).toBeVisible();
}

async function addAccount(
  page: Page,
  name: string,
  kind: 'Credit card' | 'Loan' | 'Savings' | 'Investment',
  balance: string | null,
  owner?: string,
) {
  await page.goto('.#/accounts/new');
  await page.getByPlaceholder('e.g. Barclaycard, Marcus saver').fill(name);
  await page.locator('select').first().selectOption({ label: kind });
  if (owner) {
    await page.locator('select').nth(1).selectOption({ label: owner });
  }
  if (balance !== null) {
    await page.getByPlaceholder('0.00').fill(balance);
  }
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible();
}

test('setup, accounts, balance updates, and dashboard progress', async ({ page }) => {
  await completeSetup(page, 'Adam', 'Sam');
  await addAccount(page, 'Barclaycard', 'Credit card', '3000');
  await addAccount(page, 'Marcus Saver', 'Savings', '1000');

  // Dashboard shows both headline figures
  await page.goto('.#/');
  await expect(page.getByText('£3,000.00').first()).toBeVisible();
  await expect(page.getByText('£1,000.00').first()).toBeVisible();

  // Pay down the card via the rapid update flow
  await page.goto('.#/update');
  const cardInput = page
    .locator('.account-row', { hasText: 'Barclaycard' })
    .getByPlaceholder('0.00');
  await cardInput.fill('1500');
  await page.getByRole('button', { name: /Save 1 update/ }).click();

  await expect(page.getByRole('heading', { name: 'FinPair' })).toBeVisible();
  await expect(page.locator('.subtitle', { hasText: 'Adam & Sam' })).toBeVisible();
  await expect(page.getByText('£1,500.00').first()).toBeVisible();
  await expect(page.getByText('50%')).toBeVisible(); // paid off half of the £3,000 peak
  await expect(page.getByText('£1,500.00 of £3,000.00 paid off')).toBeVisible();

  // Inline balance edit from the accounts list
  await page.goto('.#/accounts');
  await page.locator('.account-row', { hasText: 'Marcus Saver' }).getByRole('button', { name: '£1,000.00' }).click();
  await page.locator('.account-row', { hasText: 'Marcus Saver' }).locator('input').fill('1250');
  await page.locator('.account-row', { hasText: 'Marcus Saver' }).getByRole('button', { name: '✓' }).click();
  await expect(page.getByRole('button', { name: '£1,250.00' })).toBeVisible();

  // A loan gets its own dashboard card and stays out of the card-payoff goal
  await addAccount(page, 'Car Loan', 'Loan', '9000');
  await page.goto('.#/');
  await expect(page.getByText('still owed on loans')).toBeVisible();
  await expect(page.getByText('£9,000.00').first()).toBeVisible();
  await expect(page.getByText('£1,500.00').first()).toBeVisible(); // card debt unchanged

  // Goals: clear-by dates for cards and loans, amount + date for savings
  await page.goto('.#/settings');
  await page.locator('input[type="date"]').nth(0).fill('2027-06-01'); // cards
  await page.locator('input[type="date"]').nth(1).fill('2027-11-01'); // loans
  await page.getByPlaceholder('no target').fill('10000');
  await page.locator('input[type="date"]').nth(2).fill('2027-06-01'); // savings
  await page.goto('.#/');
  await expect(page.getByText(/needs about/).first()).toBeVisible();
  await expect(page.getByText(/1 Jun 2027/).first()).toBeVisible();
  await expect(page.getByText(/1 Nov 2027/).first()).toBeVisible(); // loan goal date
  await expect(page.getByText(/% there/)).toBeVisible();
  await expect(page.getByText(/to get there by/)).toBeVisible();
});

test('second phone joins via setup and owners stay consistent (no flip)', async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const phoneA = await contextA.newPage();
  const phoneB = await contextB.newPage();

  // Phone A sets up and creates accounts owned by each partner
  await completeSetup(phoneA, 'Adam', 'Sam');
  await addAccount(phoneA, 'Adam Card', 'Credit card', '3000', 'Adam');
  await addAccount(phoneA, 'Sam Card', 'Credit card', '2000', 'Sam');

  // Phone B joins instead of setting up fresh. The join path's camera can't
  // run headless, so pipe A's frames through the sync hook — the same merge
  // the ScanPanel performs — and verify the app leaves setup on its own.
  await phoneB.goto('.');
  await expect(phoneB.getByRole('button', { name: "Join your partner's setup" })).toBeVisible();
  const frames = await phoneA.evaluate(() => window.__syncTest.exportFrames());
  await phoneB.evaluate((f) => window.__syncTest.importFrames(f), frames);

  // B now shows A's names, and each account keeps its true owner (shown as
  // the accessible label on that row's colour bar, per the account-row redesign)
  await expect(phoneB.locator('.subtitle', { hasText: 'Adam & Sam' })).toBeVisible();
  await phoneB.goto('.#/accounts');
  await expect(
    phoneB.locator('.account-row', { hasText: 'Adam Card' }).getByRole('img', { name: 'Adam' }),
  ).toBeVisible();
  await expect(
    phoneB.locator('.account-row', { hasText: 'Sam Card' }).getByRole('img', { name: 'Sam' }),
  ).toBeVisible();

  // And the reverse pass leaves both phones on the same check code
  const framesB = await phoneB.evaluate(() => window.__syncTest.exportFrames());
  await phoneA.evaluate((f) => window.__syncTest.importFrames(f), framesB);
  const hashA = await phoneA.evaluate(() => window.__syncTest.stateHash());
  const hashB = await phoneB.evaluate(() => window.__syncTest.stateHash());
  expect(hashA).toBe(hashB);

  await contextA.close();
  await contextB.close();
});

test('two phones converge through a full QR-frame sync round trip', async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const phoneA = await contextA.newPage();
  const phoneB = await contextB.newPage();

  await completeSetup(phoneA, 'Adam', 'Sam');
  await addAccount(phoneA, 'A Card', 'Credit card', '3000');
  await completeSetup(phoneB, 'Sam', 'Adam');
  await addAccount(phoneB, 'B Card', 'Credit card', '2000');
  await addAccount(phoneB, 'B ISA', 'Investment', '5000');

  // Pass 1: A shows, B scans & merges. Pass 2: B shows the merged state, A scans.
  const framesA = await phoneA.evaluate(() => window.__syncTest.exportFrames());
  const resultB = await phoneB.evaluate((frames) => window.__syncTest.importFrames(frames), framesA);
  expect(resultB.summary.newSnapshots).toBeGreaterThanOrEqual(1);

  const framesB = await phoneB.evaluate(() => window.__syncTest.exportFrames());
  const resultA = await phoneA.evaluate((frames) => window.__syncTest.importFrames(frames), framesB);

  // Both phones now hold identical state (matching check codes)
  expect(resultA.hash).toBe(resultB.hash);
  const hashA = await phoneA.evaluate(() => window.__syncTest.stateHash());
  const hashB = await phoneB.evaluate(() => window.__syncTest.stateHash());
  expect(hashA).toBe(hashB);

  // Combined figures appear on both dashboards: £5,000 debt, £5,000 investments
  for (const phone of [phoneA, phoneB]) {
    await phone.goto('.#/');
    await phone.reload();
    await expect(phone.getByText('£5,000.00').first()).toBeVisible();
    await expect(phone.getByText('left to clear')).toBeVisible();
  }

  // Idempotent: syncing again changes nothing
  const framesA2 = await phoneA.evaluate(() => window.__syncTest.exportFrames());
  const resultB2 = await phoneB.evaluate((frames) => window.__syncTest.importFrames(frames), framesA2);
  expect(resultB2.summary.newSnapshots).toBe(0);
  expect(resultB2.hash).toBe(hashB);

  await contextA.close();
  await contextB.close();
});

test('alias survives switching banks', async ({ page }) => {
  await completeSetup(page, 'Adam', 'Sam');
  await addAccount(page, 'Old Bank Saver', 'Savings', '1200');
  await addAccount(page, 'Shiny New Saver', 'Savings', null);

  await page.goto('.#/aliases');
  await page.getByPlaceholder(/Main Savings/).fill('Main Savings');
  await page.locator('select').selectOption({ label: 'Old Bank Saver' });
  await page.getByRole('button', { name: 'Create alias' }).click();
  await expect(page.getByText('currently: Old Bank Saver')).toBeVisible();

  // Switch banks: re-point the alias; the old account is archived automatically
  await page.getByRole('button', { name: 'Re-point' }).click();
  await page.getByRole('button', { name: /Shiny New Saver/ }).click();
  await expect(page.getByText('currently: Shiny New Saver')).toBeVisible();
  await expect(page.getByText('History: Old Bank Saver → Shiny New Saver')).toBeVisible();

  // The alias chip follows the new account; the old one is archived
  await page.goto('.#/accounts');
  const newRow = page.locator('.account-row', { hasText: 'Shiny New Saver' });
  await expect(newRow.getByText('Main Savings')).toBeVisible();
  await expect(page.getByText('Old Bank Saver')).toBeHidden();
});

test('custom partner colours apply on the accounts page and persist', async ({ page }) => {
  await completeSetup(page, 'Adam', 'Sam');
  await addAccount(page, 'Barclaycard', 'Credit card', '1500', 'Adam');

  await page.goto('.#/settings');
  const swatches = page.locator('input.color-swatch');
  await swatches.nth(0).fill('#123456');
  await swatches.nth(1).fill('#abcdef');

  // The CSS custom properties the whole UI reads from are updated live
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--partner-a').trim()))
    .toBe('#123456');
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--partner-b').trim()))
    .toBe('#abcdef');

  // Reflected on the accounts page: the colour key at the top and each row's bar
  await page.goto('.#/accounts');
  await expect(page.locator('.owner-key .owner-dot-a')).toHaveCSS('background-color', 'rgb(18, 52, 86)');
  await expect(page.locator('.owner-key .owner-dot-b')).toHaveCSS('background-color', 'rgb(171, 205, 239)');
  await expect(
    page.locator('.account-row', { hasText: 'Barclaycard' }).locator('.owner-bar'),
  ).toHaveCSS('background-color', 'rgb(18, 52, 86)');

  // Persists across a reload (settings are stored, not just an in-memory var)
  await page.reload();
  await expect(
    page.locator('.account-row', { hasText: 'Barclaycard' }).locator('.owner-bar'),
  ).toHaveCSS('background-color', 'rgb(18, 52, 86)');
});

test('light mode is opt-in, applies live, and persists across a reload', async ({ page }) => {
  await completeSetup(page, 'Adam', 'Sam');

  // Dark by default
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(20, 26, 33)');

  await page.goto('.#/settings');
  await page.getByRole('button', { name: 'Light', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(244, 246, 248)');

  // Persists across a reload — it's a device preference, not just an in-memory var
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  // Switching back to dark works too
  await page.goto('.#/settings');
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('dashboard shows net worth, defaults to savings first, and cards are drag-reorderable', async ({ page }) => {
  await completeSetup(page, 'Adam', 'Sam');
  await addAccount(page, 'Barclaycard', 'Credit card', '1500');
  await addAccount(page, 'Marcus Saver', 'Savings', '500');

  await page.goto('.#/');
  // £500 saved − £1,500 owed = −£1,000, shown as a bare centred figure
  await expect(page.locator('.net-worth')).toHaveText('-£1,000.00');

  const headings = page.locator('.dash-section h2');
  await expect(headings).toHaveCount(2);
  await expect(headings.nth(0)).toContainText('Savings & investments');
  await expect(headings.nth(1)).toContainText('Credit card debt');

  // Drag the debt card's handle up above the savings card
  const debtHandle = page.locator('.dash-section', { hasText: 'Credit card debt' }).locator('.drag-handle');
  const growthSection = page.locator('.dash-section', { hasText: 'Savings & investments' });
  const handleBox = await debtHandle.boundingBox();
  const growthBox = await growthSection.boundingBox();
  if (!handleBox || !growthBox) throw new Error('expected bounding boxes');

  // Separate awaited moves (rather than one move with `steps`) so Preact's
  // async re-render flushes between them.
  const cx = handleBox.x + handleBox.width / 2;
  await page.mouse.move(cx, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(cx, handleBox.y - 20);
  await page.mouse.move(cx, growthBox.y + growthBox.height / 2);
  await page.mouse.move(cx, 10);
  await page.mouse.up();

  await expect(headings.nth(0)).toContainText('Credit card debt');
  await expect(headings.nth(1)).toContainText('Savings & investments');

  // Persists across a reload — it's a device preference, not just in-memory
  await page.reload();
  await expect(page.locator('.dash-section h2').nth(0)).toContainText('Credit card debt');
});

test('dragging one card past two others in a single motion lands correctly', async ({ page }) => {
  // The old swap-as-you-cross reorder logic only ever handled one hop per
  // pointer move; a single large motion that skipped straight past a middle
  // card (easy to do with a fast real-touch drag, much harder to reproduce
  // with a slow synthetic one) could desync the drag from the pointer. This
  // drags the top card straight past two others in one big jump.
  await completeSetup(page, 'Adam', 'Sam');
  await addAccount(page, 'Barclaycard', 'Credit card', '1500');
  await addAccount(page, 'Marcus Saver', 'Savings', '500');
  await addAccount(page, 'Car Loan', 'Loan', '9000');

  await page.goto('.#/');
  const headings = page.locator('.dash-section h2');
  await expect(headings).toHaveCount(3);
  await expect(headings.nth(0)).toContainText('Savings & investments');
  await expect(headings.nth(1)).toContainText('Credit card debt');
  await expect(headings.nth(2)).toContainText('Loans');

  const growthHandle = page.locator('.dash-section', { hasText: 'Savings & investments' }).locator('.drag-handle');
  const loansSection = page.locator('.dash-section', { hasText: 'Loans' });
  const handleBox = await growthHandle.boundingBox();
  if (!handleBox) throw new Error('expected bounding box');

  const cx = handleBox.x + handleBox.width / 2;
  await page.mouse.move(cx, handleBox.y + handleBox.height / 2);
  await page.mouse.down();

  // All three cards collapse to bare heading rows for the duration — no
  // "card" body should be visible anywhere on the board while dragging.
  await page.mouse.move(cx, handleBox.y + 10);
  await expect(page.locator('.card')).toHaveCount(0);

  const loansBox = await loansSection.boundingBox();
  if (!loansBox) throw new Error('expected bounding box');
  // One big jump straight past the debt card and into/past the loans card.
  await page.mouse.move(cx, loansBox.y + loansBox.height + 40);
  await page.mouse.up();

  await expect(page.locator('.card')).toHaveCount(3);
  await expect(headings.nth(0)).toContainText('Credit card debt');
  await expect(headings.nth(1)).toContainText('Loans');
  await expect(headings.nth(2)).toContainText('Savings & investments');
});
