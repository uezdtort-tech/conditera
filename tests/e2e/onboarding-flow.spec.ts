/**
 * E2E: Полный onboarding-флоу кондитера (v3 ТЗ, задача High-6).
 *
 * Сценарий:
 *   1. Регистрация CONFECTIONER (POST /api/auth/register с role=CONFECTIONER)
 *   2. Onboarding: POST /api/confectioner/onboarding (multipart, ИНН 7700000123)
 *   3. Проверка /api/confectioner/status → verificationStatus: pending | approved
 *      (approved — если DaData вернула ACTIVE и auto-approve сработал)
 *   4. Если pending — POST /api/admin/confectioners/approve от имени админа
 *   5. GET /api/confectioners содержит нового кондитера (verified)
 *   6. Главная страница: бегущая строка показывает нового кондитера
 *   7. /sitemap.xml содержит /confectioners/<slug>
 *
 * ПРЕДУСЛОВИЯ (запускается только против полного стека):
 *   - docker-compose.supabase.yml поднят (Kong :8000, GoTrue, PostgREST, Storage)
 *   - миграции 0001..0026 применены
 *   - .env.local заполнен (SUPABASE_URL и т.д.)
 *   - для шага 4 нужен админ: регистрация через Studio/seed, роль ADMIN
 *
 * Запуск: npm run test:e2e -- tests/e2e/onboarding-flow.spec.ts
 */
import { expect, test } from "@playwright/test";

const APP = process.env.E2E_APP_URL || "http://localhost:3000";

const TS = Date.now();
const CONFECTIONER = {
  email: `e2e-conf-${TS}@e2e.conditera.ru`,
  password: "E2e-Str0ng-Pass!2026",
  name: "E2E Тестовая Кондитерская",
};

const ADMIN = {
  email: process.env.E2E_ADMIN_EMAIL || "admin@e2e.conditera.ru",
  password: process.env.E2E_ADMIN_PASSWORD || "Admin-Str0ng-Pass!2026",
};

const PORTFOLIO_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test.describe("Onboarding flow кондитера", () => {
  test("register → onboarding → approve → marquee → sitemap", async ({ request, page }) => {
    test.skip(
      process.env.E2E_FULL_STACK !== "1",
      "Требуется полный Supabase-стек (docker-compose.supabase.yml). Запуск: E2E_FULL_STACK=1 npm run test:e2e",
    );

    // ── 1. Регистрация CONFECTIONER ──────────────────────────────
    const regRes = await request.post(`${APP}/api/auth/register`, {
      data: {
        email: CONFECTIONER.email,
        password: CONFECTIONER.password,
        name: "E2E Кондитер",
        role: "CONFECTIONER",
      },
    });
    expect(regRes.ok(), `register failed: ${regRes.status()} ${await regRes.text()}`).toBeTruthy();

    // ── 2. Логин (получаем cookies сессии) ───────────────────────
    const loginRes = await request.post(`${APP}/api/auth/login`, {
      data: { email: CONFECTIONER.email, password: CONFECTIONER.password },
    });
    expect(loginRes.ok(), "login failed").toBeTruthy();

    // ── 3. Onboarding (multipart) ────────────────────────────────
    const multipart = {
      businessName: CONFECTIONER.name,
      description: "E2E-кондитер: торты на заказ, автотест onboarding-флоу проекта.",
      city: "Москва",
      legalStatus: "IP",
      inn: "7700000123", // валидный ИП ИНН → возможен auto-approve через DaData (stub в dev)
      specialization: JSON.stringify(["Торты"]),
      selfPickup: "true",
      portfolioFiles: [
        {
          name: "work.png",
          mimeType: "image/png",
          buffer: PORTFOLIO_PNG,
        },
      ],
    };
    const onbRes = await request.post(`${APP}/api/confectioner/onboarding`, { multipart });
    const onbBody = await onbRes.json().catch(() => ({}));
    // 409 — уже есть строка (повторный прогон) — считается OK
    expect([200, 201, 409]).toContain(onbRes.status());
    if (onbRes.status() === 409) test.info().annotations.push({ type: "note", text: "onboarding 409: профиль уже существует" });

    // ── 4. Статус верификации ────────────────────────────────────
    const statusRes = await request.get(`${APP}/api/confectioner/status`);
    expect(statusRes.ok(), "confectioner/status failed").toBeTruthy();
    const status = await statusRes.json();
    expect(["pending", "approved"]).toContain(status.verificationStatus);

    // ── 5. Если pending — админ одобряет ─────────────────────────
    if (status.verificationStatus === "pending") {
      const adminLogin = await request.post(`${APP}/api/auth/login`, {
        data: { email: ADMIN.email, password: ADMIN.password },
      });
      expect(adminLogin.ok(), "admin login failed").toBeTruthy();

      const pendingRes = await request.get(`${APP}/api/admin/confectioners/pending`);
      expect(pendingRes.ok(), "admin/confectioners/pending failed").toBeTruthy();
      const pending = await pendingRes.json();
      const row = (pending.items ?? pending.confectioners ?? []).find(
        (c: { businessName?: string }) => c.businessName === CONFECTIONER.name,
      );
      expect(row, "новый кондитер в очереди на одобрение").toBeTruthy();

      const approveRes = await request.post(`${APP}/api/admin/confectioners/approve`, {
        data: { confectionerId: row.id },
      });
      expect(approveRes.ok(), `approve failed: ${approveRes.status()}`).toBeTruthy();
    }

    // ── 6. Публичный список верифицированных ─────────────────────
    const listRes = await request.get(`${APP}/api/confectioners`);
    expect(listRes.ok(), "GET /api/confectioners failed").toBeTruthy();
    const list = await listRes.json();
    const items = Array.isArray(list) ? list : (list.items ?? list.confectioners ?? []);
    expect(
      items.some((c: { businessName?: string }) => c.businessName === CONFECTIONER.name),
      "новый кондитер в публичном списке verified",
    ).toBeTruthy();

    // ── 7. Бегущая строка на главной ─────────────────────────────
    await page.goto(APP, { waitUntil: "networkidle" });
    const marquee = page.locator("text=" + CONFECTIONER.name).first();
    await expect(marquee).toBeVisible({ timeout: 15_000 });

    // ── 8. Sitemap содержит slug нового кондитера ────────────────
    const sitemapRes = await request.get(`${APP}/sitemap.xml`);
    expect(sitemapRes.ok(), "sitemap.xml failed").toBeTruthy();
    const sitemap = await sitemapRes.text();
    const slugRow = items.find((c: { businessName?: string }) => c.businessName === CONFECTIONER.name);
    if (slugRow?.slug) {
      expect(sitemap).toContain(slugRow.slug);
    }
  });

  test("smoke: публичные страницы отвечают (без стека)", async ({ request, page }) => {
    // Группа дымовых проверок, работающих и БЕЗ Supabase (mock-fallback):
    const health = await request.get(`${APP}/api/health`);
    expect(health.ok(), "health check").toBeTruthy();

    const list = await request.get(`${APP}/api/confectioners`);
    // 200 (mock-fallback или live) — иначе приложение деградировало
    expect([200]).toContain(list.status());

    await page.goto(APP, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveTitle(/Уездный кондитер/i);
  });
});
