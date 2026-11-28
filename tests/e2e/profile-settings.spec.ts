import { expect, test, type Browser } from "@playwright/test";

const BASE_URL = (process.env.E2E_BASE_URL || process.env.E2E_APP_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const DEMO_PASSWORD = "Demo123!";
const PROFILE_CUSTOMER_EMAIL = process.env.PROFILE_E2E_CUSTOMER_EMAIL || "profile-customer-local@e2e.conditera.test";
const PROFILE_CONFECTIONER_EMAIL = process.env.PROFILE_E2E_CONFECTIONER_EMAIL || "profile-confectioner-local@e2e.conditera.test";

async function verifyRoleProfile(
  browser: Browser,
  email: string,
  roleLabel: string,
  roleTab: string,
  forbiddenProfileName?: string,
): Promise<string> {
  const context = await browser.newContext({
    userAgent: "Playwright-E2E/1.0 (+https://conditera.ru)",
    extraHTTPHeaders: { "x-real-ip": "10.249.249.249" },
  });
  const page = await context.newPage();
  const suffix = Date.now().toString(36);
  const updatedName = `Проверка ${roleLabel} ${suffix}`;
  const updatedPhone = `+7999${suffix.slice(-7).padStart(7, "0")}`;
  const updatedBio = `Проверка сохранения профиля ${roleLabel} ${suffix}`;

  try {
    await page.goto(`${BASE_URL}/login`);
    // Стабильные id полей формы входа: на модалке также есть вкладка регистрации.
    await page.locator("#login-email").fill(email);
    await page.locator("#login-password").fill(DEMO_PASSWORD);
    const loginResponsePromise = page.waitForResponse((response) =>
      response.url().endsWith("/api/auth/login") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    const loginResponse = await loginResponsePromise;
    const loginPayload = await loginResponse.json().catch(() => ({}));
    expect(
      loginResponse.status(),
      `Login rejected for ${email}: ${JSON.stringify(loginPayload)}`,
    ).toBe(200);
    await page.waitForURL(/\/dashboard/, { timeout: 20_000 });

    await expect(page.getByRole("button", { name: roleTab, exact: true })).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Настройки", exact: true }).click();
    const nameField = page.locator("#name");
    const phoneField = page.locator("#phone");
    const bioField = page.locator("#bio");
    await expect(nameField).toBeVisible({ timeout: 15_000 });
    // Разные сессии обязаны видеть собственные данные, а не результат другого аккаунта.
    await expect(nameField).not.toHaveValue(new RegExp("^Проверка "));
    if (forbiddenProfileName) {
      await expect(nameField).not.toHaveValue(forbiddenProfileName);
    }
    await nameField.fill(updatedName);
    await phoneField.fill(updatedPhone);
    await bioField.fill(updatedBio);

    const saveResponse = page.waitForResponse((response) =>
      response.url().endsWith("/api/profile") && response.request().method() === "PATCH",
    );
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    const response = await saveResponse;
    expect(response.status(), `PATCH profile failed for ${email}`).toBe(200);

    await page.reload();
    await page.getByRole("button", { name: "Настройки", exact: true }).click();
    await expect(page.locator("#name")).toHaveValue(updatedName, { timeout: 15_000 });
    await expect(page.locator("#phone")).toHaveValue(updatedPhone);
    await expect(page.locator("#bio")).toHaveValue(updatedBio);

    const profileResponse = await page.request.get(`${BASE_URL}/api/profile`);
    expect(profileResponse.status()).toBe(200);
    const payload = await profileResponse.json();
    expect(payload.profile).toMatchObject({ name: updatedName, phone: updatedPhone, bio: updatedBio });
    return updatedName;
  } finally {
    await page.request.post(`${BASE_URL}/api/auth/logout`).catch(() => undefined);
    await context.close();
  }
}

test.describe("Настройки профиля — сквозное сохранение по ролям", () => {
  test("покупатель и кондитер сохраняют изменения и видят их после перезагрузки", async ({ browser }) => {
    test.setTimeout(120_000);
    const hostname = new URL(BASE_URL).hostname;
    if (!["127.0.0.1", "localhost", "::1"].includes(hostname)) {
      throw new Error("Проверка демо-профилей разрешена только против локального тестового сервера.");
    }
    const customerName = await verifyRoleProfile(
      browser, PROFILE_CUSTOMER_EMAIL, "покупатель", "Мои заказы",
    );
    await verifyRoleProfile(
      browser, PROFILE_CONFECTIONER_EMAIL, "кондитер", "Заказы", customerName,
    );
  });
});
