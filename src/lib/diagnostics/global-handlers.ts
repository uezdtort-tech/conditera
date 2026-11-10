/**
 * global-handlers.ts — глобальный страховочный захват ошибок процесса
 * (DEPLOY-01 §3, слой «catch-all»).
 *
 * Зачем: handleRouteError покрывает маршруты, использующие helper;
 * error boundaries покрывают клиент. Ошибки, УСКОЛЬЗНУВШИЕ обоих слоёв
 * (uncaughtException / unhandledRejection в nodejs-рантайме), попадают
 * сюда — единственный оставшийся путь в app_error_events.
 *
 * Правила (§3.3):
 *   • запись — fire-and-forget через storeErrorEvent (он сам не бросает);
 *   • обработчики НИКОГДА не бросают и не await'ят (void);
 *   • двойная установка невозможна (idempotent install);
 *
 * Поведение после uncaughtException (Z-v19 §4 — исправлено):
 *   Node.js после uncaughtException с установленным обработчиком продолжает
 *   процесс в НЕОПРЕДЕЛЁННОМ состоянии. Оставлять процесс жить молча НЕЛЬЗЯ:
 *   liveness-проба вернёт 200, оркестратор не узнает о деградации — ложное
 *   healthy. Поэтому (рекомендация Node.js):
 *     1) событие фиксируется в app_error_events;
 *     2) делается попытка немедленного flush диагностической очереди
 *        (не дожидаясь 300ms-таймера);
 *     3) процесс завершается с кодом 1 после короткого grace-периода
 *        (2s — чтобы успел уйти flush и in-flight HTTP-ответы);
 *        рестарт — за оркестратором/systemd/Docker restart policy.
 *   Управление: DIAGNOSTICS_EXIT_ON_UNCAUGHT = "1" | "0" | unset.
 *     unset → auto: exit в production, keep-alive в development
 *     (dev-цикл Next.js не должен умирать от любой ошибки).
 *   unhandledRejection: процесс ОСТАЁТСЯ жить (reject ≠ разрушенное
 *   синхронное состояние), но lastCriticalAt обновляется и виден в
 *   /api/health (recent_critical) — ложного «всё чисто» нет.
 *
 * Совместимость: вызывается из src/instrumentation.ts (register()),
 * поэтому импортируется ДИНАМИЧЕСКИ и только в nodejs-рантайме.
 */

import { captureServerError } from "./capture";
import { triggerImmediateFlush } from "./event-store";

const GLOBAL_COMPONENT = "infrastructure";
/** Grace-период перед exit(1): flush очереди + in-flight ответы. */
export const UNCAUGHT_EXIT_GRACE_MS = 2000;

let installed = false;
/** Timestamp последней критической ошибки процесса (для /api/health). */
let lastCriticalAt = 0;

/** Отметка последней критической ошибки (epoch ms; 0 — не было). */
export function getLastCriticalAt(): number {
  return lastCriticalAt;
}

/**
 * Должен ли процесс завершиться после uncaughtException.
 * - DIAGNOSTICS_EXIT_ON_UNCAUGHT=1 → да (явно включено)
 * - DIAGNOSTICS_EXIT_ON_UNCAUGHT=0 → нет (явно выключено)
 * - unset → auto: да в production, нет в development.
 */
export function shouldExitOnUncaught(): boolean {
  const flag = process.env.DIAGNOSTICS_EXIT_ON_UNCAUGHT;
  if (flag === "1") return true;
  if (flag === "0") return false;
  return process.env.NODE_ENV === "production";
}

/** Тест-хук: подменить механизм выхода (vitest не должен убивать процесс). */
let exitFn: (code: number) => void = (code) => process.exit(code);
export function __setExitFnForTests(fn: (code: number) => void): void {
  exitFn = fn;
}

/**
 * Немедленная попытка flush диагностической очереди перед возможным
 * завершением процесса. Очередь + upsert идут в БД; если не успели
 * (circuit open / PG down) — событие уже зафиксировано в консоли
 * handleInternalFailure'ом. Никогда не бросает.
 * (Z-v19: статический импорт — event-store и так в графе через capture.ts,
 * pg там динамический; вызов синхронный, чтобы обработчик не зависел
 * от микротасков перед exit.)
 */
function attemptImmediateFlush(): void {
  try {
    triggerImmediateFlush();
  } catch {
    // последняя линия обороны
  }
}

/** Идемпотентная установка глобальных обработчиков (только Node.js). */
export function installGlobalErrorHandlers(): void {
  // Клиент / Edge — не наша территория
  if (typeof window !== "undefined") return;
  if (typeof process === "undefined" || typeof process.on !== "function") return;
  if (installed) return;
  installed = true;

  process.on("uncaughtException", (err: unknown) => {
    try {
      lastCriticalAt = Date.now();
      captureServerError(err, {
        component: GLOBAL_COMPONENT,
        severity: "critical",
        errorCode: "uncaught_exception",
      });
      // Z-v19 §4: попытка flush ДО завершения процесса (если он состоится)
      attemptImmediateFlush();
      if (shouldExitOnUncaught()) {
        // Grace-период: дать flush/in-flight ответам уйти, затем exit(1).
        // Таймер unref-нут — если процесс завершится сам раньше, не держим.
        const t = setTimeout(() => exitFn(1), UNCAUGHT_EXIT_GRACE_MS);
        if (typeof t === "object" && "unref" in t) (t as { unref: () => void }).unref();
      }
    } catch {
      // последняя линия обороны: диагностика не должна ронять процесс
      console.warn("[diagnostics] uncaughtException capture failed");
    }
  });

  process.on("unhandledRejection", (reason: unknown) => {
    try {
      lastCriticalAt = Date.now();
      captureServerError(reason, {
        component: GLOBAL_COMPONENT,
        severity: "critical",
        errorCode: "unhandled_rejection",
      });
    } catch {
      console.warn("[diagnostics] unhandledRejection capture failed");
    }
  });
}

/** Тест-хук: снять установку (используется ТОЛЬКО в vitest). */
export function __resetGlobalHandlersForTests(): void {
  installed = false;
  lastCriticalAt = 0;
}

/** Видимость установки (для тестов/проверки). */
export function areGlobalHandlersInstalled(): boolean {
  return installed;
}
