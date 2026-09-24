// screenshot-new-dashboards.js — делает скриншоты 4 новых дашбордов
// через симуляцию роли в useAppStore

const { chromium } = require('/home/z/my-project/node_modules/playwright');
const execPath = '/home/z/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell';

const dashboards = [
  { role: 'ANIMATOR_AGENCY', name: 'animator-agency-dashboard', title: 'Агентство аниматоров' },
  { role: 'RECREATION_CENTER', name: 'recreation-center-dashboard', title: 'Развлекательный центр' },
  { role: 'KIDS_CLUB', name: 'kids-club-dashboard', title: 'Детский клуб' },
  { role: 'INSPECTOR', name: 'inspector-dashboard', title: 'Внутренний инспектор' },
];

(async () => {
  for (const d of dashboards) {
    const browser = await chromium.launch({
      headless: true,
      executablePath: execPath,
      args: ['--single-process', '--no-zygote', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-extensions', '--disable-background-networking', '--disable-default-apps', '--disable-translate', '--disable-sync', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--js-flags=--max-old-space-size=128']
    });

    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      ignoreHTTPSErrors: true,
    });

    // Внедряем скрипт для авторизации и установки роли до загрузки страницы
    await context.addInitScript((role) => {
      // useAppStore из zustand persist хранит state в localStorage под ключом "conditera-storage"
      const user = {
        id: 'test-' + role.toLowerCase(),
        name: 'Test ' + role,
        email: `test-${role.toLowerCase()}@example.com`,
        avatar: 'https://i.pravatar.cc/100?u=' + role,
        roles: [role],
      };
      // zustand persist expects { state: {...}, version: N }
      const state = {
        state: {
          user: user,
          activeRole: role,
          isAuthenticated: true,
          nav: { view: 'dashboard-extra', params: {} },
        },
        version: 0,
      };
      localStorage.setItem('conditera-storage', JSON.stringify(state));
    }, d.role);

    const page = await context.newPage();
    process.stderr.write(`[${d.name}] opening... `);

    try {
      await page.goto('http://127.0.0.1:3000/dashboard', {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Подождать чуть больше для SP-роутинга
      await page.waitForTimeout(3000);

      const outPath = `/home/z/my-project/download/screenshots/${d.name}.png`;
      await page.screenshot({ path: outPath, fullPage: false });
      process.stderr.write(`OK\n`);
    } catch (e) {
      process.stderr.write(`FAIL: ${e.message.slice(0, 100)}\n`);
    }

    await page.close();
    await context.close();
    await browser.close();
  }

  process.stderr.write('Done\n');
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
