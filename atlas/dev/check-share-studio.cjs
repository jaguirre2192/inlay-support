// Clicks through the share studio (dev/share-harness.html?mode=studio): every design, both sizes and
// tones, the context menus, Download PNG; checks each card finishes and nothing throws.
//   NODE_PATH=<dir holding playwright> node atlas/dev/check-share-studio.cjs [webkit|chromium] [lang]
const { webkit, chromium } = require('playwright');
const path = require('path');

(async () => {
  const engine = process.argv[2] ?? 'webkit', lang = process.argv[3] ?? 'en';
  const options = process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {};
  const browser = await (engine === 'chromium' ? chromium : webkit).launch(options);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`http://localhost:8093/atlas/dev/share-harness.html?mode=studio&lang=${lang}`);
  const ready = async () => {
    await page.waitForSelector('.share-card[data-ready="true"]', { timeout: 30000 });
    return page.$eval('.share-card', (c) => [c.width, c.height, c.getAttribute('aria-label')]);
  };
  console.log('open', await ready());
  const designs = await page.$$eval('.share-design', (b) => b.map((x) => x.textContent.trim()));
  console.log('designs', designs);
  for (let i = 0; i < designs.length; i++) {
    await page.click(`.share-design >> nth=${i}`);
    await page.waitForTimeout(50);
    console.log(designs[i], await ready());
    for (const [seg, n] of [[0, 1], [1, 1], [0, 0], [1, 0]]) {
      await page.click(`.share-seg >> nth=${seg} >> button >> nth=${n}`);
      await page.waitForTimeout(50);
      const [w, h] = await ready();
      if (seg === 0) console.log('  size', n ? 'post' : 'story', w, h);
    }
    const select = await page.$('.share-menu select');
    if (select) {
      const values = await select.$$eval('option', (o) => o.map((x) => x.value));
      await select.selectOption(values[1] ?? values[0]);
      await page.waitForTimeout(50);
      console.log('  menu', values.slice(0, 4).join(','), '→', values[1] ?? values[0], (await ready())[2]);
    }
  }
  const download = await Promise.all([page.waitForEvent('download', { timeout: 15000 }),
    page.click('.share-actions button:has-text("PNG"), .share-actions button:has-text("PNG")')]).then(([d]) => d).catch((e) => e);
  if (download?.suggestedFilename) {
    const file = path.join(__dirname, 'share-samples', '_download-check.png');
    await download.saveAs(file);
    console.log('download', download.suggestedFilename(), require('fs').statSync(file).size, 'bytes');
    require('fs').unlinkSync(file);
  } else console.log('download failed', String(download));
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no errors');
  await browser.close();
})();
