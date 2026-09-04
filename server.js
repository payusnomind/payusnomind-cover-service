process.env.PLAYWRIGHT_BROWSERS_PATH = '0';

const express = require('express');
const { chromium } = require('playwright');

const app = express();
app.use(express.json({ limit: '64kb' }));

const PORT = Number(process.env.PORT || 3000);
const SECRET = String(process.env.PUNM_COVER_SERVICE_SECRET || '');
const ALLOWED_ORIGIN = String(
  process.env.PUNM_ALLOWED_ORIGIN || 'https://payusnomind.info'
).replace(/\/+$/, '');

if (!SECRET) {
  throw new Error('PUNM_COVER_SERVICE_SECRET is required.');
}

let browserPromise;

function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    }).catch((error) => {
      browserPromise = undefined;
      throw error;
    });
  }

  return browserPromise;
}

function authorized(req) {
  return req.get('authorization') === `Bearer ${SECRET}`;
}

function isAllowedRenderUrl(value) {
  try {
    const url = new URL(value);
    const allowed = new URL(ALLOWED_ORIGIN);

    if (url.protocol !== 'https:') return false;
    if (url.origin !== allowed.origin) return false;
    if (url.pathname !== '/blog/cover-render.php') return false;

    return true;
  } catch {
    return false;
  }
}

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    browserPath: chromium.executablePath()
  });
});

app.post('/generate', async (req, res) => {
  if (!authorized(req)) {
    return res.status(401).json({
      ok: false,
      error: 'Unauthorized.'
    });
  }

  const {
    renderUrl,
    width = 1600,
    height = 900,
    selector = '#punm-cover'
  } = req.body || {};

  if (!isAllowedRenderUrl(renderUrl)) {
    return res.status(400).json({
      ok: false,
      error: 'Invalid render URL.'
    });
  }

  const safeWidth = Math.max(
    320,
    Math.min(2400, Number(width) || 1600)
  );

  const safeHeight = Math.max(
    180,
    Math.min(1800, Number(height) || 900)
  );

  let page;

  try {
    const browser = await getBrowser();

    page = await browser.newPage({
      viewport: {
        width: safeWidth,
        height: safeHeight
      },
      deviceScaleFactor: 1
    });

    await page.goto(renderUrl, {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    await page.waitForTimeout(900);

    const target = page.locator(selector);

    await target.waitFor({
      state: 'visible',
      timeout: 10000
    });

    const png = await target.screenshot({
      type: 'png',
      animations: 'disabled'
    });

    res.set({
      'Content-Type': 'image/png',
      'Content-Length': String(png.length),
      'Cache-Control': 'no-store'
    });

    return res.status(200).send(png);

  } catch (error) {
    console.error('Cover generation error:', error);

    return res.status(500).json({
      ok: false,
      error: 'Screenshot generation failed.'
    });

  } finally {
    if (page) {
      await page.close().catch(() => {});
    }
  }
});

async function shutdown() {
  try {
    if (browserPromise) {
      const browser = await browserPromise;
      await browser.close();
    }
  } finally {
    process.exit(0);
  }
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

app.listen(PORT, () => {
  console.log(
    `Payusnomind cover service listening on ${PORT}`
  );

  console.log(
    'Playwright Chromium path:',
    chromium.executablePath()
  );
});
