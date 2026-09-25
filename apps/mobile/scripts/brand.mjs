// Renders the Datalink mark into every icon and splash PNG the app needs.
// Usage: node scripts/brand.mjs   (needs Playwright's Chromium)
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(import.meta.dirname, '..', 'assets');
const INK = ['#4B483F', '#282722'];
const WHITE = '#F5F0E6';
const CLAY = '#D09A74';

/**
 * A D made of connected data nodes. The cross-link reads at launcher size;
 * the broad stroke survives Android's adaptive-icon crop.
 */
function mark({ scale = 1 } = {}) {
  const t = `translate(512 512) scale(${scale}) translate(-512 -512)`;
  return `
  <g transform="${t}" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M 300 260 V 764 M 300 260 H 490 C 681 260 772 356 772 512 C 772 668 681 764 490 764 H 300" stroke="${WHITE}" stroke-width="72"/>
    <path d="M 300 512 H 725" stroke="${CLAY}" stroke-width="56"/>
    <circle cx="300" cy="260" r="38" fill="${CLAY}"/>
    <circle cx="300" cy="764" r="38" fill="${CLAY}"/>
    <circle cx="725" cy="512" r="38" fill="${CLAY}"/>
  </g>`;
}

const gradient = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${INK[0]}"/><stop offset="1" stop-color="${INK[1]}"/></linearGradient></defs>`;
const svg = (body, size = 1024) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">${gradient}${body}</svg>`;

const files = {
  // iOS / legacy launcher: full-bleed tile (the OS applies its own mask).
  'icon.png': [svg(`<rect width="1024" height="1024" fill="url(#g)"/>${mark({ scale: 0.74 })}`), 1024],
  // Android adaptive icon: 108dp canvas, only the centre 66dp is always visible.
  'android-icon-background.png': [svg(`<rect width="1024" height="1024" fill="url(#g)"/>`), 1024],
  'android-icon-foreground.png': [svg(mark({ scale: 0.5 })), 1024],
  'android-icon-monochrome.png': [svg(mark({ scale: 0.5 }).replaceAll(CLAY, '#FFFFFF').replaceAll(WHITE, '#FFFFFF')), 1024],
  // Splash: rounded tile on a transparent canvas (Android 12+ crops to a circle of ~2/3).
  'splash-icon.png': [
    svg(`<rect x="242" y="242" width="540" height="540" rx="140" fill="url(#g)"/>${mark({ scale: 0.4 })}`),
    1024,
  ],
  'favicon.png': [svg(`<rect width="1024" height="1024" rx="224" fill="url(#g)"/>${mark({ scale: 0.74 })}`), 64],
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
for (const [name, [markup, size]] of Object.entries(files)) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${markup.replace('width="1024" height="1024" viewBox', `width="${size}" height="${size}" viewBox`)}</body></html>`);
  writeFileSync(join(OUT, name), await page.locator('svg').screenshot({ omitBackground: true }));
  console.log('wrote', name, size);
}
writeFileSync(join(OUT, 'logo.svg'), svg(`<rect width="1024" height="1024" rx="224" fill="url(#g)"/>${mark({ scale: 0.74 })}`));
await browser.close();
