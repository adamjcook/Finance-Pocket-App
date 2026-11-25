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

  // Dashboard shows both headline figures, in whole pounds
  await page.goto('.#/');
  await expect(page.locator('.big-number', { hasText: '£3,000' })).toBeVisible();
  await expect(page.locator('.big-number', { hasText: '£1,000' })).toBeVisible();

  // Pay down the card via the Accounts page's update mode
  await page.goto('.#/accounts');
  await page.getByRole('button', { name: 'Update', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Update' })).toBeVisible();
  const cardInput = page
    .locator('.account-row', { hasText: 'Barclaycard' })
    .getByPlaceholder('0.00');
  await cardInput.fill('1500');
  await page.getByRole('button', { name: /Save 1 update/ }).click();
  // Saving goes Home to say how the two of you did, with a way to undo it.
  const checkIn = page.locator('.checkin');
  await expect(checkIn.getByRole('heading', { name: 'Nicely done, Adam & Sam' })).toBeVisible();
  await expect(checkIn).toContainText('Card debt');
  await expect(checkIn).toContainText('down £1,500');
  await expect(checkIn.getByRole('button', { name: 'Undo this update' })).toBeVisible();
  // Net worth went up, so Home celebrates it — once.
  await expect(page.locator('.net-gain')).toHaveText('£1,500 since the last update');
  await expect(page.locator('.app-logo.celebrate')).toHaveCount(1);
  // The confetti appears as the count lands, then cleans up after itself.
  await expect(page.locator('canvas.confetti')).toHaveCount(1);
  await expect(page.locator('canvas.confetti')).toHaveCount(0, { timeout: 5000 });
  await page.goto('.#/accounts');
  await expect(page.locator('.account-row', { hasText: 'Barclaycard' })).toContainText('£1,500.00');

  await page.goto('.#/');
  await expect(page.getByRole('heading', { name: 'MC Bank' })).toBeVisible();
  await expect(page.locator('.subtitle', { hasText: 'Adam & Sam' })).toBeVisible();
  // Home shows whole pounds throughout.
  await expect(page.locator('.big-number', { hasText: '£1,500' })).toBeVisible();
  await expect(page.getByRole('img', { name: '50% paid off' })).toBeVisible(); // half of the £3,000 peak
  await expect(page.getByText('£1,500 of £3,000 paid off')).toBeVisible();

  // A second change through the Update button; balances on the list are plain text
  await page.goto('.#/accounts');
  await expect(page.locator('.account-row', { hasText: 'Marcus Saver' }).getByRole('button', { name: '£1,000.00' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Update', exact: true }).click();
  await page.getByLabel('New balance for Marcus Saver').fill('1250');
  await page.getByRole('button', { name: /Save 1 update/ }).click();
  await expect(page.locator('.checkin')).toContainText('up £250');
  await page.goto('.#/accounts');
  await expect(page.locator('.account-row', { hasText: 'Marcus Saver' })).toContainText('£1,250.00');
  // The tab bar no longer has a separate Update tab.
  await expect(page.locator('.tabbar .tab')).toHaveText(['Home', 'Accounts', 'Sync', 'Settings']);

  // A loan gets its own dashboard card and stays out of the card-payoff goal
  await addAccount(page, 'Car Loan', 'Loan', '9000');
  await page.goto('.#/');
  await expect(page.getByText('still owed on loans')).toBeVisible();
  const loansCard = page.locator('.dash-section', { hasText: 'Loans' });
  await expect(loansCard.getByRole('img', { name: '0% paid off' })).toBeVisible(); // ring, like the cards'
  await expect(loansCard).toContainText('£0 of £9,000 paid off');
  await expect(loansCard.locator('.big-number')).toHaveText('£9,000');
  await expect(page.locator('.dash-section', { hasText: 'Credit card debt' }).locator('.big-number')).toHaveText('£1,500'); // unchanged

  // Goals live on each account: a pay-off date for the card and the loan.
  const year = new Date().getUTCFullYear() + 1;
  for (const [name, date] of [['Barclaycard', `${year}-06-01`], ['Car Loan', `${year}-11-01`]]) {
    await page.goto('.#/accounts');
    await page.locator('.account-row', { hasText: name }).locator('.account-main').click();
    await page.getByLabel('Pay off by').fill(date);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible();
  }
  // Each pay-off goal shows inside its own card, not in a separate Goals card.
  await page.goto('.#/');
  const cards = page.locator('.dash-section', { hasText: 'Credit card debt' });
  const loans = page.locator('.dash-section', { hasText: 'still owed on loans' });
  await expect(cards).toContainText(`Pay off by 1 Jun ${year}`);
  await expect(cards).toContainText('£1,500 left');
  await expect(cards.getByRole('img', { name: 'Barclaycard: 50% paid off' })).toBeVisible();
  await expect(cards).toContainText(/about £[\d,]+\/month/);
  await expect(loans).toContainText(`Pay off by 1 Nov ${year}`);
  await expect(page.locator('.dash-section', { hasText: 'Savings goals' })).toHaveCount(0);
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

  // B now shows A's names, and each account keeps its true owner (shown on
  // the account's edit screen).
  await expect(phoneB.locator('.subtitle', { hasText: 'Adam & Sam' })).toBeVisible();
  for (const [card, owner] of [['Adam Card', 'Adam'], ['Sam Card', 'Sam']]) {
    await phoneB.goto('.#/accounts');
    await phoneB.locator('.account-row', { hasText: card }).locator('.account-main').click();
    await expect(
      phoneB.getByRole('group', { name: 'Whose is it?' }).getByRole('button', { name: owner }),
    ).toHaveAttribute('aria-pressed', 'true');
  }

  // And the reverse pass leaves both phones on the same check code
  const framesB = await phoneB.evaluate(() => window.__syncTest.exportFrames());
  await phoneA.evaluate((f) => window.__syncTest.importFrames(f), framesB);
  const hashA = await phoneA.evaluate(() => window.__syncTest.stateHash());
  const hashB = await phoneB.evaluate(() => window.__syncTest.stateHash());
  expect(hashA).toBe(hashB);

  // Home says the phones agree, as of that sync.
  await phoneA.goto('.#/');
  await expect(phoneA.locator('.sync-line')).toContainText('Same as Sam’s phone · synced just now');

  // Settings names the two of you from each phone's own side. A set up, so
  // it already knows it's Adam's; B (joined through the test hook rather than
  // the scanner) asks once, then says "You" for Sam.
  await phoneA.goto('.#/settings');
  await expect(phoneA.locator('.setting-row', { hasText: 'Your partner' }).locator('input')).toHaveValue('Sam');
  await expect(phoneA.locator('.setting-row', { hasText: /^You/ }).first().locator('input')).toHaveValue('Adam');
  await phoneB.goto('.#/settings');
  const whose = phoneB.getByRole('group', { name: 'Which of you is this phone?' });
  await whose.getByRole('button', { name: 'Sam' }).click();
  await expect(phoneB.getByRole('group', { name: 'This phone is' }).getByRole('button', { name: 'Sam' })).toHaveAttribute('aria-pressed', 'true');
  await expect(phoneB.locator('.setting-row', { hasText: 'Your partner' }).locator('input')).toHaveValue('Adam');

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
    await expect(phone.locator('.dash-section', { hasText: 'Credit card debt' }).locator('.big-number')).toHaveText('£5,000');
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
  await page.getByRole('button', { name: 'Switch account' }).click();
  await page.getByRole('button', { name: /Shiny New Saver/ }).click();
  await expect(page.getByText('currently: Shiny New Saver')).toBeVisible();
  await expect(page.getByText('History: Old Bank Saver → Shiny New Saver')).toBeVisible();

  // The alias chip follows the new account; the old one is archived
  await page.goto('.#/accounts');
  const newRow = page.locator('.account-row', { hasText: 'Shiny New Saver' });
  await expect(newRow.getByText('Main Savings')).toBeVisible();
  await expect(page.getByText('Old Bank Saver')).toBeHidden();
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

test('dashboard shows net worth, defaults to debt first, and cards are reorderable', async ({ page }) => {
  await completeSetup(page, 'Adam', 'Sam');
  await addAccount(page, 'Barclaycard', 'Credit card', '1500');
  await addAccount(page, 'Marcus Saver', 'Savings', '500');

  await page.goto('.#/');
  // £500 saved − £1,500 owed = −£1,000, in whole pounds with a true minus sign
  await expect(page.locator('.net-worth')).toHaveText('−£1,000');

  const headings = page.locator('.dash-section h2');
  await expect(headings).toHaveCount(2);
  await expect(headings.nth(0)).toContainText('Credit card debt');
  await expect(headings.nth(1)).toContainText('Savings & investments');

  // Reordering lives behind "Reorder cards": no grips until then.
  await expect(page.locator('.drag-handle')).toHaveCount(0);
  await page.getByRole('button', { name: 'Reorder cards' }).click();

  // Keyboard-friendly buttons move a card one place…
  await page.getByRole('button', { name: 'Move Savings & investments up' }).click();
  await expect(headings.nth(0)).toContainText('Savings & investments');
  await page.getByRole('button', { name: 'Move Savings & investments down' }).click();
  await expect(headings.nth(0)).toContainText('Credit card debt');

  // …and the grip still drags: the savings card up above the debt card.
  const growthHandle = page.getByRole('button', { name: 'Drag to reorder Savings & investments' });
  const debtSection = page.locator('.dash-section', { hasText: 'Credit card debt' });
  const handleBox = await growthHandle.boundingBox();
  const growthBox = await debtSection.boundingBox();
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

  await expect(headings.nth(0)).toContainText('Savings & investments');
  await expect(headings.nth(1)).toContainText('Credit card debt');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.dash-body')).toHaveCount(2);

  // Persists across a reload — it's a device preference, not just in-memory
  await expect.poll(async () => (await storedDevice(page))?.dashboardOrder?.[0]).toBe('growth');
  await page.reload();
  await expect(page.locator('.dash-section h2').nth(0)).toContainText('Savings & investments');
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
  await expect(headings.nth(0)).toContainText('Credit card debt');
  await expect(headings.nth(1)).toContainText('Savings & investments');
  await expect(headings.nth(2)).toContainText('Loans');

  await page.getByRole('button', { name: 'Reorder cards' }).click();
  const debtHandle = page.getByRole('button', { name: 'Drag to reorder Credit card debt' });
  const loansSection = page.locator('.dash-section', { hasText: 'Loans' });
  const handleBox = await debtHandle.boundingBox();
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

  await expect(headings.nth(0)).toContainText('Savings & investments');
  await expect(headings.nth(1)).toContainText('Loans');
  await expect(headings.nth(2)).toContainText('Credit card debt');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.dash-body')).toHaveCount(3);
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
  // One-time setup lives behind Connections, which says it's not set up yet.
  const connections = page.getByRole('button', { name: /Trading 212 and reminders/ });
  await expect(connections).toContainText('Not set up');
  await connections.click();
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
  await expect(row).toContainText('£10,120.50');
  await expect(row.getByText('Auto')).toBeVisible();

  // Home: the move on the day (+£120.50) and the overall gain (+£1,120.50, 12.4%).
  await page.goto('.#/');
  await expect(page.locator('.mini-stats')).toContainText('+£121 today');
  await expect(page.locator('.mini-stats')).toContainText('+£1,121 (12.4%) overall');
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
  const goals = page.locator('.dash-section', { hasText: 'Savings goals' });
  await expect(goals).toContainText('Wedding Fund');
  await expect(goals).toContainText('£2,000 of £10,000');
  await expect(goals).toContainText('£8,000 to go');
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
  await page.getByRole('button', { name: /Trading 212 and reminders/ }).click();
  const toggle = page.getByRole('switch', { name: 'Notifications on this phone' });
  await expect(toggle).toBeDisabled();
  await expect(page.getByText(/Reminders are sent by the same Worker/)).toBeVisible();
  await page.getByPlaceholder('Paste address').fill('https://t212.example');
  await page.getByPlaceholder('Paste address').press('Tab');
  await page.getByPlaceholder('FINPAIR_TOKEN').fill('tok');
  await page.getByPlaceholder('FINPAIR_TOKEN').press('Tab');
  await expect(toggle).toBeEnabled();
});

test('charts: a swipe scrolls, a press-and-hold reads out a day with a vibration', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 600 } });
  const page = await context.newPage();
  // Record vibrations instead of (not) buzzing the headless browser.
  await page.addInitScript(() => {
    (window as unknown as { __buzz: number[] }).__buzz = [];
    navigator.vibrate = ((p: unknown) => {
      (window as unknown as { __buzz: unknown[] }).__buzz.push(p);
      return true;
    }) as Navigator['vibrate'];
  });
  // Two readings a few days apart, so the savings chart has a line to read.
  // (setFixedTime pins the date but leaves timers — the hold delay — running.)
  await page.clock.setFixedTime(new Date(Date.now() - 3 * 86400000));
  await completeSetup(page, 'Adam', 'Sam');
  await addAccount(page, 'Marcus Saver', 'Savings', '500');
  await page.clock.setFixedTime(new Date());
  await page.goto('.#/update');
  await page.locator('.account-row', { hasText: 'Marcus Saver' }).getByPlaceholder('0.00').fill('900');
  await page.getByRole('button', { name: /Save 1 update/ }).click();
  await page.goto('.#/');

  const svg = page.locator('.dash-section', { hasText: 'Savings & investments' }).locator('.chart svg');
  const tooltip = page.locator('.dash-section', { hasText: 'Savings & investments' }).locator('.chart-tooltip');
  await expect(svg).toBeVisible();
  const box = (await svg.boundingBox())!;
  const at = (fx: number) => ({ x: box.x + box.width * fx, y: box.y + box.height / 2 });

  /** Fire a touch event at the chart; returns false if the page cancelled it. */
  const touch = (type: string, p: { x: number; y: number } | null) =>
    svg.evaluate(
      (el, { type, p }) => {
        const t = p ? [new Touch({ identifier: 1, target: el, clientX: p.x, clientY: p.y })] : [];
        const changed = p ? t : [new Touch({ identifier: 1, target: el, clientX: 0, clientY: 0 })];
        return el.dispatchEvent(
          new TouchEvent(type, { touches: t, targetTouches: t, changedTouches: changed, bubbles: true, cancelable: true }),
        );
      },
      { type, p },
    );
  const buzzes = () => page.evaluate(() => (window as unknown as { __buzz: unknown[] }).__buzz.length);

  // A quick swipe: moves well past the slop before the hold time — no read-out, no buzz,
  // and the move isn't cancelled (so the page scrolls).
  await touch('touchstart', at(0.5));
  expect(await touch('touchmove', { x: at(0.5).x, y: at(0.5).y - 40 })).toBe(true);
  await page.waitForTimeout(400);
  await touch('touchend', null);
  await expect(tooltip).toHaveText(/^\s*$/);
  expect(await buzzes()).toBe(0);

  // Press and hold: after the hold time the day is read out and it buzzes once.
  await touch('touchstart', at(0.1));
  await page.waitForTimeout(400);
  await expect(tooltip).toContainText('£500.00');
  expect(await buzzes()).toBe(1);
  // Sliding now moves along the line and keeps the page from scrolling.
  expect(await touch('touchmove', at(0.98))).toBe(false);
  await expect(tooltip).toContainText('£900.00');
  // Lifting the finger clears it.
  await touch('touchend', null);
  await expect(tooltip).toHaveText(/^\s*$/);
  await context.close();
});

test('payday update: mistypes are caught, drafts survive a reload, and a check-in can be undone', async ({ page }) => {
  await completeSetup(page, 'Adam', 'Sam');
  await addAccount(page, 'Barclaycard', 'Credit card', '1800');

  await page.goto('.#/accounts');
  await page.getByRole('button', { name: 'Update', exact: true }).click();
  const input = page.getByLabel('New balance for Barclaycard');

  // Tapping in selects the old figure, so typing replaces it.
  await input.click();
  await expect.poll(() => input.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, 4]);

  // A malformed amount says so in words and blocks saving.
  await input.fill('12a');
  await expect(page.getByText(/Not a valid amount\. Use numbers only/)).toBeVisible();
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('button', { name: 'Fix the amount in red first' })).toBeDisabled();

  // An extra zero gets a gentle double-check, but can still be saved.
  await input.fill('18000');
  await expect(page.locator('.row-warn')).toHaveText('£18,000.00? It was £1,800.00');
  // …and pressing Save first asks for a second look, listing just that row.
  const save = page.locator('.sticky-action > .btn-primary');
  await expect(save).toHaveText('Save 1 update · 1 to double-check');
  await save.click();
  await expect(page.getByRole('alert')).toContainText('Double-check before saving');
  await expect(page.getByRole('alert')).toContainText('Barclaycard£18,000.00 · was £1,800.00');
  await expect(save).toHaveText('Save anyway');

  // A sensible figure survives the app being reloaded mid-update.
  await input.fill('1600');
  await page.reload();
  await expect(page.getByLabel('New balance for Barclaycard')).toHaveValue('1600');
  await page.getByRole('button', { name: /Save 1 update/ }).click();

  const checkIn = page.locator('.checkin');
  await expect(checkIn).toContainText('down £200');
  // The debt going down raised net worth: £1,800 owed → £1,600.
  await expect(page.locator('.net-worth')).toContainText('−£1,600');
  await checkIn.getByRole('button', { name: 'Undo this update' }).click();
  await expect(checkIn.getByRole('heading', { name: 'Update undone' })).toBeVisible();
  // Undo puts the headline back too: no stale figure or gain left on screen.
  await expect(page.locator('.net-worth')).toContainText('−£1,800');
  await expect(page.locator('.net-worth')).not.toContainText('−£1,600');
  await expect(page.locator('.net-gain')).toHaveCount(0);
  await page.goto('.#/accounts');
  await expect(page.locator('.account-row', { hasText: 'Barclaycard' })).toContainText('£1,800.00');
});

