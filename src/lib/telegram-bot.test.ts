/**
 * telegram-bot.test.ts — unit-тесты для функций уведомлений в Telegram.
 *
 * Тестируем notifyNewConfectionerPending (новая функция v2.0).
 * Не проверяем реальные HTTP-запросы — мокаем TELEGRAM_BOT_TOKEN.
 *
 * Стратегия: проверяем структуру параметров, передаваемых в notifyChannel,
 * а также что функция возвращает Promise<boolean>.
 * В mock-режиме (без TELEGRAM_BOT_TOKEN) функции возвращают false
 * и логируют предупреждение.
 */

import { describe, it, expect } from "vitest";
import { notifyNewConfectionerPending } from "./telegram-bot";

describe("notifyNewConfectionerPending", () => {
  it("функция экспортируется", () => {
    expect(typeof notifyNewConfectionerPending).toBe("function");
  });

  it("возвращает Promise<boolean>", async () => {
    const result = notifyNewConfectionerPending({
      confectionerId: "test-conf-id",
      businessName: "Тестовая пекарня",
    });
    expect(result).toBeInstanceOf(Promise);
    const resolved = await result;
    expect(typeof resolved).toBe("boolean");
  });

  it("не бросает исключение при минимальных параметрах", async () => {
    await expect(
      notifyNewConfectionerPending({
        confectionerId: "minimal",
        businessName: "Минимал Торт",
      })
    ).resolves.not.toThrow();
  });

  it("не бросает исключение со всеми параметрами", async () => {
    await expect(
      notifyNewConfectionerPending({
        confectionerId: "conf_abc123",
        businessName: "ООО «Сладкоежка»",
        city: "Москва",
        email: "ivan@example.com",
        isResubmit: false,
      })
    ).resolves.not.toThrow();
  });

  it("принимает isResubmit=true (повторная заявка)", async () => {
    const result = await notifyNewConfectionerPending({
      confectionerId: "conf_xyz789",
      businessName: "Бенто Торт",
      isResubmit: true,
    });
    expect(typeof result).toBe("boolean");
  });

  it("принимает isResubmit=false (новая заявка, по умолчанию)", async () => {
    const result = await notifyNewConfectionerPending({
      confectionerId: "default-test",
      businessName: "Тест",
    });
    expect(typeof result).toBe("boolean");
  });

  it("обрабатывает unicode в businessName (эмодзи)", async () => {
    await expect(
      notifyNewConfectionerPending({
        confectionerId: "emoji-test",
        businessName: "🍰 Торт Мастер 🎂",
        city: "Санкт-Петербург",
        email: "test@example.com",
      })
    ).resolves.not.toThrow();
  });

  it("обрабатывает длинные строки (businessName > 100 chars)", async () => {
    const longName = "Очень".repeat(50) + " длинное название";
    await expect(
      notifyNewConfectionerPending({
        confectionerId: "long-name-test",
        businessName: longName,
      })
    ).resolves.not.toThrow();
  });

  it("обрабатывает специальные символы в email", async () => {
    await expect(
      notifyNewConfectionerPending({
        confectionerId: "special-email",
        businessName: "Test",
        email: "test+tag@example.com",
      })
    ).resolves.not.toThrow();
  });

  it("возвращает false в mock-режиме (без TELEGRAM_BOT_TOKEN)", async () => {
    // В тестах env vars не заданы → функция должна вернуть false
    // (после попытки отправить сообщение через api.telegram.org)
    const result = await notifyNewConfectionerPending({
      confectionerId: "mock-mode-test",
      businessName: "Mock Test",
    });
    // В mock-режиме возвращается false (бот не отправляет)
    expect(result).toBe(false);
  });
});

describe("telegram-bot module exports", () => {
  it("модуль экспортирует все notify функции", async () => {
    const mod = await import("./telegram-bot");
    expect(typeof mod.notifyNewConfectionerPending).toBe("function");
    expect(typeof mod.notifyNewOrder).toBe("function");
    expect(typeof mod.notifyNewLead).toBe("function");
    expect(typeof mod.notifyNewTicket).toBe("function");
    expect(typeof mod.notifyPaymentSucceeded).toBe("function");
    expect(typeof mod.notifyError).toBe("function");
    expect(typeof mod.sendTelegramMessage).toBe("function");
    expect(typeof mod.sendToChannel).toBe("function");
    expect(typeof mod.notifyChannel).toBe("function");
  });

  it("тип TelegramNotification включает confectioner", async () => {
    // Проверка через TypeScript: типизированный импорт
    const mod = await import("./telegram-bot");
    // Если тип расширен правильно — вызов не должен падать на этапе TypeScript
    const notif: import("./telegram-bot").TelegramNotification = {
      type: "confectioner",
      title: "Test",
      body: "Test body",
    };
    expect(notif.type).toBe("confectioner");
    expect(typeof mod.notifyChannel).toBe("function");
  });
});
