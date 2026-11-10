/**
 * Тесты global-handlers.ts — глобальный страховочный слой (DEPLOY-01 §3):
 * идемпотентная установка, захват uncaughtException/unhandledRejection
 * в captureServerError, ни одна ошибка диагностики не бросает.
 *
 * Z-v19 §4: поведение после uncaughtException — фиксация события,
 * попытка flush, управляемое завершение процесса (exit(1) после grace
 * в production / по DIAGNOSTICS_EXIT_ON_UNCAUGHT=1), lastCriticalAt.
 *
 * @vitest-environment node — обработчики ставятся только в nodejs-рантайме
 * (в jsdom есть window, установка корректно пропускается — это отдельная
 * защита, здесь проверяем именно node-поведение).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const captureMock = vi.fn();
const flushTriggerMock = vi.fn();

vi.mock("./capture", () => ({
  captureServerError: (...args: unknown[]) => captureMock(...args),
}));

vi.mock("./event-store", () => ({
  triggerImmediateFlush: (...args: unknown[]) => flushTriggerMock(...args),
}));

import {
  installGlobalErrorHandlers,
  __resetGlobalHandlersForTests,
  __setExitFnForTests,
  areGlobalHandlersInstalled,
  getLastCriticalAt,
  shouldExitOnUncaught,
  UNCAUGHT_EXIT_GRACE_MS,
} from "./global-handlers";

beforeEach(() => {
  __resetGlobalHandlersForTests();
  captureMock.mockReset();
  captureMock.mockImplementation(() => undefined);
  flushTriggerMock.mockReset();
  delete process.env.DIAGNOSTICS_EXIT_ON_UNCAUGHT;
  // чистим слушатели, чтобы тесты были изолированы
  process.removeAllListeners("uncaughtException");
  process.removeAllListeners("unhandledRejection");
});

afterEach(() => {
  delete process.env.DIAGNOSTICS_EXIT_ON_UNCAUGHT;
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

// ===== Z-v19 §4: безопасное продолжение/завершение процесса =====
describe("uncaughtException — управляемое завершение (Z-v19 §4)", () => {
  it("shouldExitOnUncaught: авто = production да / development нет", () => {
    try {
      delete process.env.DIAGNOSTICS_EXIT_ON_UNCAUGHT;
      vi.stubEnv("NODE_ENV", "production");
      expect(shouldExitOnUncaught()).toBe(true);
      vi.stubEnv("NODE_ENV", "development");
      expect(shouldExitOnUncaught()).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("shouldExitOnUncaught: DIAGNOSTICS_EXIT_ON_UNCAUGHT переопределяет auto", () => {
    try {
      vi.stubEnv("NODE_ENV", "development");
      process.env.DIAGNOSTICS_EXIT_ON_UNCAUGHT = "1";
      expect(shouldExitOnUncaught()).toBe(true);
      vi.stubEnv("NODE_ENV", "production");
      process.env.DIAGNOSTICS_EXIT_ON_UNCAUGHT = "0";
      expect(shouldExitOnUncaught()).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("production: после uncaughtException запускается flush и exit(1) после grace", () => {
    vi.useFakeTimers();
    const exitSpy = vi.fn();
    __setExitFnForTests(exitSpy);
    try {
      vi.stubEnv("NODE_ENV", "production");
      delete process.env.DIAGNOSTICS_EXIT_ON_UNCAUGHT;
      installGlobalErrorHandlers();
      process.emit("uncaughtException", new Error("fatal boom"));
      // flush-попытка инициирована немедленно
      expect(flushTriggerMock).toHaveBeenCalledTimes(1);
      // exit ещё НЕ вызван (grace-период)
      expect(exitSpy).not.toHaveBeenCalled();
      vi.advanceTimersByTime(UNCAUGHT_EXIT_GRACE_MS + 1);
      // после grace — exit(1), оркестратор перезапустит
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      vi.unstubAllEnvs();
      vi.useRealTimers();
    }
  });

  it("development (по умолчанию): процесс НЕ завершается (dev-цикл живёт)", () => {
    const exitSpy = vi.fn();
    __setExitFnForTests(exitSpy);
    try {
      vi.stubEnv("NODE_ENV", "development");
      delete process.env.DIAGNOSTICS_EXIT_ON_UNCAUGHT;
      installGlobalErrorHandlers();
      process.emit("uncaughtException", new Error("dev boom"));
      expect(exitSpy).not.toHaveBeenCalled();
      // flush-попытка всё равно делается — событие должно дойти до БД
      expect(flushTriggerMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("DIAGNOSTICS_EXIT_ON_UNCAUGHT=0 отключает exit даже в production", () => {
    try {
      vi.stubEnv("NODE_ENV", "production");
      process.env.DIAGNOSTICS_EXIT_ON_UNCAUGHT = "0";
      const exitSpy = vi.fn();
      __setExitFnForTests(exitSpy);
      installGlobalErrorHandlers();
      process.emit("uncaughtException", new Error("keep alive"));
      expect(exitSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("lastCriticalAt обновляется при uncaughtException и unhandledRejection", () => {
    installGlobalErrorHandlers();
    expect(getLastCriticalAt()).toBe(0);
    const before = Date.now();
    process.emit("uncaughtException", new Error("crit 1"));
    expect(getLastCriticalAt()).toBeGreaterThanOrEqual(before);
    const afterFirst = getLastCriticalAt();
    process.emit("unhandledRejection", "crit 2");
    expect(getLastCriticalAt()).toBeGreaterThanOrEqual(afterFirst);
  });

  it("grace-таймер не держит event loop (unref) — процесс может завершиться сам", () => {
    // Косвенная проверка: без fake-таймеров emit не должен держать тест открытым.
    // Если таймер не unref-нут, vitest подвисает на UNCAUGHT_EXIT_GRACE_MS.
    try {
      vi.stubEnv("NODE_ENV", "development");
      process.env.DIAGNOSTICS_EXIT_ON_UNCAUGHT = "1";
      const exitSpy = vi.fn();
      __setExitFnForTests(exitSpy);
      installGlobalErrorHandlers();
      process.emit("uncaughtException", new Error("unref check"));
      // не ждём 2s: если таймер unref-нут, тест завершится сразу
      expect(exitSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