test('the partner who did not do the update sees it too, after syncing', async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const phoneA = await contextA.newPage();
  const phoneB = await contextB.newPage();

  // Adam's phone sets up (so it knows it's Adam's) and does a payday update.
  await completeSetup(phoneA, 'Adam', 'Sam');
  await addAccount(phoneA, 'Barclaycard', 'Credit card', '3000');
  await phoneA.goto('.#/update');
  await phoneA.getByLabel('New balance for Barclaycard').fill('2600');
  await phoneA.getByRole('button', { name: /Save 1 update/ }).click();
  await expect(phoneA.locator('.checkin')).toContainText('Since your last update');

  // Sam's phone joins and syncs: same card, saying who did it, celebrating
  // once (net worth went up), but with no Undo — that's Adam's to take back.
  await phoneB.goto('.');
  await expect(phoneB.getByRole('button', { name: "Join your partner's setup" })).toBeVisible();
  const frames = await phoneA.evaluate(() => window.__syncTest.exportFrames());
  await phoneB.evaluate((f) => window.__syncTest.importFrames(f), frames);
  await phoneB.goto('.#/');
  const card = phoneB.locator('.checkin');
  await expect(card.getByRole('heading', { name: 'Nicely done, Adam & Sam' })).toBeVisible();
  await expect(card).toContainText('Adam updated today');
  await expect(card).toContainText('down £400');
  await expect(card.getByRole('button', { name: 'Undo this update' })).toHaveCount(0);
  await expect(phoneB.locator('.net-gain')).toHaveText('£400 since the last update');

  // It survives the app being reopened, without celebrating again…
  await phoneB.reload();
  await expect(phoneB.locator('.checkin')).toContainText('Adam updated today');
  await phoneB.waitForTimeout(2500);
  await expect(phoneB.locator('.net-gain')).toHaveCount(0);
  // …until this phone dismisses it.
  await phoneB.locator('.checkin').getByRole('button', { name: 'Dismiss' }).click();
  await expect(phoneB.locator('.checkin')).toHaveCount(0);
  await phoneB.reload();
  await expect(phoneB.locator('.dash-top')).toBeVisible();
  await expect(phoneB.locator('.checkin')).toHaveCount(0);

  await contextA.close();
  await contextB.close();
});

