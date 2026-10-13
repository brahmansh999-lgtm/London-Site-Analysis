// Drives the gis-site-analysis app to capture the 7 overlay screenshots for a given site,
// cropped to the map area only (sidebar excluded).
// Usage: node capture_site.cjs "<Site Name>" <pathIndex> "<output dir>"
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const SITE_NAME = process.argv[2];
const PATH_INDEX = parseInt(process.argv[3], 10);
const OUT_DIR = process.argv[4];

const SIDEBAR_WIDTH = 288; // w-72
const VIEWPORT = { width: 1600, height: 1000 };

const STEP2_OVERLAYS = ['Sun Path & Shadow', 'Wind Analysis', 'Topography', 'Circulation & Access', 'Noise Zones'];
const STEP3_OVERLAYS = ['Building Heights', 'Urban Linkages'];

async function waitForContextLoaded(page) {
  // The "Fetching site context..." badge disappears once Overpass data has loaded.
  await page.waitForFunction(
    () => !document.body.textContent.includes('Fetching site context'),
    { timeout: 60000 }
  );
  await page.waitForTimeout(800);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: VIEWPORT });

  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('PAGE ERROR:', msg.text());
  });

  await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=Click a site boundary to begin analysis', { timeout: 20000 });
  await page.waitForTimeout(1500);

  await page.mouse.move(800, 500);
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(1500);

  let paths = await page.$$('.leaflet-overlay-pane path');
  console.log(`total paths: ${paths.length}, targeting index ${PATH_INDEX}`);
  let box = await paths[PATH_INDEX].boundingBox();
  console.log('box after zoom-out:', JSON.stringify(box));

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(1500);

  paths = await page.$$('.leaflet-overlay-pane path');
  box = await paths[PATH_INDEX].boundingBox();
  console.log('box after zoom back in:', JSON.stringify(box));

  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.click(cx, cy);

  const headerText = await page.locator('h2').first().textContent({ timeout: 5000 });
  console.log('Selected site header:', headerText);
  if (headerText.trim() !== SITE_NAME) {
    console.error(`MISMATCH: expected "${SITE_NAME}" but got "${headerText}"`);
    await browser.close();
    process.exit(1);
  }

  await page.click('text=Proceed to Site Analysis');
  await page.waitForSelector('text=Sun Path & Shadow', { timeout: 15000 });
  console.log('Waiting for site context (Overpass) to finish loading...');
  await waitForContextLoaded(page);
  console.log('Context loaded.');

  const clip = { x: 0, y: 0, width: VIEWPORT.width - SIDEBAR_WIDTH, height: VIEWPORT.height };

  for (const label of STEP2_OVERLAYS) {
    await page.click(`button:has-text("${label}")`);
    await page.waitForTimeout(1800);
    await page.screenshot({ path: path.join(OUT_DIR, `${label}.png`), clip });
    console.log('Captured', label);
    await page.click(`button:has-text("${label}")`);
    await page.waitForTimeout(300);
  }

  await page.click('text=Urban Strategy');
  await page.waitForSelector('text=Building Heights', { timeout: 15000 });
  await page.waitForTimeout(1500);

  for (const label of STEP3_OVERLAYS) {
    await page.click(`button:has-text("${label}")`);
    await page.waitForTimeout(1800);
    await page.screenshot({ path: path.join(OUT_DIR, `${label}.png`), clip });
    console.log('Captured', label);
    await page.click(`button:has-text("${label}")`);
    await page.waitForTimeout(300);
  }

  await browser.close();
  console.log('DONE');
})().catch((err) => {
  console.error('SCRIPT ERROR:', err);
  process.exit(1);
});
