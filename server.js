const express = require('express');
const { chromium } = require('playwright-core');

const app = express();
app.use(express.json({ limit: '64kb' }));

const PORT = Number(process.env.PORT || 3000);
const SECRET = String(process.env.PUNM_COVER_SERVICE_SECRET || '');
const BROWSERLESS_TOKEN = String(process.env.BROWSERLESS_TOKEN || '');
const BROWSERLESS_ENDPOINT = String(process.env.BROWSERLESS_ENDPOINT || 'wss://production-sfo.browserless.io').replace(/\/+$/, '');
const ALLOWED_ORIGIN = String(process.env.PUNM_ALLOWED_ORIGIN || 'https://payusnomind.info').replace(/\/+$/, '');

if (!SECRET) throw new Error('PUNM_COVER_SERVICE_SECRET is required.');
if (!BROWSERLESS_TOKEN) throw new Error('BROWSERLESS_TOKEN is required.');

function authorized(req) {
  return req.get('authorization') === `Bearer ${SECRET}`;
}

function isAllowedRenderUrl(value) {
  try {
    const url = new URL(value);
    const allowed = new URL(ALLOWED_ORIGIN);
    return url.protocol === 'https:' && url.origin === allowed.origin && url.pathname === '/blog/cover-render.php';
  } catch {
    return false;
  }
}

async function getBrowser() {
  const endpoint = `${BROWSERLESS_ENDPOINT}?token=${encodeURIComponent(BROWSERLESS_TOKEN)}`;
  return chromium.connectOverCDP(endpoint);
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, browser: 'browserless' });
});

app.post('/generate', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ ok: false, error: 'Unauthorized.' });

  const { renderUrl, width = 1600, height = 900, selector = '#punm-cover' } = req.body || {};
  if (!isAllowedRenderUrl(renderUrl)) return res.status(400).json({ ok: false, error: 'Invalid render URL.' });

  const safeWidth = Math.max(320, Math.min(2400, Number(width) || 1600));
  const safeHeight = Math.max(180, Math.min(2400, Number(height) || 900));

  let browser;
  let page;
  try {
    browser = await getBrowser();
    const contexts = browser.contexts();
    if (!contexts.length) throw new Error('Browserless returned no browser context.');
    page = await contexts[0].newPage();
    await page.setViewportSize({ width: safeWidth, height: safeHeight });

    await page.goto(renderUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#punm-cover', { state: 'visible', timeout: 10000 });
    await page.waitForTimeout(1500);

    const target = page.locator(selector);
    await target.waitFor({ state: 'visible', timeout: 10000 });
    const png = await target.screenshot({ type: 'png', animations: 'disabled' });

    res.set({ 'Content-Type': 'image/png', 'Content-Length': String(png.length), 'Cache-Control': 'no-store' });
    return res.status(200).send(png);
  } catch (error) {
    console.error('Cover generation error:', error);
    return res.status(500).json({ ok: false, error: 'Screenshot generation failed.' });
  } finally {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
});

app.listen(PORT, () => {
  console.log(`Payusnomind cover service listening on ${PORT}`);
  console.log('Browser engine: Browserless Cloud');
});
