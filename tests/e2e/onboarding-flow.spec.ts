/**
 * Полный E2E онбординг кондитера на PostgreSQL 17 и локальном Storage runtime.
 * Регистрация → профиль/роль/согласия → портфолио → заявка → модерация →
 * публичная витрина → главная страница → sitemap.
 */
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";
import { expect, test } from "@playwright/test";

const APP = process.env.E2E_APP_URL || process.env.E2E_BASE_URL || "http://127.0.0.1:3000";
const RUN_ID = randomUUID();
const RUN_IP = `10.${Math.floor(Math.random() * 200) + 20}.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;
const CONFECTIONER = {
  email: `e2e-conf-${RUN_ID}@e2e.conditera.ru`,
  password: ["E2e", "Str0ng", "Pass!2026"].join("-"),
  name: `E2E Тестовая Кондитерская ${RUN_ID.slice(0, 8)}`,
  phone: `+7${RUN_ID.replace(/\D/g, "").slice(0, 10)}`,
};
const PORTFOLIO_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test.describe("Полный онбординг кондитера — PostgreSQL 17", () => {
  async function csrf(request: { get: (url: string, options?: object) => Promise<{ ok: () => boolean; json: () => Promise<unknown> }> }) {
    const response = await request.get(`${APP}/api/csrf-token`, { headers: { "x-real-ip": RUN_IP } });
    expect(response.ok(), "получение CSRF token").toBeTruthy();
    return ((await response.json()) as { token: string }).token;
  }

  test("register → storage upload → onboarding → approve → listing → home → sitemap", async ({ request, page }) => {
    const csrfToken = await csrf(request);
    const post = (url: string, options: Record<string, unknown> = {}) =>
      request.post(url, {
        ...options,
        headers: {
          "x-real-ip": RUN_IP,
          "x-csrf-token": csrfToken,
          ...((options.headers as Record<string, string> | undefined) || {}),
        },
      });

    const register = await post(`${APP}/api/auth/register`, {
      data: {
        email: CONFECTIONER.email,
        password: CONFECTIONER.password,
        name: CONFECTIONER.name,
        phone: CONFECTIONER.phone,
        role: "CONFECTIONER",
        consentPd: true,
        consentTerms: true,
        consentOffer: true,
        consentMarketing: false,
      },
    });
    expect(register.status(), await register.text()).toBe(201);
    const registered = await register.json() as { user: { id: string; roles: string[] }; accessToken: string; refreshToken: string };
    expect(registered.user?.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(registered.user.roles).toContain("CONFECTIONER");
    expect(registered.accessToken).toBeTruthy();
    expect(registered.refreshToken).toBeTruthy();
    const userId = registered.user.id;
    const auth = { Authorization: `Bearer ${registered.accessToken}` };

    const databaseUrl = process.env.PGURL || process.env.DATABASE_URL;
    expect(databaseUrl, "PGURL/DATABASE_URL обязателен для проверки фактической записи").toBeTruthy();
    const db = new Client({ connectionString: databaseUrl });
    await db.connect();
    try {
      const profile = await db.query(
        "SELECT id::text, email, password_hash FROM public.profiles WHERE id=$1::uuid",
        [userId],
      );
      expect(profile.rowCount).toBe(1);
      expect(profile.rows[0].email).toBe(CONFECTIONER.email);
      expect(profile.rows[0].password_hash).toBeTruthy();

      const role = await db.query(
        "SELECT role, is_active FROM public.user_roles WHERE user_id=$1::uuid AND role='CONFECTIONER'",
        [userId],
      );
      expect(role.rowCount).toBe(1);
      expect(role.rows[0].is_active).toBe(true);

      const consents = await db.query(
        "SELECT consent_type FROM public.user_consent_events WHERE user_id=$1::uuid AND event_type='grant'",
        [userId],
      );
      expect(new Set(consents.rows.map((row) => row.consent_type))).toEqual(
        new Set(["personal_data", "terms", "offer"]),
      );
    } finally {
      await db.end();
    }

    const multipart = new FormData();
    multipart.append("businessName", CONFECTIONER.name);
    multipart.append("description", "E2E-кондитер: изготовление тортов на заказ и проверка полного сценария онбординга.");
    multipart.append("city", "Москва");
    multipart.append("legalStatus", "PHYSICAL");
    multipart.append("specialization", JSON.stringify(["Торты", "Десерты"]));
    multipart.append("selfPickup", "true");
    multipart.append("portfolioFiles", new File([PORTFOLIO_PNG], "portfolio.png", { type: "image/png" }));

    const onboarding = await post(`${APP}/api/confectioner/onboarding`, { multipart, headers: auth });
    expect(onboarding.status(), await onboarding.text()).toBe(200);
    const body = await onboarding.json() as {
      success: boolean;
      confectionerId: string;
      slug: string;
      verificationStatus: string;
      uploadedImages: { portfolio: number };
    };
    expect(body.success).toBe(true);
    expect(body.confectionerId).toBeTruthy();
    expect(body.slug).toBeTruthy();
    expect(body.uploadedImages.portfolio).toBe(1);

    const initialStatusResponse = await request.get(`${APP}/api/confectioner/status`, {
      headers: { ...auth, "x-real-ip": RUN_IP },
    });
    expect(initialStatusResponse.status()).toBe(200);
    const initialStatus = await initialStatusResponse.json() as { verificationStatus: string };
    expect(["pending", "approved"]).toContain(initialStatus.verificationStatus);

    if (initialStatus.verificationStatus === "pending") {
      // Изолированный администратор на каждый проект (desktop/mobile): не
      // используем общий seed-аккаунт и не ослабляем защиту новых устройств.
      const adminRunId = randomUUID();
      const adminRegister = await post(`${APP}/api/auth/register`, {
        data: {
          email: `e2e-admin-${adminRunId}@e2e.conditera.ru`,
          password: ["E2e", "Admin", "Str0ng!2026"].join("-"),
          name: `E2E Администратор ${adminRunId.slice(0, 8)}`,
          phone: `+7${adminRunId.replace(/\D/g, "").slice(0, 10)}`,
          role: "CUSTOMER",
          consentPd: true,
          consentTerms: true,
          consentOffer: true,
          consentMarketing: false,
        },
      });
      expect(adminRegister.status(), await adminRegister.text()).toBe(200);
      const admin = await adminRegister.json() as {
        user: { id: string };
        accessToken: string;
      };

      const adminDb = new Client({ connectionString: databaseUrl });
      await adminDb.connect();
      try {
        await adminDb.query(
          "INSERT INTO public.user_roles (user_id, role, is_active) VALUES ($1::uuid, 'ADMIN', true) ON CONFLICT (user_id, role) DO UPDATE SET is_active = true",
          [admin.user.id],
        );
        const adminRole = await adminDb.query(
          "SELECT is_active FROM public.user_roles WHERE user_id=$1::uuid AND role='ADMIN'",
          [admin.user.id],
        );
        expect(adminRole.rowCount).toBe(1);
        expect(adminRole.rows[0].is_active).toBe(true);
      } finally {
        await adminDb.end();
      }

      const adminAuth = { Authorization: `Bearer ${admin.accessToken}` };

      const pendingResponse = await request.get(`${APP}/api/admin/confectioners/pending`, {
        headers: { ...adminAuth, "x-real-ip": RUN_IP },
      });
      expect(pendingResponse.status(), await pendingResponse.text()).toBe(200);
      const pendingBody = await pendingResponse.json() as {
        items?: Array<{ id: string }>;
        confectioners?: Array<{ id: string }>;
      };
      const pendingItems = pendingBody.items ?? pendingBody.confectioners ?? [];
      expect(pendingItems.some((item) => item.id === body.confectionerId)).toBe(true);

      const approve = await post(`${APP}/api/admin/confectioners/approve`, {
        data: { confectionerId: body.confectionerId },
        headers: adminAuth,
      });
      expect(approve.status(), await approve.text()).toBe(200);
      expect((await approve.json()).success).toBe(true);
    }

    const finalStatusResponse = await request.get(`${APP}/api/confectioner/status`, {
      headers: { ...auth, "x-real-ip": RUN_IP },
    });
    expect(finalStatusResponse.status()).toBe(200);
    const finalStatus = await finalStatusResponse.json() as { verificationStatus: string; canPublish: boolean };
    expect(finalStatus.verificationStatus).toBe("approved");
    expect(finalStatus.canPublish).toBe(true);

    const verifyDb = new Client({ connectionString: databaseUrl });
    await verifyDb.connect();
    try {
      const confectioner = await verifyDb.query(
        'SELECT id, slug, "verificationStatus", verified, "portfolioImages" FROM public.confectioners WHERE id=$1',
        [body.confectionerId],
      );
      expect(confectioner.rowCount).toBe(1);
      expect(confectioner.rows[0].verified).toBe(true);
      expect(confectioner.rows[0].verificationStatus).toBe("approved");
      expect(confectioner.rows[0].slug).toBe(body.slug);
      expect(Array.isArray(confectioner.rows[0].portfolioImages)).toBe(true);
      expect(confectioner.rows[0].portfolioImages.length).toBe(1);

      const storage = await verifyDb.query(
        "SELECT count(*)::int AS count FROM storage.objects WHERE bucket_id='portfolio' AND name LIKE $1",
        [`${userId}/%`],
      );
      expect(storage.rows[0].count).toBe(1);
    } finally {
      await verifyDb.end();
    }

    const portfolioDir = path.join(process.cwd(), "upload", "storage", "portfolio", userId);
    const storedFiles = await readdir(portfolioDir);
    expect(storedFiles.length).toBe(1);

    const publicList = await request.get(`${APP}/api/confectioners?verified_only=true`);
    expect(publicList.status()).toBe(200);
    const publicBody = await publicList.json() as { items?: Array<{ id: string; businessName: string }>; confectioners?: Array<{ id: string; businessName: string }> };
    const publicConfectioner = [...(publicBody.items ?? []), ...(publicBody.confectioners ?? [])].find((item) => item.id === body.confectionerId);
    expect(publicConfectioner).toBeTruthy();
    expect(publicConfectioner?.businessName).toBe(CONFECTIONER.name);

    await page.goto(APP, { waitUntil: "domcontentloaded" });
    await expect(page.getByText(CONFECTIONER.name, { exact: true }).first()).toBeVisible({ timeout: 15000 });

    const sitemap = await request.get(`${APP}/sitemap.xml`);
    expect(sitemap.status()).toBe(200);
    expect(await sitemap.text()).toContain(body.slug);
  });

  test("неавторизованный запрос онбординга отклоняется", async ({ request }) => {
    const response = await request.post(`${APP}/api/confectioner/onboarding`, {
      headers: { "x-real-ip": RUN_IP },
      multipart: {
        businessName: "Тестовая заявка",
        description: "Описание тестовой заявки для проверки отказа без авторизации.",
        city: "Москва",
        legalStatus: "PHYSICAL",
      },
    });
    expect(response.status()).toBe(401);
  });

  test("smoke: публичные страницы отвечают после production onboarding", async ({ request, page }) => {
    const health = await request.get(`${APP}/api/health`);
    expect(health.ok(), "health check").toBeTruthy();
    const list = await request.get(`${APP}/api/confectioners`);
    expect(list.status()).toBe(200);
    await page.goto(APP, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveTitle(/Уездный кондитер/i);
  });
});
