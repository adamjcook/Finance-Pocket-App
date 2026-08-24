// Dev utility: seed demo data and capture phone-sized screenshots of the app.
// Requires the production build to be served: `npm run build && npm run preview`.
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:4173/Finance-Pocket-App/';
const OUT = process.env.SHOT_DIR || 'test-results/shots';

const day = (offset) => new Date(Date.now() - offset * 86400000).toISOString();
const meta = (offset) => ({ updatedAt: day(offset), updatedBy: 'seed-device' });
const acc = (id, name, institution, kind, owner, offset = 200) => ({
  id, name, institution, kind, owner, archived: false, createdAt: day(offset), ...meta(offset),
});
const snap = (accountId, balance, offset) => ({
  id: crypto.randomUUID(), accountId, balance, at: day(offset), deviceId: 'seed-device', createdAt: day(offset),
});

const payload = {
  v: 1,
  deviceId: 'seed-device',
  sentAt: day(0),
  settings: {
    id: 'settings', partnerAName: 'Adam', partnerBName: 'Sam', currency: 'GBP',
    debtBaselineMinor: null, ...meta(200),
  },
  accounts: [
    acc('cc-1', 'Barclaycard', 'Barclays', 'credit_card', 'A'),
    acc('cc-2', 'Amex Gold', 'American Express', 'credit_card', 'B'),
    acc('sv-1', 'Marcus Saver', 'Goldman Sachs', 'savings', 'joint'),
    acc('iv-1', 'Vanguard ISA', 'Vanguard', 'investment', 'joint'),
  ],
  aliases: [{
    id: 'al-1', name: 'Main Savings', accountId: 'sv-1',
    history: [{ accountId: 'sv-1', from: day(200) }],
    archived: false, createdAt: day(200), ...meta(200),
  }],
  snapshots: [
    snap('cc-1', 4300_00, 180), snap('cc-2', 2450_00, 180),
    snap('cc-1', 3600_00, 120), snap('cc-2', 2100_00, 120),
    snap('cc-1', 2900_00, 60), snap('cc-2', 1500_00, 60),
    snap('cc-1', 2150_00, 14), snap('cc-2', 900_00, 14),
    snap('sv-1', 5200_00, 180), snap('iv-1', 8100_00, 180),
    snap('sv-1', 6400_00, 120), snap('iv-1', 8900_00, 120),
    snap('sv-1', 7900_00, 60), snap('iv-1', 9800_00, 60),
    snap('sv-1', 8750_00, 14), snap('iv-1', 10900_00, 14),
  ],
  voids: [],
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await page.goto(BASE);
await page.getByPlaceholder('e.g. Adam').fill('Adam');
await page.getByPlaceholder('e.g. Sam').fill('Sam');
await page.getByRole('button', { name: 'Get started' }).click();
await page.evaluate((p) => window.__syncTest.importPayload(p), payload);

for (const [route, name] of [['#/', 'dashboard'], ['#/accounts', 'accounts'], ['#/update', 'update'], ['#/aliases', 'aliases'], ['#/sync', 'sync']]) {
  await page.goto(BASE + route);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('wrote', `${OUT}/${name}.png`);
}
await browser.close();
