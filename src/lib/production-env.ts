/**
 * Production runtime configuration guard.
 *
 * Проверяется при старте Node.js-сервера, а не во время next build:
 * сборка может выполняться отдельно от production-секретов, но сервер
 * не должен принимать трафик с заглушками или неполной конфигурацией.
 */
type RuntimeEnv = Record<string, string | undefined>;

const PLACEHOLDER_PREFIX =
  /^(CHANGE_ME|change_me|stub_|fallback-|dev-|dev_|placeholder|example|dummy|test[_-])/i;

function requireValue(env: RuntimeEnv, name: string, minLength = 1): string {
  const value = env[name]?.trim();
  if (!value || PLACEHOLDER_PREFIX.test(value) || value.length < minLength) {
    throw new Error(
      `[production-env] ${name} отсутствует, содержит заглушку или короче ${minLength} символов. Отказ запуска.`
    );
  }
  return value;
}

function requireHttpsUrl(env: RuntimeEnv, name: string): void {
  const value = requireValue(env, name);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`[production-env] ${name} должен быть корректным HTTPS URL.`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`[production-env] ${name} должен использовать HTTPS в production.`);
  }
}

/**
 * Бросает исключение при неполной/небезопасной production-конфигурации.
 * Принимает env аргумент для изолированного unit-тестирования.
 */
export function assertProductionEnvironment(env: RuntimeEnv = process.env): void {
  if (env.NODE_ENV !== "production") return;

  requireHttpsUrl(env, "NEXT_PUBLIC_APP_URL");
  requireHttpsUrl(env, "NEXT_PUBLIC_SUPABASE_URL");
  requireValue(env, "DATABASE_URL");
  requireValue(env, "NEXT_PUBLIC_SUPABASE_ANON_KEY", 32);
  requireValue(env, "SUPABASE_SERVICE_ROLE_KEY", 32);

  const jwtSecret = requireValue(env, "JWT_SECRET", 32);
  const refreshSecret = requireValue(env, "JWT_REFRESH_SECRET", 32);
  const tfaKey = requireValue(env, "TFA_ENCRYPTION_KEY", 32);
  requireValue(env, "CRON_SECRET", 24);

  if (jwtSecret === refreshSecret) {
    throw new Error("[production-env] JWT_SECRET и JWT_REFRESH_SECRET должны различаться.");
  }
  if (jwtSecret === tfaKey || refreshSecret === tfaKey) {
    throw new Error("[production-env] TFA_ENCRYPTION_KEY должен отличаться от JWT-секретов.");
  }

  const databaseUrl = requireValue(env, "DATABASE_URL");
  let parsedDatabaseUrl: URL;
  try {
    parsedDatabaseUrl = new URL(databaseUrl);
  } catch {
    throw new Error("[production-env] DATABASE_URL должен быть корректным PostgreSQL URL.");
  }
  if (
    !/^postgres(?:ql)?:$/i.test(parsedDatabaseUrl.protocol) ||
    !parsedDatabaseUrl.hostname ||
    !parsedDatabaseUrl.username ||
    !parsedDatabaseUrl.password
  ) {
    throw new Error("[production-env] DATABASE_URL должен содержать PostgreSQL host, user и password.");
  }

  let databasePassword = parsedDatabaseUrl.password;
  try {
    databasePassword = decodeURIComponent(databasePassword);
  } catch {
    throw new Error("[production-env] DATABASE_URL содержит некорректно закодированный пароль.");
  }
  if (
    databasePassword.length < 16 ||
    PLACEHOLDER_PREFIX.test(databasePassword)
  ) {
    throw new Error("[production-env] Пароль в DATABASE_URL пустой, слишком короткий или является заглушкой.");
  }
}
