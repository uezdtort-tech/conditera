#!/usr/bin/env node
/**
 * Единственная безопасная точка запуска production Compose Conditera.
 *
 * Всегда собирает стек из трёх Compose-файлов и до любой команды проверяет,
 * что web, Auth, REST, Realtime и Storage используют один Supabase Runtime
 * на PostgreSQL 17. Legacy PostgreSQL 18/15 не должны попасть в активный стек.
 *
 * Требует .env.production и .env.supabase-runtime в корне репозитория.
 * Не выполняет миграцию данных, не меняет volumes и не делает deploy сам по себе.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const productionEnv = process.env.CONDITERA_PRODUCTION_ENV_FILE || ".env.production";
const runtimeEnv = process.env.CONDITERA_RUNTIME_ENV_FILE || ".env.supabase-runtime";
const envFiles = [productionEnv, runtimeEnv].map((file) => resolve(root, file));

function fail(message) {
  console.error("[conditera-compose] " + message);
  process.exit(1);
}

const userArgs = process.argv.slice(2);
if (userArgs.length === 0) {
  fail("Укажите команду Compose, например: node scripts/compose-single-runtime.mjs up -d");
}

if (userArgs.some((arg) => arg === "-f" || arg === "--file" || arg === "--env-file")) {
  fail("Нельзя переопределять Compose-файлы или env-файлы: это нарушит единый PostgreSQL 17.");
}
if (userArgs.some((arg) => arg === "legacy-app-db" || arg === "legacy-supabase" ||
    arg === "--profile=legacy-app-db" || arg === "--profile=legacy-supabase")) {
  fail("Запуск legacy-профилей PostgreSQL 18/15 запрещён через production launcher.");
}
if (userArgs[0] === "down" && userArgs.some((arg) => arg === "-v" || arg === "--volumes")) {
  fail("Удаление volumes запрещено. Для остановки используйте down без -v/--volumes.");
}
if (userArgs[0] === "volume" && userArgs[1] === "rm") {
  fail("Удаление Docker volumes запрещено через production launcher.");
}

for (const file of envFiles) {
  if (!existsSync(file)) fail("Не найден обязательный env-файл: " + file.replace(root + "/", ""));
}

const composePrefix = [
  "compose",
  "--env-file", envFiles[0],
  "--env-file", envFiles[1],
  "-f", "docker-compose.yml",
  "-f", "docker-compose.supabase.yml",
  "-f", "docker-compose.supabase-single-container.yml",
];

function runDocker(args, capture = false) {
  const result = spawnSync("docker", [...composePrefix, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    env: process.env,
  });
  if (result.error) fail("Не удалось запустить Docker CLI: " + result.error.message);
  if (result.status !== 0) {
    if (capture) {
      if (result.stderr) process.stderr.write(result.stderr);
      if (result.stdout) process.stderr.write(result.stdout);
    }
    process.exit(result.status ?? 1);
  }
  return result.stdout || "";
}

let config;
try {
  config = JSON.parse(runDocker(["config", "--format", "json"], true));
} catch (error) {
  fail("Не удалось разобрать итоговую Compose-конфигурацию: " + error.message);
}

const services = config.services || {};
const requiredServices = ["web", "supabase-runtime", "redis", "meilisearch"];
for (const name of requiredServices) {
  if (!services[name]) fail("В итоговом стеке отсутствует обязательный сервис: " + name);
}

const forbiddenServices = [
  "db", "migrator", "pgbouncer", "supabase-db", "supabase-kong",
  "supabase-auth", "supabase-rest", "supabase-realtime", "supabase-storage",
  "supabase-app-migrator", "supabase-meta", "supabase-imgproxy",
  "supabase-analytics", "supabase-vector", "supabase-studio",
];
for (const name of forbiddenServices) {
  if (services[name]) fail("В итоговый стек попал отдельный legacy-сервис: " + name);
}

const runtime = services["supabase-runtime"];
if (runtime.profiles?.length) fail("Supabase Runtime не должен быть опциональным профилем.");
if (runtime.build?.dockerfile !== "Dockerfile.supabase-runtime-poc") {
  fail("Supabase Runtime собран не из проверенного Dockerfile.");
}

const runtimeEnvValues = runtime.environment || {};
const requiredSecrets = [
  "POSTGRES_PASSWORD", "APP_DATABASE_PASSWORD", "JWT_SECRET",
  "SECRET_KEY_BASE", "PG_META_CRYPTO_KEY", "REALTIME_DB_ENC_KEY",
  "REALTIME_DB_ENC_KEY_GCM", "ANON_KEY", "SERVICE_ROLE_KEY",
];
for (const key of requiredSecrets) {
  const value = String(runtimeEnvValues[key] ?? "");
  if (!value || value.includes("CHANGE_ME")) {
    fail("Не задан или оставлен шаблонным обязательный секрет " + key +
      " в .env.production/.env.supabase-runtime.");
  }
}

const webEnv = services.web.environment || {};
for (const key of ["DATABASE_URL", "DIRECT_DATABASE_URL"]) {
  if (!String(webEnv[key] || "").includes("@supabase-runtime:5432/supabase")) {
    fail("web." + key + " не направлен в единый PostgreSQL 17 runtime.");
  }
}
if (webEnv.SUPABASE_INTERNAL_URL !== "http://supabase-kong:8000") {
  fail("Supabase JS должен обращаться к Kong внутри единого runtime.");
}
if (services.web.depends_on?.["supabase-runtime"]?.condition !== "service_healthy") {
  fail("web должен ожидать успешный healthcheck единого Supabase Runtime.");
}
if (runtimeEnvValues.POSTGRES_DB !== "supabase" || runtimeEnvValues.POSTGRES_USER !== "supabase_admin") {
  fail("Supabase Runtime должен использовать каноническую БД supabase и административную роль supabase_admin.");
}

const runtimeMounts = runtime.volumes || [];
const pg17Mount = runtimeMounts.find((mount) =>
  mount.target === "/opt/supabase/services/postgres/var/lib/postgresql/data"
);
if (!pg17Mount || !String(pg17Mount.source || "").includes("supabase_runtime_pg17_data")) {
  fail("Не найден отдельный именованный volume PostgreSQL 17.");
}
if (runtimeMounts.some((mount) =>
  ["postgres_data_v18", "supabase_db_data", "supabase_pg17_migration_data"].some((legacy) => String(mount.source || "").includes(legacy))
)) {
  fail("В PG17 Runtime подключён legacy/migration volume; запуск остановлен.");
}

const runtimeNetwork = runtime.networks?.["conditera-net"];
if (!runtimeNetwork?.aliases?.includes("supabase-kong")) {
  fail("Не найден сетевой alias supabase-kong для существующей маршрутизации.");
}

const dockerfile = readFileSync(resolve(root, "Dockerfile.supabase-runtime-poc"), "utf8");
if (!/^FROM supabase\/postgres:17\.[^ ]+ AS postgres$/m.test(dockerfile)) {
  fail("Dockerfile не закрепляет Supabase PostgreSQL 17 как единственный кластер.");
}

console.log("[conditera-compose] Проверка пройдена: единый Supabase Runtime / PostgreSQL 17; legacy PG18/15 исключены.");
if (userArgs[0] === "config") {
  console.log("[conditera-compose] Итоговая Compose-конфигурация валидна. Секреты не выводятся.");
  process.exit(0);
}

runDocker(userArgs);
