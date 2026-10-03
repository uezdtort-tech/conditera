/**
 * env-check.ts — строгая валидация обязательных переменных окружения.
 *
 * Единое понятное сообщение (RU+EN) вместо молчаливых 500-х каскадом:
 * любой fail-fast вызов requireEnv даёт пользователю/разработчику
 * конкретное действие — `npm run db:setup`.
 */

export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Обязательная переменная окружения ${name} не задана. Запустите npm run db:setup — он создаст .env.local / ` +
        `Required env var ${name} is missing. Run npm run db:setup — it creates .env.local`
    );
  }
  return value;
}
