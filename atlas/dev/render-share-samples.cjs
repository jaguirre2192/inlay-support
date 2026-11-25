// Renders every share card design × format × tone from dev/share-harness.html into
// dev/share-samples/, plus screenshots of the studio at 390, 768 and 1440 px, light and dark.
//   NODE_PATH=<dir holding playwright> node atlas/dev/render-share-samples.cjs [webkit|chromium] [lang]
//     [--query=place=JP&year=2024 --designs=passport,year --tag=name] [--small] [--studio]
// The site must be served at http://localhost:8093/.
const { webkit, chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const engine = process.argv[2] ?? 'webkit';
  const lang = process.argv[3] ?? 'en';
  const out = path.join(__dirname, 'share-samples');
  fs.mkdirSync(out, { recursive: true });
  const options = process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {};
  const browser = await (engine === 'chromium' ? chromium : webkit).launch(options);
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const base = 'http://localhost:8093/atlas/dev/share-harness.html';
  const suffix = engine === 'chromium' ? '-chromium' : '';
  const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  // --query=place=JP&year=2024 --designs=passport,year --tag=variant
  const query = arg('query') ? `&${arg('query')}` : '';
  const only = arg('designs')?.split(',');
  const tag = (lang === 'en' ? '' : `-${lang}`) + (arg('tag') ? `-${arg('tag')}` : '');

  await page.goto(`${base}?lang=${lang}${query}`);
  await page.waitForFunction(() => window.harnessReady, null, { timeout: 60000 });
  const cards = await page.evaluate((d) => window.renderAll(d ?? undefined), only ?? null);
  for (const [key, card] of Object.entries(cards)) {
    fs.writeFileSync(path.join(out, `${key}${tag}${suffix}.png`), Buffer.from(card.url.split(',')[1], 'base64'));
    console.log(`${key}${tag}${suffix}.png`, card.size.join('×'), '·', card.label);
  }

  if (process.argv.includes('--small')) {
    await page.goto(`${base}?small=1&lang=${lang}`);
    await page.waitForFunction(() => window.harnessReady, null, { timeout: 60000 });
    const few = await page.evaluate(() => window.renderAll(['atlas', 'stamps', 'year']));
    for (const [key, card] of Object.entries(few)) {
      if (!key.includes('story-paper') && !key.includes('post-night')) continue;
      fs.writeFileSync(path.join(out, `few-${key}${lang === 'en' ? '' : `-${lang}`}${suffix}.png`), Buffer.from(card.url.split(',')[1], 'base64'));
      console.log(`few-${key}${lang === 'en' ? '' : `-${lang}`}${suffix}.png`, '·', card.label);
    }
  }

  if (process.argv.includes('--studio')) {
    for (const [w, h] of [[390, 844], [768, 1024], [1440, 900]]) for (const theme of ['light', 'dark']) {
      const p = await browser.newPage({ viewport: { width: w, height: h } });
      p.on('pageerror', (e) => errors.push(e.message));
      await p.goto(`${base}?mode=studio&theme=${theme}&lang=${lang}`);
      await p.waitForSelector('.share-card[data-ready="true"]', { timeout: 60000 });
      await p.waitForTimeout(400);
      await p.screenshot({ path: path.join(out, `studio-${w}-${theme}${tag}${suffix}.png`) });
      console.log(`studio-${w}-${theme}${tag}${suffix}.png`);
      await p.close();
    }
  }
  if (errors.length) console.log('ERRORS:\n' + errors.join('\n'));
  await browser.close();
})();
