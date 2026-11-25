// Renders favicon.svg in an icon directory to the PNG sizes the manifest uses.
// Usage: node scripts/gen-icons.mjs [dir]   (default public/icons; dev: public/icons-dev)
import { chromium } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const out = resolve(process.argv[2] ?? 'public/icons');
const svg = readFileSync(`${out}/favicon.svg`, 'utf8');
// A full-bleed maskable.svg (artwork already inside the safe zone) is used
// as-is for the maskable icon; without one, favicon.svg is shrunk onto a
// plain background as before.
const maskableSvg = existsSync(`${out}/maskable.svg`) ? readFileSync(`${out}/maskable.svg`, 'utf8') : null;

// In the remote dev environment the pinned Playwright build isn't downloaded;
// CHROMIUM_PATH lets the pre-installed browser be used instead.
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
const page = await browser.newPage();

async function shot(size, file, { maskable = false } = {}) {
  await page.setViewportSize({ width: size, height: size });
  const fullBleed = maskable && maskableSvg;
  // Maskable icons need the artwork inside the ~80% safe zone on a full-bleed background.
  const inner = maskable && !fullBleed ? Math.round(size * 0.78) : size;
  const pad = Math.round((size - inner) / 2);
  const art = fullBleed ? maskableSvg : svg;
  const html = `<!doctype html><body style="margin:0;background:${maskable && !fullBleed ? '#101418' : 'transparent'}">
    <div style="padding:${pad}px"><div style="width:${inner}px;height:${inner}px">${art.replace('<svg ', '<svg style="display:block;width:100%;height:100%" ')}</div></div>
  </body>`;
  await page.setContent(html);
  await page.screenshot({ path: `${out}/${file}`, omitBackground: !maskable });
  console.log('wrote', `${out}/${file}`);
}

await shot(192, 'icon-192.png');
await shot(512, 'icon-512.png');
await shot(512, 'maskable-512.png', { maskable: true });
await browser.close();
