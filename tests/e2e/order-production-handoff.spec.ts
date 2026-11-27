import { expect, test } from "@playwright/test";

const BASE_URL = (process.env.E2E_BASE_URL || process.env.E2E_APP_URL || "http://localhost:3000").replace(/\/$/, "");
const DEMO_PASSWORD = "Demo123!";
const READY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  "base64",
);

test.describe("Полный заказ: оплата → производство → передача", () => {
  test("покупатель оплачивает заказ, кондитер проходит чек-лист и передаёт самовывоз через UI", async ({ page, browser }, testInfo) => {
    test.setTimeout(120_000);

    const suffix = Date.now().toString();
    const customerName = `Покупатель E2E ${suffix.slice(-6)}`;
    const email = `e2e-order-${suffix}@example.test`;
    const phone = `+7999${suffix.slice(-7).padStart(7, "0")}`;
    const password = "E2E-Password-2026!";

    // Покупатель регистрируется исключительно через форму сайта.
    await page.goto(`${BASE_URL}/login`);
    await page.getByRole("tab", { name: "Регистрация" }).click();
    await page.getByLabel("Имя / ФИО *").fill(customerName);
    await page.getByLabel("Телефон *").fill(phone);
    await page.getByLabel("Email *").fill(email);
    await page.getByLabel("Пароль *").fill(password);
    await page.getByRole("button", { name: "Покупать торты" }).click();
    await page.locator("#consent-pd").check();
    await page.locator("#consent-terms").check();
    await page.locator("#consent-offer").check();
    await page.getByRole("button", { name: "Зарегистрироваться", exact: true }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 20_000 });

    // Выбор опубликованного тестового торта и оформление самовывоза через UI.
    await page.goto(`${BASE_URL}/catalog`);
    const productCard = page
      .getByRole("link")
      .filter({ hasText: "E2E демо-торт (тестовый товар)" })
      .first();
    await expect(productCard).toBeVisible({ timeout: 20_000 });
    await productCard.getByRole("button", { name: "Добавить в корзину" }).click();

    await page.goto(`${BASE_URL}/checkout`);
    await page.getByRole("button", { name: /Самовывоз/ }).click();
    const pickupDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await page.getByLabel("Дата получения").fill(pickupDate);
    await page.getByLabel("Имя получателя *").fill(customerName);
    await page.getByLabel("Телефон получателя *").fill(phone);
    await page.getByLabel("Город *").fill("Москва");
    await page.getByRole("button", { name: "Продолжить" }).click();
    await expect(page.getByRole("heading", { name: "Подтверждение заказа" })).toBeVisible();
    await page.getByRole("button", { name: "Оплатить" }).click();
    await expect(page.getByRole("heading", { name: "Заказ оформлен!" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Платёж создан в демо-режиме/)).toBeVisible();

    // Второй пользователь — назначенный кондитер. Все дальнейшие действия также выполняются в браузере.
    const isMobile = testInfo.project.name === "mobile-chrome";
    const confectionerContext = await browser.newContext({
      userAgent: "Playwright-E2E/1.0 (+https://conditera.ru)",
      extraHTTPHeaders: { "x-real-ip": "10.250.250.250" },
      viewport: isMobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
      isMobile,
      hasTouch: isMobile,
      deviceScaleFactor: isMobile ? 2 : 1,
    });
    const confectionerPage = await confectionerContext.newPage();

    try {
      await confectionerPage.goto(`${BASE_URL}/login`);
      await confectionerPage.getByLabel("Email").fill("confectioner@demo.ru");
      await confectionerPage.getByLabel("Пароль").fill(DEMO_PASSWORD);
      await confectionerPage.getByRole("button", { name: "Войти", exact: true }).click();
      await confectionerPage.waitForURL(/\/dashboard/, { timeout: 20_000 });
      await confectionerPage.getByRole("button", { name: /Заказы/ }).click();

      const orderCard = confectionerPage
        .getByTestId("confectioner-order-card")
        .filter({ hasText: customerName });
      await expect(orderCard).toBeVisible({ timeout: 20_000 });
      await expect(orderCard).toContainText("E2E демо-торт (тестовый товар)");
      const orderId = await orderCard.getAttribute("data-order-id");
      expect(orderId).toBeTruthy();

      // PENDING → CONFIRMED.
      await orderCard.getByTestId("order-action-confirm").click();
      await expect(orderCard.getByTestId("open-order-workspace")).toBeVisible({ timeout: 15_000 });
      await orderCard.getByTestId("open-order-workspace").click();

      const workspace = confectionerPage.getByTestId("order-workspace-dialog");
      await expect(workspace).toBeVisible({ timeout: 15_000 });

      // CONFIRMED → IN_PRODUCTION.
      const startProduction = workspace.getByTestId("order-action-production-start");
      await expect(startProduction).toBeEnabled({ timeout: 15_000 });
      await startProduction.click();

      // Каждый производственный этап отмечается в интерфейсе, а не обходится API-вызовом.
      const uncheckedStages = workspace.locator('button[aria-label^="Отметить выполненным:"]');
      const stageCount = await uncheckedStages.count();
      expect(stageCount).toBeGreaterThan(0);
      for (let index = 0; index < stageCount; index += 1) {
        await uncheckedStages.first().click();
        await expect(uncheckedStages).toHaveCount(stageCount - index - 1, { timeout: 10_000 });
      }

      const completeStages = workspace.getByTestId("order-action-production-complete");
      await expect(completeStages).toBeEnabled({ timeout: 15_000 });
      await completeStages.click();

      // Обязательное оригинальное фото готового торта загружается в приватное хранилище через UI.
      const readyPhoto = workspace.getByTestId("ready-photo-input");
      await expect(readyPhoto).toBeVisible({ timeout: 15_000 });
      await readyPhoto.setInputFiles({
        name: "e2e-ready-cake.png",
        mimeType: "image/png",
        buffer: READY_PNG,
      });
      await expect(confectionerPage.getByText("Фото готового заказа сохранено")).toBeVisible({ timeout: 15_000 });

      // IN_PRODUCTION → READY → DELIVERED (самовывоз).
      const markReady = workspace.getByTestId("order-action-ready");
      await expect(markReady).toBeEnabled({ timeout: 15_000 });
      await markReady.click();

      const handoff = workspace.getByTestId("order-action-handoff");
      await expect(handoff).toBeEnabled({ timeout: 15_000 });
      const handoffResponsePromise = confectionerPage.waitForResponse((response) =>
        response.url().endsWith(`/api/orders/${orderId}/handoff`) &&
        response.request().method() === "POST",
      );
      await handoff.click();
      const handoffResponse = await handoffResponsePromise;
      expect(handoffResponse.ok()).toBeTruthy();
      const handoffPayload = await handoffResponse.json();
      expect(JSON.stringify(handoffPayload)).toMatch(/DELIVERED|delivered/);

      // Покупатель видит завершённую передачу в своём кабинете.
      await page.goto(`${BASE_URL}/dashboard`);
      await expect(page.getByText(/Доставлен|Получен/).first()).toBeVisible({ timeout: 20_000 });

      const logout = confectionerPage.getByRole("button", { name: /Выйти/ }).first();
      if (await logout.count()) await logout.click().catch(() => undefined);
    } finally {
      await confectionerContext.close();
    }
  });
});
