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
  // Уникальное имя: повторные прогоны создают новые строки, approve должен
  // одобрять строку ИМЕННО этого прогона (иначе marquee-проверка ложно падает).
  name: `E2E Тестовая Кондитерская ${TS}`,
  phone: `+7900${String(TS).slice(-7)}`, // register требует phone (обязательное поле)
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
  // CSRF (double-submit cookie): GET /api/csrf-token ставит httpOnly-cookie и возвращает токен;
  // каждый мутирующий запрос должен нести x-csrf-token.
  async function getCsrf(req: { get: (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }> }): Promise<string> {
    const res = await req.get(`${APP}/api/csrf-token`);
    expect(res.ok(), "csrf-token fetch failed").toBeTruthy();
    return ((await res.json()) as { token: string }).token;
  }

  test("register → onboarding → approve → marquee → sitemap", async ({ request, page }) => {
    const csrf = await getCsrf(request);
    const post = (url: string, opts: Record<string, unknown> = {}) =>
      request.post(url, { ...opts, headers: { "x-csrf-token": csrf, ...(opts.headers as object) } });

    test.skip(
      process.env.E2E_FULL_STACK !== "1",
      "Требуется полный Supabase-стек (docker-compose.supabase.yml). Запуск: E2E_FULL_STACK=1 npm run test:e2e",
    );

    // ── 1. Регистрация CONFECTIONER ──────────────────────────────
    const regRes = await post(`${APP}/api/auth/register`, {
      data: {
        email: CONFECTIONER.email,
        password: CONFECTIONER.password,
        name: "E2E Кондитер",
        phone: CONFECTIONER.phone,
        role: "CONFECTIONER",
      },
    });
    expect(regRes.ok(), `register failed: ${regRes.status()} ${await regRes.text()}`).toBeTruthy();

    // ── 2. Логин (сессия в cookies + legacy JWT accessToken в JSON) ──────
    const loginRes = await post(`${APP}/api/auth/login`, {
      data: { email: CONFECTIONER.email, password: CONFECTIONER.password },
    });
    expect(loginRes.ok(), "login failed").toBeTruthy();
    const { accessToken: confToken } = (await loginRes.json()) as { accessToken: string };
    const confAuth = { Authorization: `Bearer ${confToken}` };

    // ── 3. Onboarding (multipart) ────────────────────────────────
    // Web FormData + File — playwright-совместимый способ передачи файлов:
    // object-multipart playwright НЕ поддерживает массивы значений
    // (isFilePayload({name,mimeType,buffer}) для массива === false → падение на readStreamToJson).
    const multipart = new FormData();
    multipart.append("businessName", CONFECTIONER.name);
    multipart.append("description", "E2E-кондитер: торты на заказ, автотест onboarding-флоу проекта.");
    multipart.append("city", "Москва");
    multipart.append("legalStatus", "IP");
    multipart.append("inn", "7700000123"); // валидный ИП ИНН → возможен auto-approve через DaData (stub в dev)
    multipart.append("specialization", JSON.stringify(["Торты"]));
    multipart.append("selfPickup", "true");
    multipart.append(
      "portfolioFiles",
      new File([PORTFOLIO_PNG], "work.png", { type: "image/png" }),
    );
    const onbRes = await post(`${APP}/api/confectioner/onboarding`, { multipart });
    const onbBody = await onbRes.json().catch(() => ({}));
    // 409 — уже есть строка (повторный прогон) — считается OK
    expect([200, 201, 409]).toContain(onbRes.status());
    if (onbRes.status() === 409) test.info().annotations.push({ type: "note", text: "onboarding 409: профиль уже существует" });

    // ── 4. Статус верификации (legacy Bearer JWT) ──────────────
    const statusRes = await request.get(`${APP}/api/confectioner/status`, {
      headers: confAuth,
    });
    expect(statusRes.ok(), "confectioner/status failed").toBeTruthy();
    const status = await statusRes.json();
    expect(["pending", "approved"]).toContain(status.verificationStatus);

    // ── 5. Если pending — админ одобряет ─────────────────────────
    if (status.verificationStatus === "pending") {
      const adminLogin = await post(`${APP}/api/auth/login`, {
        data: { email: ADMIN.email, password: ADMIN.password },
      });
      expect(adminLogin.ok(), "admin login failed").toBeTruthy();
      const { accessToken: adminToken } = (await adminLogin.json()) as { accessToken: string };
      const adminAuth = { Authorization: `Bearer ${adminToken}` };

      const pendingRes = await request.get(`${APP}/api/admin/confectioners/pending`, {
        headers: adminAuth,
      });
      expect(pendingRes.ok(), "admin/confectioners/pending failed").toBeTruthy();
      const pending = await pendingRes.json();
      const row = (pending.items ?? pending.confectioners ?? []).find(
        (c: { businessName?: string }) => c.businessName === CONFECTIONER.name,
      );
      expect(row, "новый кондитер в очереди на одобрение").toBeTruthy();

      const approveRes = await post(`${APP}/api/admin/confectioners/approve`, {
        data: { confectionerId: row.id },
        headers: adminAuth,
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
