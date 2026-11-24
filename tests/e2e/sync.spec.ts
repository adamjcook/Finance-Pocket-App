import { expect, test, type Page } from '@playwright/test';

/**
 * The device record as actually stored in IndexedDB. The screen updates a
 * moment before the write lands, and reloading inside that window aborts it —
 * so persistence checks wait for the write before reloading.
 */
async function storedDevice(page: Page): Promise<{ theme?: string; dashboardOrder?: string[] } | null> {
  return page.evaluate(async () => {
    const [info] = await indexedDB.databases();
    if (!info?.name) return null;
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const req = indexedDB.open(info.name!);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const req = db.transaction('device').objectStore('device').get('device');
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  });
}

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
    await page.getByRole('group', { name: 'Whose is it?' }).getByRole('button', { name: owner }).click();
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
  await expect(page.getByRole('img', { name: '50% paid off' })).toBeVisible(); // half of the £3,000 peak
  await expect(page.getByText('£1,500.00 of £3,000.00 paid off')).toBeVisible();

  // Inline balance edit from the accounts list
  await page.goto('.#/accounts');
  await page.locator('.account-row', { hasText: 'Marcus Saver' }).getByRole('button', { name: '£1,000.00' }).click();
  await page.locator('.account-row', { hasText: 'Marcus Saver' }).locator('input').fill('1250');
  await page.locator('.account-row', { hasText: 'Marcus Saver' }).getByRole('button', { name: 'Save balance' }).click();
  await expect(page.getByRole('button', { name: '£1,250.00' })).toBeVisible();

  // A loan gets its own dashboard card and stays out of the card-payoff goal
  await addAccount(page, 'Car Loan', 'Loan', '9000');
  await page.goto('.#/');
  await expect(page.getByText('still owed on loans')).toBeVisible();
  await expect(page.getByText('£9,000.00').first()).toBeVisible();
  await expect(page.getByText('£1,500.00').first()).toBeVisible(); // card debt unchanged

  // Goals live on each account: a pay-off date for the card and the loan.
  const year = new Date().getUTCFullYear() + 1;
  for (const [name, date] of [['Barclaycard', `${year}-06-01`], ['Car Loan', `${year}-11-01`]]) {
    await page.goto('.#/accounts');
    await page.locator('.account-row', { hasText: name }).locator('.account-main').click();
    await page.getByLabel('Pay off by').fill(date);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible();
  }
  await page.goto('.#/');
  const goals = page.locator('.dash-section', { hasText: 'Goals' });
  await expect(goals).toContainText(`Pay off by 1 Jun ${year}`);
  await expect(goals).toContainText(`Pay off by 1 Nov ${year}`);
  await expect(goals).toContainText('£1,500.00 left');
  await expect(goals.getByRole('img', { name: 'Barclaycard: 50% paid off' })).toBeVisible();
  await expect(goals).toContainText(/about £[\d,.]+\/month/);
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

test('the setup colour choice applies on the accounts page, persists, and darkens in light mode', async ({ page }) => {
  // Colours are no longer freely pickable — Setup offers only the app icon's
  // two fixed colours, and whichever one you pick, your partner gets the other.
  await page.goto('.');
  await page.getByRole('button', { name: 'Set up on this phone first' }).click();
  await page.getByPlaceholder('e.g. Adam').fill('Adam');
  await page.getByPlaceholder('e.g. Sam').fill('Sam');
  await page.getByRole('button', { name: 'Amber' }).click();
  await page.getByRole('button', { name: 'Get started' }).click();
  await expect(page.getByRole('heading', { name: 'New account' })).toBeVisible();

  await addAccount(page, 'Barclaycard', 'Credit card', '1500', 'Adam');

  // Adam (partner A) picked amber, so Sam (partner B) gets teal — swapped
  // from the default A=teal/B=amber assignment.
  await page.goto('.#/accounts');
  await expect(page.locator('.owner-key .owner-dot-a')).toHaveCSS('background-color', 'rgb(242, 166, 90)');
  await expect(page.locator('.owner-key .owner-dot-b')).toHaveCSS('background-color', 'rgb(79, 209, 165)');
  const bar = page.locator('.account-row', { hasText: 'Barclaycard' }).locator('.owner-bar');
  await expect(bar).toHaveCSS('background-color', 'rgb(242, 166, 90)');

  // Persists across a reload (settings are stored, not just an in-memory var)
  await page.reload();
  await expect(bar).toHaveCSS('background-color', 'rgb(242, 166, 90)');

  // In light mode the fixed colour gets darkened for contrast against a
  // white card — same idea as --accent/--debt.
  await page.goto('.#/settings');
  await page.getByRole('button', { name: 'Light', exact: true }).click();
  await page.goto('.#/accounts');
  await expect(bar).not.toHaveCSS('background-color', 'rgb(242, 166, 90)');
  const [r, g, b] = await bar.evaluate((el) =>
    getComputedStyle(el)
      .backgroundColor.match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number),
  );
  expect(r + g + b).toBeLessThan(242 + 166 + 90); // darker than the raw amber, not just different
});

