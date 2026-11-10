/**
 * Тесты global-handlers.ts — глобальный страховочный слой (DEPLOY-01 §3):
 * идемпотентная установка, захват uncaughtException/unhandledRejection
 * в captureServerError, ни одна ошибка диагностики не бросает.
 *
 * @vitest-environment node — обработчики ставятся только в nodejs-рантайме
 * (в jsdom есть window, установка корректно пропускается — это отдельная
 * защита, здесь проверяем именно node-поведение).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const captureMock = vi.fn();

vi.mock("./capture", () => ({
  captureServerError: (...args: unknown[]) => captureMock(...args),
}));

import {
  installGlobalErrorHandlers,
  __resetGlobalHandlersForTests,
  areGlobalHandlersInstalled,
} from "./global-handlers";

beforeEach(() => {
  __resetGlobalHandlersForTests();
  captureMock.mockReset();
  captureMock.mockImplementation(() => undefined);
  // чистим слушатели, чтобы тесты были изолированы
  process.removeAllListeners("uncaughtException");
  process.removeAllListeners("unhandledRejection");
});

describe("installGlobalErrorHandlers", () => {
  it("устанавливается один раз (идемпотентно)", () => {
    installGlobalErrorHandlers();
    expect(areGlobalHandlersInstalled()).toBe(true);
    const countAfterFirst = process.listenerCount("uncaughtException");
    installGlobalErrorHandlers();
    installGlobalErrorHandlers();
    expect(process.listenerCount("uncaughtException")).toBe(countAfterFirst);
  });

  it("uncaughtException попадает в captureServerError как critical", () => {
    installGlobalErrorHandlers();
    const err = new Error(" runaway boom");
    process.emit("uncaughtException", err);
    expect(captureMock).toHaveBeenCalledTimes(1);
    const [captured, options] = captureMock.mock.calls[0];
    expect(captured).toBe(err);
    expect((options as { component: string }).component).toBe("infrastructure");
    expect((options as { severity: string }).severity).toBe("critical");
    expect((options as { errorCode: string }).errorCode).toBe("uncaught_exception");
  });

  it("unhandledRejection захватывается (reason — строка)", () => {
    installGlobalErrorHandlers();
    process.emit("unhandledRejection", "rejection reason string");
    expect(captureMock).toHaveBeenCalledTimes(1);
    const [captured, options] = captureMock.mock.calls[0];
    expect(captured).toBe("rejection reason string");
    expect((options as { errorCode: string }).errorCode).toBe("unhandled_rejection");
  });

  it("сбой captureServerError НЕ бросает из обработчика (§3.3)", () => {
    installGlobalErrorHandlers();
    captureMock.mockImplementation(() => {
      throw new Error("diagnostics broken");
    });
    expect(() => process.emit("uncaughtException", new Error("x"))).not.toThrow();
    expect(() => process.emit("unhandledRejection", "y")).not.toThrow();
  });

  it("не-Error объекты ( thrown строка) сериализуются без броска", () => {
    installGlobalErrorHandlers();
    expect(() => process.emit("uncaughtException", 42)).not.toThrow();
    expect(captureMock).toHaveBeenCalledTimes(1);
  });
});
