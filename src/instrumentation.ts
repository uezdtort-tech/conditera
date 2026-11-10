/**
 * instrumentation.ts — Next.js instrumentation hook (DEPLOY-01 §3).
 *
 * register() вызывается один раз при старте nodejs-сервера. Здесь
 * ставится глобальный страховочный слой диагностики
 * (uncaughtException / unhandledRejection → app_error_events).
 *
 * ВАЖНО: импорт node-зависимостей — только динамический и после
 * проверки NEXT_RUNTIME, чтобы Edge-бандл не тянул node-модули.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { installGlobalErrorHandlers } = await import(
      "@/lib/diagnostics/global-handlers"
    );
    installGlobalErrorHandlers();
  } catch {
    // Диагностика не должна мешать старту приложения (§3.3)
    console.warn("[diagnostics] global handlers install skipped (import failed)");
  }
}