test('automatic sync: after one QR handshake, updates reach the other phone through the Worker', async ({ browser }) => {
  // A fake Worker shared by both phones: one encrypted slot per phone, plus a
  // record of any "your partner updated" notification it was asked to send.
  const slots = new Map<string, { deviceId: string; at: string; iv: string; data: string }>();
  const notices: { title: string }[] = [];
  const fakeWorker = async (route: import('@playwright/test').Route) => {
    const req = route.request();
    const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
    if (req.method() === 'POST' && req.url().endsWith('/relay')) {
      const body = req.postDataJSON() as { slot: { deviceId: string; at: string; iv: string; data: string }; notify?: { title: string } };
      slots.set(body.slot.deviceId, body.slot);
      if (body.notify) notices.push(body.notify);
      return route.fulfill({ headers, body: JSON.stringify({ ok: true, notified: body.notify ? 1 : 0 }) });
    }
    if (req.method() === 'GET' && /\/relay\?channel=[0-9a-f]{32}$/.test(req.url())) {
      return route.fulfill({ headers, body: JSON.stringify({ slots: [...slots.values()] }) });
    }
    return route.fulfill({ headers, status: 404, body: '{"error":"Not found."}' });
  };

  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  await contextA.route('https://relay.example/**', fakeWorker);
  await contextB.route('https://relay.example/**', fakeWorker);
  const phoneA = await contextA.newPage();
  const phoneB = await contextB.newPage();

  // Adam sets up, adds a card and points MC Bank at the Worker.
  await completeSetup(phoneA, 'Adam', 'Sam');
  await addAccount(phoneA, 'Barclaycard', 'Credit card', '3000');
  await phoneA.goto('.#/settings');
  await phoneA.getByRole('button', { name: /Trading 212 and reminders/ }).click();
  await phoneA.getByPlaceholder('Paste address').fill('https://relay.example');
  await phoneA.getByPlaceholder('Paste address').press('Tab');
  await phoneA.getByPlaceholder('FINPAIR_TOKEN').fill('secret-token');
  await phoneA.getByPlaceholder('FINPAIR_TOKEN').press('Tab');

  // Before linking, the Sync tab says what's needed.
  await phoneA.goto('.#/sync');
  await expect(phoneA.getByText('Sync once by QR code below to link the two phones.')).toBeVisible();

  // One QR sync each way: Sam's phone joins, and the phones swap the key.
  await phoneB.goto('.');
  await expect(phoneB.getByRole('button', { name: "Join your partner's setup" })).toBeVisible();
  await phoneB.evaluate((f) => window.__syncTest.importFrames(f), await phoneA.evaluate(() => window.__syncTest.exportFrames()));
  await phoneA.evaluate((f) => window.__syncTest.importFrames(f), await phoneB.evaluate(() => window.__syncTest.exportFrames()));
  await phoneA.reload();
  await expect(phoneA.getByRole('switch', { name: 'Sync through your Worker' })).toHaveAttribute('aria-checked', 'true');

  // Adam does a payday update: it goes straight up, with a note for Sam.
  await phoneA.goto('.#/update');
  await phoneA.getByLabel('New balance for Barclaycard').fill('2600');
  await phoneA.getByRole('button', { name: /Save 1 update/ }).click();
  await expect.poll(() => notices.map((n) => n.title)).toContain('Adam just updated the balances');
  // The Worker only ever holds ciphertext.
  for (const slot of slots.values()) expect(slot.data).not.toMatch(/Barclaycard|2600|260000/);

  // Sam just opens MC Bank: no QR codes, and Home tells the story.
  await phoneB.goto('.#/');
  await phoneB.reload();
  const card = phoneB.locator('.checkin');
  await expect(card).toContainText('Adam updated today');
  await expect(card).toContainText('down £400');
  await expect(phoneB.locator('.dash-section', { hasText: 'Credit card debt' }).locator('.big-number')).toHaveText('£2,600');

  // …and Sam's phone publishes its merged copy back, so the two agree —
  // which Adam's Home then says, once it has seen Sam's copy.
  await expect.poll(() => slots.size, { timeout: 10000 }).toBe(2);
  await phoneA.goto('.#/');
  await phoneA.reload();
  await expect(phoneA.locator('.sync-line')).toContainText('Same on Sam’s phone', { timeout: 10000 });
  await phoneB.goto('.#/sync');
  await expect(phoneB.getByText(/On · checked/)).toBeVisible();

  await contextA.close();
  await contextB.close();
});

