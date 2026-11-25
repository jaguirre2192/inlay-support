// Captures the globe launch (paper, turn, unfold, crossfade) and the interactive globe from
// dev/globe.html as bursts of PNG frames.
//   NODE_PATH=<dir holding playwright> PW_EXECUTABLE=<webkit pw_run.sh> node atlas/dev/check-globe.cjs <out dir> [width height] [theme] [--interrupt]
// The site must be served at http://localhost:8093/.
const { webkit } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const out = process.argv[2]; fs.mkdirSync(out, { recursive: true });
  const width = Number(process.argv[3] ?? 1440), height = Number(process.argv[4] ?? 900), theme = process.argv[5] ?? 'light';
  const interrupt = process.argv.includes('--interrupt');
  const tag = `${width}-${theme}${interrupt ? '-touch' : ''}`;
  const options = process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {};
  const browser = await webkit.launch(options);
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(m.text()));
  const t0 = Date.now();
  await page.goto(`http://localhost:8093/atlas/dev/globe.html?theme=${theme}`);
  await page.waitForFunction(() => window.harnessReady && window.__globeLaunch, null, { timeout: 30000 });
  let n = 0, lastPhase = '';
  const shot = async (label) => {
    const phase = await page.evaluate(() => window.__launchDone ? 'done' : window.__globeLaunch?.phase);
    const file = path.join(out, `${tag}-${String(n++).padStart(2, '0')}-${phase}-${((Date.now() - t0) / 1000).toFixed(1)}s${label ? '-' + label : ''}.png`);
    await page.screenshot({ path: file });
    if (phase !== lastPhase) { console.log(phase, ((Date.now() - t0) / 1000).toFixed(1) + 's'); lastPhase = phase; }
    return phase;
  };
  // Through the launch until the map has taken over.
  let touched = false;
  for (let i = 0; i < 80; i++) {
    const phase = await shot();
    if (phase === 'done') break;
    if (interrupt && phase === 'turn' && !touched) { await page.waitForTimeout(1200); await page.mouse.click(width / 2, height / 3); touched = true; continue; }
    await page.waitForTimeout(phase === 'turn' ? 700 : phase === 'paper' ? 250 : 60);
  }
  await page.waitForTimeout(300); await shot('map');
  // The interactive globe: show, drag with a fling, zoom, then zoom past the closest to open out.
  if (!interrupt) {
    await page.click('#toggle'); await page.waitForTimeout(700); await shot('globe');
    const cx = width >= 600 && width > height ? width * 0.6 : width / 2, cy = height * 0.4;
    await page.mouse.move(cx, cy); await page.mouse.down();
    for (let k = 1; k <= 8; k++) { await page.mouse.move(cx - k * 30, cy + k * 6); await page.waitForTimeout(16); }
    await page.mouse.up(); await shot('fling'); await page.waitForTimeout(900); await shot('coasted');
    for (let k = 0; k < 6; k++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(30); }
    await page.waitForTimeout(200); await shot('zoomed');
    for (let k = 0; k < 6; k++) { await page.mouse.wheel(0, -90); await page.waitForTimeout(30); }
    await shot('opening'); await page.waitForTimeout(900); await shot('after-open');
    // A curl from the map, as a pinch-out past the whole world would drive it.
    await page.evaluate(() => window.__dev.show(false)); await page.waitForTimeout(300);
    for (const p of [0.15, 0.35, 0.55, 0.8]) { await page.evaluate((v) => window.__dev.curl(v), p); await page.waitForTimeout(60); await shot(`curl${p}`); }
    await page.evaluate(() => window.__dev.curl(0.8, true)); await page.waitForTimeout(800); await shot('curled');
    await page.mouse.click(cx, cy); await page.waitForTimeout(200);
    console.log('picked:', await page.textContent('#picked'));
  }
  console.log(errors.length ? 'errors:\n' + errors.join('\n') : 'no errors');
  await browser.close();
})();
