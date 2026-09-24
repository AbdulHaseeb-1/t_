// Renders the route logo into every icon and splash PNG the app needs.
// Usage: node scripts/brand.mjs   (needs Playwright's Chromium)
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(import.meta.dirname, '..', 'assets');
const CLAY = ['#E08A68', '#C25B3C'];
const CREAM = '#FAF6EE';

/**
 * The mark on a 1024 grid: a start ring, a switchback route and a
 * destination pin. "From a question to the answer by the shortest path."
 */
function mark(color, { scale = 1, stroke = 64 } = {}) {
  const t = `translate(512 512) scale(${scale}) translate(-512 -498)`;
  return `
  <g transform="${t}" fill="none" stroke="${color}" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="262" cy="760" r="54" stroke-width="${stroke * 0.78}"/>
    <path d="M 334 760 H 640 A 116 116 0 0 0 640 528 H 400 A 116 116 0 0 1 400 296 H 604" stroke-width="${stroke}"/>
    <g stroke="none" fill="${color}">
      <path fill-rule="evenodd" d="M 760 424 C 760 424 648 318 648 238 A 112 112 0 0 1 872 238 C 872 318 760 424 760 424 Z M 760 196 A 44 44 0 1 0 760.1 196 Z"/>
    </g>
  </g>`;
}

const gradient = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${CLAY[0]}"/><stop offset="1" stop-color="${CLAY[1]}"/></linearGradient></defs>`;
const svg = (body, size = 1024) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">${gradient}${body}</svg>`;

const files = {
  // iOS / legacy launcher: full-bleed tile (the OS applies its own mask).
  'icon.png': [svg(`<rect width="1024" height="1024" fill="url(#g)"/>${mark(CREAM, { scale: 0.74 })}`), 1024],
  // Android adaptive icon: 108dp canvas, only the centre 66dp is always visible.
  'android-icon-background.png': [svg(`<rect width="1024" height="1024" fill="url(#g)"/>`), 1024],
  'android-icon-foreground.png': [svg(mark(CREAM, { scale: 0.5 })), 1024],
  'android-icon-monochrome.png': [svg(mark('#FFFFFF', { scale: 0.5 })), 1024],
  // Splash: rounded tile on a transparent canvas (Android 12+ crops to a circle of ~2/3).
  'splash-icon.png': [
    svg(`<rect x="242" y="242" width="540" height="540" rx="140" fill="url(#g)"/>${mark(CREAM, { scale: 0.4 })}`),
    1024,
  ],
  'favicon.png': [svg(`<rect width="1024" height="1024" rx="224" fill="url(#g)"/>${mark(CREAM, { scale: 0.74, stroke: 80 })}`), 64],
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
for (const [name, [markup, size]] of Object.entries(files)) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${markup.replace('width="1024" height="1024" viewBox', `width="${size}" height="${size}" viewBox`)}</body></html>`);
  writeFileSync(join(OUT, name), await page.locator('svg').screenshot({ omitBackground: true }));
  console.log('wrote', name, size);
}
writeFileSync(join(OUT, 'logo.svg'), svg(`<rect width="1024" height="1024" rx="224" fill="url(#g)"/>${mark(CREAM, { scale: 0.74 })}`));
await browser.close();
