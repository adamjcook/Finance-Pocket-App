import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const svg = readFileSync('/home/user/Finance-Pocket-App/public/icons/favicon.svg', 'utf8');
const out = '/home/user/Finance-Pocket-App/public/icons';

// In the remote dev environment the pinned Playwright build isn't downloaded;
// CHROMIUM_PATH lets the pre-installed browser be used instead.
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
const page = await browser.newPage();

async function shot(size, file, { maskable = false } = {}) {
  await page.setViewportSize({ width: size, height: size });
  // Maskable icons need the artwork inside the ~80% safe zone on a full-bleed background.
  const inner = maskable ? Math.round(size * 0.78) : size;
  const pad = Math.round((size - inner) / 2);
  const html = `<!doctype html><body style="margin:0;background:${maskable ? '#101418' : 'transparent'}">
    <div style="padding:${pad}px"><div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', '<svg style="display:block;width:100%;height:100%" ')}</div></div>
  </body>`;
  await page.setContent(html);
  await page.screenshot({ path: `${out}/${file}`, omitBackground: !maskable });
  console.log('wrote', file);
}

await shot(192, 'icon-192.png');
await shot(512, 'icon-512.png');
await shot(512, 'maskable-512.png', { maskable: true });
await browser.close();
