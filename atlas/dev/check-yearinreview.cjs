// Checks the year in review (dev/yearinreview.html): the plan, a few frames as PNGs, the sheet in
// play, rendering and done states, and a real recorded video (type, size, duration via ffprobe).
//   NODE_PATH=<dir holding playwright> node atlas/dev/check-yearinreview.cjs [webkit|chromium] <outdir> [lang]
const { webkit, chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

(async () => {
  const engine = process.argv[2] ?? 'webkit';
  const out = process.argv[3] ?? path.join(__dirname, 'yir-out');
  const lang = process.argv[4] ?? 'en';
  fs.mkdirSync(out, { recursive: true });
  const options = process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {};
  const browser = await (engine === 'chromium' ? chromium : webkit).launch(options);
  const reduced = process.env.REDUCED === '1';
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, acceptDownloads: true,
    reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(m.type() + ': ' + m.text()));
  await page.goto(`http://localhost:8093/atlas/dev/yearinreview.html?lang=${lang}`);
  await page.waitForFunction(() => window.harnessReady, null, { timeout: 30000 });
  const tag = `${engine}-${lang}${reduced ? '-reduced' : ''}`;

  console.log('years', await page.evaluate(() => window.yir.years()));
  const info = await page.evaluate(() => window.yir.info(2024));
  console.log('plan', JSON.stringify({ ...info, stops: info.stops.map((s) => `${s.caption} ${s.name}`) }));
  console.log('all time', JSON.stringify(await page.evaluate(() => { const p = window.yir.info(null); return [p.title, p.stops.length, p.totalLine, p.frames]; })));

  // Frames: intro, mid-fade of the first stop, a hold, the last stop, the closing card.
  if (engine === 'chromium' || process.env.FRAMES === '1') {
    const picks = { intro: 10, 'fade-1': 41, 'hold-3': 36 + 2 * 28 + 20, 'hold-8': 36 + 7 * 28 + 20, outro: info.frames - 1 };
    for (const [label, n] of Object.entries(picks)) {
      const data = await page.evaluate((n) => window.yir.frame(n), n);
      fs.writeFileSync(path.join(out, `frame-${label}-${tag}.png`), Buffer.from(data.split(',')[1], 'base64'));
    }
    console.log('frames written', Object.keys(picks).join(', '));
  }

  // The sheet opens on the newest year; choose 2024, then watch it play and settle.
  console.log('chooser', await page.$$eval('.yir-choice', (b) => b.map((x) => x.textContent.trim() + (x.getAttribute('aria-checked') === 'true' ? '*' : ''))));
  await page.click('.yir-choice:has-text("2024")');
  await page.waitForTimeout(reduced ? 1500 : 2600);
  await page.screenshot({ path: path.join(out, `sheet-playing-${tag}.png`) });
  await page.waitForTimeout(reduced ? 500 : 9500);
  await page.screenshot({ path: path.join(out, `sheet-settled-${tag}.png`) });
  console.log('actions', await page.$$eval('.yir-actions button', (b) => b.map((x) => x.textContent.trim())));

  // Save video: the rendering state, then done.
  const started = Date.now();
  await page.click('.yir-actions .ink');
  await page.waitForSelector('.yir-drawing', { timeout: 10000 });
  await page.waitForFunction(() => Number(document.querySelector('.yir-drawing')?.getAttribute('aria-valuenow')) >= 40, null, { timeout: 30000 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(out, `sheet-drawing-${tag}.png`) });
  console.log('drawing', await page.$eval('.yir-drawing', (d) => d.getAttribute('aria-valuetext')));
  await page.waitForSelector('.yir-video', { timeout: 60000 });
  console.log('render took', Date.now() - started, 'ms');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(out, `sheet-done-${tag}.png`) });
  console.log('done actions', await page.$$eval('.yir-actions button', (b) => b.map((x) => x.textContent.trim())));
  const download = await Promise.all([page.waitForEvent('download', { timeout: 15000 }),
    page.click('.yir-actions button:last-child')]).then(([d]) => d).catch((e) => e);
  if (download?.suggestedFilename) {
    const file = path.join(out, `download-${tag}-${download.suggestedFilename().replace(/\s+/g, '-')}`);
    await download.saveAs(file);
    console.log('download', download.suggestedFilename(), fs.statSync(file).size, 'bytes');
    probe(file);
  } else console.log('download failed', String(download));

  console.log(errors.length ? 'CONSOLE:\n' + errors.join('\n') : 'no errors');
  await browser.close();
})();

function probe(file) {
  try {
    const json = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries',
      'format=duration,size,format_name:stream=codec_name,width,height,avg_frame_rate,r_frame_rate,nb_read_frames,duration',
      '-of', 'json', file]).toString());
    console.log('ffprobe', JSON.stringify(json));
  } catch (e) { console.log('ffprobe failed', e.message); }
}
