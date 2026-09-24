// screenshot-all-26-dashboards.js — Live Preview всех 26 ролей

const { chromium } = require('/home/z/my-project/node_modules/playwright');
const execPath = '/home/z/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell';

// Все 26 ролей (5 базовых + 3 модерация + 10 расширенных + 8 нишевых)
const dashboards = [
  // Базовые
  { role: 'CUSTOMER', name: '01-customer-dashboard' },
  { role: 'CONFECTIONER', name: '02-confectioner-dashboard' },
  { role: 'SUPPLIER', name: '03-supplier-dashboard' },
  { role: 'COURIER', name: '04-courier-dashboard' },
  { role: 'ADMIN', name: '05-admin-dashboard' },
  // Модерация
  { role: 'MODERATOR', name: '06-moderator-dashboard' },
  { role: 'SUPPORT', name: '07-support-dashboard' },
  // Расширенные
  { role: 'BLOGGER', name: '08-blogger-dashboard' },
  { role: 'TASTER', name: '09-taster-dashboard' },
  { role: 'FRANCHISEE', name: '10-franchisee-dashboard' },
  { role: 'NUTRITIONIST', name: '11-nutritionist-dashboard' },
  { role: 'CORPORATE_CLIENT', name: '12-corporate-client-dashboard' },
  { role: 'COPYWRITER', name: '13-copywriter-dashboard' },
  { role: 'QUALITY_INSPECTOR', name: '14-quality-inspector-dashboard' },
  { role: 'CERTIFICATION_AGENT', name: '15-certification-agent-dashboard' },
  { role: 'FOOD_SERVICE', name: '16-food-service-dashboard' },
  { role: 'EVENT_ORGANIZER', name: '17-event-organizer-dashboard' },
  { role: 'PICKUP_POINT', name: '18-pickup-point-dashboard' },
  { role: 'WHOLESALER', name: '19-wholesaler-dashboard' },
  { role: 'STUDIO', name: '20-studio-dashboard' },
  // Нишевые
  { role: 'VENUE_OWNER', name: '21-venue-owner-dashboard' },
  { role: 'ANIMATOR_AGENCY', name: '22-animator-agency-dashboard' },
  { role: 'RECREATION_CENTER', name: '23-recreation-center-dashboard' },
  { role: 'KIDS_CLUB', name: '24-kids-club-dashboard' },
  { role: 'INSPECTOR', name: '25-inspector-dashboard' },
];

(async () => {
  let ok = 0;
  let fail = 0;

  for (const d of dashboards) {
    const browser = await chromium.launch({
      headless: true,
      executablePath: execPath,
      args: ['--single-process', '--no-zygote', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-extensions', '--disable-background-networking', '--disable-default-apps', '--disable-translate', '--disable-sync', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--js-flags=--max-old-space-size=64']
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: true,
    });

    // Inject user role into zustand persist
    await context.addInitScript((role) => {
      const user = {
        id: 'test-' + role.toLowerCase(),
        name: 'Test ' + role.replace(/_/g, ' '),
        email: `test-${role.toLowerCase()}@example.com`,
        avatar: 'https://i.pravatar.cc/100?u=' + role,
        roles: [role],
      };
      const state = {
        state: {
          user, activeRole: role, isAuthenticated: true,
          nav: { view: 'dashboard-extra', params: {} },
        },
        version: 0,
      };
      localStorage.setItem('conditera-storage', JSON.stringify(state));
    }, d.role);

    const page = await context.newPage();

    try {
      await page.goto('http://127.0.0.1:3000/dashboard', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await page.waitForTimeout(2500);

      const outPath = `/home/z/my-project/download/screenshots/all-26/${d.name}.png`;
      await page.screenshot({ path: outPath, fullPage: false });
      process.stderr.write(`[${d.name}] OK\n`);
      ok++;
    } catch (e) {
      process.stderr.write(`[${d.name}] FAIL: ${e.message.slice(0, 60)}\n`);
      fail++;
    }

    await page.close();
    await context.close();
    await browser.close();
  }

  process.stderr.write(`\nDone: ${ok} OK, ${fail} FAIL out of ${dashboards.length}\n`);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