test('a month that went the wrong way: the cards agree with the check-in, in plain grey', async ({ page }) => {
  await completeSetup(page, 'Adam', 'Sam');
  await addAccount(page, 'Barclaycard', 'Credit card', '1000');
  await addAccount(page, 'Marcus Saver', 'Savings', '500');
  await page.goto('.#/update');
  await page.getByLabel('New balance for Barclaycard').fill('1300');
  await page.getByRole('button', { name: /Save 1 update/ }).click();

  await expect(page.locator('.checkin')).toContainText('up £300');
  // The debt card reports the same move over the same window — not a
  // 30-day figure that could say something different — and not in teal.
  const cards = page.locator('.dash-section', { hasText: 'Credit card debt' });
  await expect(cards.locator('.debt-change')).toContainText('£300');
  await expect(cards.locator('.debt-change')).toContainText('since the last update');
  await expect(cards.locator('.delta')).toHaveClass(/delta-flat/);
  // Savings didn't move in this update, so no chip at all.
  await expect(page.locator('.dash-section', { hasText: 'Savings & investments' }).locator('.delta')).toHaveCount(0);
  // Not synced yet: Home says so, with a way to fix it.
  await expect(page.locator('.sync-line')).toContainText('Not synced with');
  await expect(page.locator('.sync-line')).toHaveAttribute('href', '#/sync');
});
