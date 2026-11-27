/**
 * Browser acceptance: customer login → catalog → cart → checkout → order created.
 * This intentionally uses the visible UI for every user action; no direct API
 * calls are made by the test.
 */
import { expect, test } from "@playwright/test";

test.describe("Customer checkout — real browser UI", () => {
  test.use({
    extraHTTPHeaders: { "x-real-ip": "10.20.0.81" },
  });

  test("customer can create an order from the catalog through the checkout UI", async ({ page }) => {
    await page.goto("/catalog");
    await expect(page.getByRole("heading", { name: /каталог/i })).toBeVisible();

    // Sign in through the visible header and authentication dialog.
    await page.getByRole("button", { name: "Войти" }).click();
    const authDialog = page.getByRole("dialog");
    await expect(authDialog).toBeVisible();
    await authDialog.locator("#login-email").fill("customer@demo.ru");
    await authDialog.locator("#login-password").fill("Demo123!");
    await authDialog.getByRole("button", { name: "Войти" }).click();
    await expect(authDialog).toBeHidden({ timeout: 15_000 });

    // Wait for the isolated E2E product created by the workflow fixture.
    const product = page.getByRole("link").filter({ hasText: "E2E демо-торт" }).first();
    await expect(product).toBeVisible({ timeout: 20_000 });
    await product.getByRole("button", { name: "Добавить в корзину" }).click();

    // Open the cart from the site header and continue through its CTA.
    await page.getByRole("button", { name: "Корзина" }).click();
    const cartDialog = page.getByRole("dialog");
    await expect(cartDialog).toBeVisible();
    await expect(cartDialog.getByText("E2E демо-торт")).toBeVisible();
    await cartDialog.getByRole("button", { name: "Оформить заказ" }).click();

    await expect(page.getByRole("heading", { name: "Оформление заказа" })).toBeVisible();
    await page.getByRole("button", { name: /Самовывоз/ }).click();
    await page.locator("#checkout-recipient-name").fill("Тестовый покупатель");
    await page.locator("#checkout-recipient-phone").fill("+7 999 123-45-67");
    await page.locator("#checkout-city").fill("Москва");

    const deliveryDate = new Date();
    deliveryDate.setDate(deliveryDate.getDate() + 3);
    await page.locator("#checkout-delivery-date").fill(deliveryDate.toISOString().slice(0, 10));
    await page.getByRole("button", { name: "Продолжить" }).click();

    await expect(page.getByRole("heading", { name: "Подтверждение заказа" })).toBeVisible();
    await expect(page.getByText("Банковской картой онлайн")).toBeVisible();
    await page.getByRole("button", { name: /^Оплатить/ }).click();

    // CI has the guarded local payment stub enabled; the customer sees the
    // successful order state, not a synthetic direct API response.
    await expect(page.getByText(/Заказ оформлен|Заказ №/i).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/E2E демо-торт/)).toBeVisible();
  });
});
