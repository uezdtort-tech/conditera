#!/usr/bin/env node
/**
 * Запуск Next.js Standalone с фиксированным корнем проекта.
 * Next-generated server.js меняет process.cwd() на .next/standalone;
 * файловые хранилища должны оставаться привязаны к корню репозитория.
 */
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = path.join(projectRoot, ".next", "standalone", "server.js");

try {
  await access(serverPath);
} catch {
  console.error("[conditera-start] Не найдена .next/standalone/server.js. Сначала выполните bun run build.");
  process.exit(1);
}

process.env.CONDITERA_PROJECT_ROOT ||= projectRoot;
process.env.PRODUCT_MEDIA_ROOT ||= path.join(projectRoot, "storage");
process.env.SUPABASE_STORAGE_ROOT ||= path.join(projectRoot, "upload", "storage");
process.env.PORT ||= "3000";
process.env.HOSTNAME ||= "0.0.0.0";

await import(pathToFileURL(serverPath).href);