test('light mode is opt-in, applies live, and persists across a reload', async ({ page }) => {
  await completeSetup(page, 'Adam', 'Sam');

  // Dark by default
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(11, 13, 16)');

  await page.goto('.#/settings');
  await page.getByRole('button', { name: 'Light', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(242, 243, 245)');

  // Persists across a reload — it's a device preference, not just an in-memory var
  await expect.poll(async () => (await storedDevice(page))?.theme).toBe('light');
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
  await expect.poll(async () => (await storedDevice(page))?.dashboardOrder?.[0]).toBe('debt');
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
  await expect(page.locator('.dash-body')).toHaveCount(0);

  const loansBox = await loansSection.boundingBox();
  if (!loansBox) throw new Error('expected bounding box');
  // One big jump straight past the debt card and into/past the loans card.
  await page.mouse.move(cx, loansBox.y + loansBox.height + 40);
  await page.mouse.up();

  await expect(page.locator('.dash-body')).toHaveCount(3);
  await expect(headings.nth(0)).toContainText('Credit card debt');
  await expect(headings.nth(1)).toContainText('Loans');
  await expect(headings.nth(2)).toContainText('Savings & investments');
});

test('Trading 212 link imports daily readings and shows the day and overall change', async ({ page }) => {
  // A fake finpair-t212 Worker: yesterday's 9pm reading plus one taken today
  // (stamped when requested, so it's newer than the opening balance below).
  const yesterday = new Date(Date.now() - 86400000);
  yesterday.setUTCHours(21, 0, 0, 0);
  const reading = (at: Date, totalMinor: number) => ({
    day: at.toISOString().slice(0, 10),
    at: at.toISOString(),
    currency: 'GBP',
    totalMinor,
    costMinor: 900000,
    unrealisedMinor: totalMinor - 900000,
    final: true,
  });
  const auths: string[] = [];
  await page.route('https://t212.example/**', async (route) => {
    auths.push((await route.request().headerValue('authorization')) ?? '');
    const today = new Date();
    await route.fulfill({
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        readings: [reading(yesterday, 1000000), reading(today, 1012050)],
        status: { ok: true, at: today.toISOString() },
      }),
    });
  });

  await completeSetup(page, 'Adam', 'Sam');
  await addAccount(page, 'Stocks ISA', 'Investment', '9500');

  await page.goto('.#/settings');
  await page.getByLabel('Trading 212 linked account').selectOption({ label: 'Stocks ISA' });
  await page.getByPlaceholder('Paste address').fill('https://t212.example');
  await page.getByPlaceholder('Paste address').press('Tab');
  await page.getByPlaceholder('FINPAIR_TOKEN').fill('secret-token');
  await page.getByPlaceholder('FINPAIR_TOKEN').press('Tab');
  await page.getByRole('button', { name: 'Check now' }).click();
  await expect(page.getByText(/Last reading .*£10,120\.50/)).toBeVisible();
  expect(auths.at(-1)).toBe('Bearer secret-token');

  // The ISA's balance follows the latest reading, and it's marked as automatic.
  await page.goto('.#/accounts');
  const row = page.locator('.account-row', { hasText: 'Stocks ISA' });
  await expect(row.getByRole('button', { name: '£10,120.50' })).toBeVisible();
  await expect(row.getByText('Auto')).toBeVisible();

  // Home: the move on the day (+£120.50) and the overall gain (+£1,120.50, 12.4%).
  await page.goto('.#/');
  await expect(page.locator('.mini-stats')).toContainText('+£120.50 today');
  await expect(page.locator('.mini-stats')).toContainText('+£1,120.50 (12.4%) overall');
});

test('pot goals on Home, 0% deal and stale-balance pills, and the Reminders section', async ({ page }) => {
  await completeSetup(page, 'Adam', 'Sam');
  await addAccount(page, 'Wedding Fund', 'Savings', '2000');

  // Give the pot a goal from its edit screen.
  await page.goto('.#/accounts');
  await page.locator('.account-row', { hasText: 'Wedding Fund' }).locator('.account-main').click();
  await expect(page.getByRole('heading', { name: 'Edit account' })).toBeVisible();
  await page.getByPlaceholder('No goal').fill('10000');
  const nextYear = new Date().getUTCFullYear() + 1;
  await page.getByLabel('Reach the goal by').fill(`${nextYear}-06-01`);
  await page.getByRole('button', { name: 'Save changes' }).click();
  // Saving returns to Accounts once stored — wait for that before moving on.
  await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible();

  await page.goto('.#/');
  const goals = page.locator('.dash-section', { hasText: 'Goals' });
  await expect(goals).toContainText('Wedding Fund');
  await expect(goals).toContainText('£2,000.00 of £10,000.00');
  await expect(goals).toContainText('£8,000.00 to go');
  await expect(goals).toContainText(`to reach it by 1 Jun ${nextYear}`);
  await expect(goals.getByRole('img', { name: 'Wedding Fund: 20% of goal' })).toBeVisible();

  // A card with a 0% deal shows when it ends.
  await page.goto('.#/accounts/new');
  await page.getByPlaceholder('e.g. Barclaycard, Marcus saver').fill('M&S Card');
  await page.locator('select').first().selectOption({ label: 'Credit card' });
  await page.getByLabel('0% deal ends').fill(`${nextYear}-03-01`);
  await page.getByPlaceholder('0.00').fill('800');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.locator('.account-row', { hasText: 'M&S Card' })).toContainText(`0% until 1 Mar ${nextYear}`);

  // Six weeks on, balances that haven't been updated are flagged.
  await page.clock.install({ time: new Date(Date.now() + 42 * 86400000) });
  await page.reload();
  await expect(page.locator('.account-row', { hasText: 'Wedding Fund' })).toContainText('Updated 42 days ago');

  // Reminders need the Worker set up first.
  await page.goto('.#/settings');
  const toggle = page.getByRole('switch', { name: 'Notifications on this phone' });
  await expect(toggle).toBeDisabled();
  await expect(page.getByText(/Reminders are sent by the same Worker/)).toBeVisible();
  await page.getByPlaceholder('Paste address').fill('https://t212.example');
  await page.getByPlaceholder('Paste address').press('Tab');
  await page.getByPlaceholder('FINPAIR_TOKEN').fill('tok');
  await page.getByPlaceholder('FINPAIR_TOKEN').press('Tab');
  await expect(toggle).toBeEnabled();
});
