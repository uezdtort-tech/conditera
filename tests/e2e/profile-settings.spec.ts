import { expect, test, type Browser } from "@playwright/test";

const BASE_URL = (process.env.E2E_BASE_URL || process.env.E2E_APP_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const DEMO_PASSWORD = "Demo123!";

async function verifyRoleProfile(browser: Browser, email: string, roleLabel: string): Promise<void> {
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
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Пароль").fill(DEMO_PASSWORD);
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 20_000 });

    await page.getByRole("button", { name: "Настройки", exact: true }).click();
    await expect(page.getByLabel("Имя")).toBeVisible({ timeout: 15_000 });
    await page.getByLabel("Имя").fill(updatedName);
    await page.getByLabel("Телефон").fill(updatedPhone);
    await page.getByLabel("О себе").fill(updatedBio);

    const saveResponse = page.waitForResponse((response) =>
      response.url().endsWith("/api/profile") && response.request().method() === "PATCH",
    );
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    const response = await saveResponse;
    expect(response.status(), `PATCH profile failed for ${email}`).toBe(200);

    await page.reload();
    await page.getByRole("button", { name: "Настройки", exact: true }).click();
    await expect(page.getByLabel("Имя")).toHaveValue(updatedName, { timeout: 15_000 });
    await expect(page.getByLabel("Телефон")).toHaveValue(updatedPhone);
    await expect(page.getByLabel("О себе")).toHaveValue(updatedBio);

    const profileResponse = await page.request.get(`${BASE_URL}/api/profile`);
    expect(profileResponse.status()).toBe(200);
    const payload = await profileResponse.json();
    expect(payload.profile).toMatchObject({ name: updatedName, phone: updatedPhone, bio: updatedBio });
  } finally {
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
    await verifyRoleProfile(browser, "customer@demo.ru", "покупатель");
    await verifyRoleProfile(browser, "confectioner@demo.ru", "кондитер");
  });
});
