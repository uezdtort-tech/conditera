// screenshot-auth-flow.js — скриншоты auth flow (login, register, reset-password)

const { chromium } = require('/home/z/my-project/node_modules/playwright');
const execPath = '/home/z/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell';

const pages = [
  { url: 'http://127.0.0.1:3000/login', name: 'login-page' },
  { url: 'http://127.0.0.1:3000/auth/reset-password', name: 'reset-password-page' },
];

(async () => {
  for (const p of pages) {
    const browser = await chromium.launch({
      headless: true,
      executablePath: execPath,
      args: ['--single-process', '--no-zygote', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=64']
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: true,
    });

    const page = await context.newPage();
    process.stderr.write(`[${p.name}] opening ${p.url}... `);

    try {
      await page.goto(p.url, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await page.waitForTimeout(2500);

      const outPath = `/home/z/my-project/download/screenshots/auth-flow/${p.name}.png`;
      await page.screenshot({ path: outPath, fullPage: false });
      process.stderr.write(`OK\n`);
    } catch (e) {
      process.stderr.write(`FAIL: ${e.message.slice(0, 60)}\n`);
    }

    await page.close();
    await context.close();
    await browser.close();
  }

  process.stderr.write('Done\n');
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
