/**
 * Production runtime configuration guard.
 *
 * Проверяется при старте Node.js-сервера, а не во время next build:
 * сборка может выполняться отдельно от production-секретов, но сервер
 * не должен принимать трафик с заглушками или неполной конфигурацией.
 */
type RuntimeEnv = Record<string, string | undefined>;

const PLACEHOLDER_PREFIX =
  /^(CHANGE_ME|change_me|stub[-_]|fallback-|dev-|dev_|placeholder|example|dummy|test[_-])/i;

function requireValue(env: RuntimeEnv, name: string, minLength = 1): string {
  const value = env[name]?.trim();
  if (!value || PLACEHOLDER_PREFIX.test(value) || value.length < minLength) {
    throw new Error(
      `[production-env] ${name} отсутствует, содержит заглушку или короче ${minLength} символов. Отказ запуска.`
    );
  }
  return value;
}

function requireHttpsUrl(env: RuntimeEnv, name: string): string {
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
  if (
    parsed.hostname === "localhost" ||
    parsed.hostname === "example.com" ||
    parsed.hostname.endsWith(".example") ||
    parsed.hostname.endsWith(".invalid")
  ) {
    throw new Error(`[production-env] ${name} содержит тестовый hostname.`);
  }
  return value;
}

/**
 * Бросает исключение при неполной/небезопасной production-конфигурации.
 * Принимает env аргумент для изолированного unit-тестирования.
 */
export function assertProductionEnvironment(env: RuntimeEnv = process.env): void {
  if (env.NODE_ENV !== "production" || env.NEXT_PHASE === "phase-production-build") return;

  requireHttpsUrl(env, "NEXT_PUBLIC_APP_URL");
  requireHttpsUrl(env, "NEXT_PUBLIC_SUPABASE_URL");
  requireValue(env, "DATABASE_URL");
  requireValue(env, "DIRECT_DATABASE_URL");
  requireValue(env, "NEXT_PUBLIC_SUPABASE_ANON_KEY", 32);
  requireValue(env, "SUPABASE_SERVICE_ROLE_KEY", 32);

  const jwtSecret = requireValue(env, "JWT_SECRET", 32);
  const refreshSecret = requireValue(env, "JWT_REFRESH_SECRET", 32);
  const tfaKey = requireValue(env, "TFA_ENCRYPTION_KEY", 32);
  const cronSecret = requireValue(env, "CRON_SECRET", 24);

  // Core production flows must not silently boot without mail, payments or Yandex OAuth.
  requireValue(env, "SMTP_HOST");
  requireValue(env, "SMTP_USER");
  requireValue(env, "SMTP_PASSWORD", 16);
  const smtpFrom = requireValue(env, "SMTP_FROM");
  const mailbox = smtpFrom.includes("<") && smtpFrom.endsWith(">")
    ? smtpFrom.slice(smtpFrom.lastIndexOf("<") + 1, -1).trim()
    : smtpFrom;
  if (!/^[^\\s@<>]+@[^\\s@<>]+\\.[^\\s@<>]+$/.test(mailbox)) {
    throw new Error("[production-env] SMTP_FROM должен содержать корректный email (допускается формат Имя <email>).");
  }
  const smtpPort = Number(requireValue(env, "SMTP_PORT"));
  if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
    throw new Error("[production-env] SMTP_PORT должен быть целым числом от 1 до 65535.");
  }
  if (env.SMTP_SECURE !== "true" && env.SMTP_SECURE !== "false") {
    throw new Error("[production-env] SMTP_SECURE должен быть true или false.");
  }
  requireValue(env, "YOOKASSA_SHOP_ID");
  requireValue(env, "YOOKASSA_SECRET_KEY", 16);
  if (env.EXTERNAL_YANDEX_ENABLED !== "true") {
    throw new Error("[production-env] EXTERNAL_YANDEX_ENABLED должен быть true для production-релиза.");
  }
  requireValue(env, "YANDEX_CLIENT_ID");
  const yandexRedirect = requireHttpsUrl(env, "YANDEX_OAUTH_REDIRECT");
  const expectedYandexRedirect = new URL("/api/auth/oauth/yandex/callback", requireValue(env, "NEXT_PUBLIC_APP_URL")).toString();
  if (yandexRedirect !== expectedYandexRedirect) {
    throw new Error("[production-env] YANDEX_OAUTH_REDIRECT должен совпадать с публичным callback URL.");
  }
  // Yandex public clients may use PKCE without a client secret; if present, reject placeholders.
  if (env.YANDEX_CLIENT_SECRET?.trim() && PLACEHOLDER_PREFIX.test(env.YANDEX_CLIENT_SECRET.trim())) {
    throw new Error("[production-env] YANDEX_CLIENT_SECRET содержит заглушку.");
  }

  if (jwtSecret === refreshSecret) {
    throw new Error("[production-env] JWT_SECRET и JWT_REFRESH_SECRET должны различаться.");
  }
  if (jwtSecret === tfaKey || refreshSecret === tfaKey) {
    throw new Error("[production-env] TFA_ENCRYPTION_KEY должен отличаться от JWT-секретов.");
  }
  if (cronSecret === jwtSecret || cronSecret === refreshSecret || cronSecret === tfaKey) {
    throw new Error("[production-env] CRON_SECRET должен отличаться от JWT/TFA секретов.");
  }

  const databaseUrl = requireValue(env, "DATABASE_URL");
  const directDatabaseUrl = requireValue(env, "DIRECT_DATABASE_URL");

  for (const [name, value] of [["DATABASE_URL", databaseUrl], ["DIRECT_DATABASE_URL", directDatabaseUrl]] as const) {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(value);
    } catch {
      throw new Error("[production-env] " + name + " должен быть корректным PostgreSQL URL.");
    }
    if (
      !/^postgres(?:ql)?:$/i.test(parsedUrl.protocol) ||
      !parsedUrl.hostname ||
      !parsedUrl.username ||
      !parsedUrl.password
    ) {
      throw new Error("[production-env] " + name + " должен содержать PostgreSQL host, user и password.");
    }
    let password: string;
    try {
      password = decodeURIComponent(parsedUrl.password);
    } catch {
      throw new Error("[production-env] " + name + " содержит некорректно закодированный пароль.");
    }
    if (password.length < 16 || PLACEHOLDER_PREFIX.test(password)) {
      throw new Error("[production-env] Пароль в " + name + " пустой, слишком короткий или является заглушкой.");
    }
  }
}
