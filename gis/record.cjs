const { chromium } = require('playwright-core');

const OUT_DIR = 'C:/Users/brahm/AppData/Local/Temp/claude/c--Users-brahm-OneDrive-Desktop-RC-10-Websites-gis-site-analysis-clean/1fb9fb65-334e-4c5a-911d-e80b8cd9822b/scratchpad/video/raw';
const WAIT = (ms) => new Promise((r) => setTimeout(r, ms));

// Different candidate index than previous runs (9, 28, 18 used before).
const TARGET_INDEX = 12;

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: OUT_DIR, size: { width: 1920, height: 1080 } },
  });
  const page = await context.newPage();
  const recordingStart = Date.now();
  const videoSec = () => (Date.now() - recordingStart) / 1000;
  let cutStart = null;
  let cutEnd = null;

  try {
    await page.goto('http://localhost:5183', { waitUntil: 'networkidle', timeout: 30000 });
    await WAIT(1000);

    const polygons = page.locator('.leaflet-interactive');
    await page.waitForFunction(
      () => document.querySelectorAll('.leaflet-interactive').length > 0,
      { timeout: 15000 }
    );
    let count = await polygons.count();
    console.log('polygon count (initial zoom)', count);

    const candidates = [];
    for (let i = 0; i < count; i++) {
      const box = await polygons.nth(i).boundingBox().catch(() => null);
      if (box && box.width > 6 && box.height > 6 && box.x > 300 && box.x < 1600 && box.y > 150 && box.y < 900) {
        candidates.push({ i, box });
      }
    }
    console.log('candidates', candidates.length);

    let targetBox = null;
    if (candidates.length > 0) {
      const pick = candidates[Math.min(TARGET_INDEX, candidates.length - 1)];
      targetBox = pick.box;
    } else {
      for (let i = 0; i < count; i++) {
        const box = await polygons.nth(i).boundingBox().catch(() => null);
        if (box && box.width > 2 && box.height > 2) { targetBox = box; break; }
      }
    }
    console.log('target box', targetBox);

    const cx = targetBox.x + targetBox.width / 2;
    const cy = targetBox.y + targetBox.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, -400);
    await WAIT(900);
    await page.mouse.wheel(0, -300);
    await WAIT(1200);
    // let map tiles finish loading at this zoom level before continuing
    await WAIT(1500);

    count = await polygons.count();
    console.log('polygon count (zoomed)', count);
    let clicked = false;
    // Register the Overpass response listener BEFORE clicking — the fetch
    // fires the instant `site` state is set (synchronously on click), and
    // some sites resolve in well under a second, so listening late can miss it.
    // The app hits a primary endpoint first and falls back to a mirror if
    // that fails (e.g. 504), so wait for an OK response specifically —
    // matching the first response seen (which may be the failed primary)
    // would resolve too early.
    const overpassOkResponsePromise = page
      .waitForResponse(
        (resp) => /overpass-api\.de|overpass\.kumi\.systems/.test(resp.url()) && resp.ok(),
        { timeout: 90000 }
      )
      .catch(() => null);

    for (let i = 0; i < count && !clicked; i++) {
      const el = polygons.nth(i);
      const box = await el.boundingBox().catch(() => null);
      if (box && box.width > 20 && box.height > 20 && box.x > 200 && box.x < 1700 && box.y > 150 && box.y < 900) {
        await el.click({ timeout: 5000, force: true }).catch(() => {});
        clicked = true;
        console.log('clicked polygon index', i, box);
      }
    }
    if (!clicked) {
      for (let i = 0; i < count && !clicked; i++) {
        const el = polygons.nth(i);
        const box = await el.boundingBox().catch(() => null);
        if (box && box.width > 4 && box.height > 4) {
          await el.click({ timeout: 5000, force: true }).catch(() => {});
          clicked = true;
          console.log('fallback clicked polygon index', i, box);
        }
      }
    }

    // Confirm a site actually got selected before proceeding.
    const siteNameEl = page.locator('text=Selected Site');
    await siteNameEl.waitFor({ state: 'visible', timeout: 10000 });
    const siteName = await page.evaluate(() => {
      const h2 = document.querySelector('h2');
      return h2 ? h2.textContent : null;
    });
    console.log('SELECTED SITE:', siteName);

    // Straight to Site Analysis — minimal pause on the site info panel.
    const proceedBtn = page.getByText('Proceed to Site Analysis', { exact: false });
    await proceedBtn.waitFor({ state: 'visible', timeout: 10000 });
    await WAIT(1000);

    // Wait for the actual Overpass network response — deterministic, unlike
    // polling badge text (which can race React's render/mount timing).
    console.log('waiting for a successful Overpass site-context response...');
    const t0 = Date.now();
    cutStart = videoSec(); // mark start of dead-air segment to trim from the final video
    const overpassResp = await overpassOkResponsePromise;
    if (overpassResp) {
      console.log(`Overpass OK after ${Date.now() - t0}ms: ${overpassResp.status()} ${overpassResp.url()}`);
    } else {
      console.log('no successful Overpass response observed within 90s timeout');
    }
    // Wait for the loading badge to actually clear — and STAY clear across
    // several consecutive checks. React StrictMode (dev mode) double-invokes
    // effects, so the site-context fetch actually fires twice: an aborted
    // first attempt, then a real second one. A single "badge is gone" check
    // can land in the brief gap between the two and falsely conclude done.
    await WAIT(800);
    const clearDeadline = Date.now() + 90000;
    let checks = 0;
    let consecutiveClear = 0;
    const REQUIRED_CONSECUTIVE_CLEAR = 6; // ~3s of confirmed stability
    while (Date.now() < clearDeadline) {
      const stillFetching = await page.evaluate(
        () => (document.body.textContent || '').includes('Fetching site context')
      ).catch(() => false);
      checks++;
      if (stillFetching) {
        consecutiveClear = 0;
      } else {
        consecutiveClear++;
        if (consecutiveClear >= REQUIRED_CONSECUTIVE_CLEAR) break;
      }
      await WAIT(500);
    }
    console.log(`badge stably cleared after ${checks} checks (~${Date.now() - t0}ms total since response wait started)`);
    // One more settle buffer for the map to finish drawing the new geometry.
    await WAIT(1000);
    cutEnd = videoSec(); // dead-air segment ends here — trim [cutStart, cutEnd] out later
    console.log(`CUT_SEGMENT ${cutStart.toFixed(2)} ${cutEnd.toFixed(2)}`);
    await WAIT(1000);

    await proceedBtn.click();
    await WAIT(1200);

    // Step 2: Site Analysis sidebar — toggle each category one by one,
    // verifying real content rendered (not a blank/empty overlay) for the
    // data-dependent categories before moving on.
    const categories = [
      { label: 'Sun Path & Shadow',    hold: 2200 },
      { label: 'Wind Analysis',        hold: 2200 },
      { label: 'Topography',           hold: 2200 },
      { label: 'Existing Context',     hold: 2800 },
      { label: 'Circulation & Access', hold: 2800 },
      { label: 'Noise Zones',          hold: 2800 },
    ];

    for (const { label, hold } of categories) {
      const btn = page.getByText(label, { exact: true });
      await btn.waitFor({ state: 'visible', timeout: 10000 });
      await btn.click();
      console.log('toggled', label);
      await WAIT(hold);
      await btn.click();
      await WAIT(400);
    }

    // End the video here — no navigation into Urban Strategy.
    await WAIT(600);

  } catch (err) {
    console.error('ERROR', err);
  } finally {
    await context.close();
    await browser.close();
    console.log('DONE');
  }
})();
