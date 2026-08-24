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

  await expect(page.getByRole('heading', { name: /Adam & Sam/ })).toBeVisible();
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

  // Goals: clear-by date for the cards, amount + date for savings
  await page.goto('.#/settings');
  await page.locator('input[type="date"]').first().fill('2027-06-01');
  await page.getByPlaceholder('no target').fill('10000');
  await page.locator('input[type="date"]').nth(1).fill('2027-06-01');
  await page.goto('.#/');
  await expect(page.getByText(/needs about/)).toBeVisible();
  await expect(page.getByText(/1 Jun 2027/).first()).toBeVisible();
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

  // B now shows A's names, and each account keeps its true owner
  await expect(phoneB.getByRole('heading', { name: /Adam & Sam/ })).toBeVisible();
  await phoneB.goto('.#/accounts');
  await expect(
    phoneB.locator('.account-row', { hasText: 'Adam Card' }).getByText(/Adam ·/),
  ).toBeVisible();
  await expect(
    phoneB.locator('.account-row', { hasText: 'Sam Card' }).getByText(/Sam ·/),
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

test('custom partner colours apply throughout the app and persist', async ({ page }) => {
  await completeSetup(page, 'Adam', 'Sam');

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

  // Reflected on the dashboard greeting
  await page.goto('.#/');
  await expect(page.locator('.name-a')).toHaveCSS('color', 'rgb(18, 52, 86)');
  await expect(page.locator('.name-b')).toHaveCSS('color', 'rgb(171, 205, 239)');

  // Persists across a reload (settings are stored, not just an in-memory var)
  await page.reload();
  await expect(page.locator('.name-a')).toHaveCSS('color', 'rgb(18, 52, 86)');
});

test('share-target: a Nearby-Share-style hand-off merges automatically', async ({ page }) => {
  await completeSetup(page, 'Adam', 'Sam');
  await addAccount(page, 'My Card', 'Credit card', '1000');

  // Wait for the service worker to be active before simulating the hand-off
  // — a real Nearby Share arrives as a fresh navigation-mode POST, which is
  // only intercepted once the SW has activated.
  await page.evaluate(() => navigator.serviceWorker.ready);

  const partnerPayload = {
    v: 1,
    deviceId: 'partner-device',
    sentAt: new Date().toISOString(),
    settings: {
      id: 'settings',
      partnerAName: 'Adam',
      partnerBName: 'Sam',
      currency: 'GBP',
      debtBaselineMinor: null,
      updatedAt: '2020-01-01T00:00:00.000Z',
      updatedBy: 'partner-device',
    },
    accounts: [
      {
        id: 'partner-card',
        name: 'Partner Card',
        institution: '',
        kind: 'credit_card',
        owner: 'B',
        archived: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        updatedBy: 'partner-device',
      },
    ],
    aliases: [],
    snapshots: [
      {
        id: 'partner-snap',
        accountId: 'partner-card',
        balance: 50000,
        at: '2026-01-01T00:00:00.000Z',
        deviceId: 'partner-device',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    voids: [],
  };

  // A real multipart form navigation to the share-target action — exactly
  // what the browser sends when Android hands a Nearby Share file to the
  // app — so the service worker's fetch handler is exercised for real.
  // requestSubmit() is called from within the same evaluate() so the
  // navigation it triggers doesn't depend on the button being clickable
  // (Playwright's actionability checks don't apply to a synthetic element).
  await Promise.all([
    page.waitForURL(/#\/sync/),
    page
      .evaluate((payloadJson) => {
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = './share-target/';
        form.enctype = 'multipart/form-data';
        const input = document.createElement('input');
        input.type = 'file';
        input.name = 'payload';
        const dt = new DataTransfer();
        dt.items.add(new File([payloadJson], 'sync.json', { type: 'application/json' }));
        input.files = dt.files;
        form.appendChild(input);
        document.body.appendChild(form);
        form.requestSubmit();
      }, JSON.stringify(partnerPayload))
      .catch(() => {}), // the navigation this triggers destroys evaluate()'s own context
  ]);

  // Booted fresh on the Sync screen, found the pending share via IndexedDB,
  // and merged it without any user action.
  await expect(page.getByRole('heading', { name: 'Now show this back' })).toBeVisible();
  await page.goto('.#/accounts');
  await expect(page.locator('.account-row', { hasText: 'Partner Card' }).getByText(/Sam ·/)).toBeVisible();
  await expect(page.locator('.account-row', { hasText: 'Partner Card' })).toContainText('£500.00');
});
