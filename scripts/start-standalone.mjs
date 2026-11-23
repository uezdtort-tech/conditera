#!/usr/bin/env node
/**
 * Запуск Next.js Standalone с корректной подготовкой runtime-ресурсов.
 *
 * Next standalone не копирует public и .next/static автоматически.
 * Сгенерированный server.js запускается из .next/standalone и ищет
 * эти каталоги относительно себя. Без копирования HTML отдаётся, но
 * клиентские JS/CSS чанки получают 404 и приложение остаётся негидратированным.
 */
import { access, cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextRoot = path.join(projectRoot, ".next");
const standaloneRoot = path.join(nextRoot, "standalone");
const serverPath = path.join(standaloneRoot, "server.js");

try {
  await access(serverPath);
} catch {
  console.error("[conditera-start] Не найдена .next/standalone/server.js. Сначала выполните bun run build.");
  process.exit(1);
}

async function copyRuntimeDirectory(source, destination, label) {
  try {
    await access(source);
  } catch {
    throw new Error(`[conditera-start] Не найдена обязательная директория ${label}: ${source}`);
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true, force: true });
}

await Promise.all([
  copyRuntimeDirectory(path.join(projectRoot, "public"), path.join(standaloneRoot, "public"), "public"),
  copyRuntimeDirectory(path.join(nextRoot, "static"), path.join(standaloneRoot, ".next", "static"), ".next/static"),
]);

// Данные пользователя и файловые хранилища остаются привязаны к корню проекта,
// хотя Next standalone меняет process.cwd() на .next/standalone.
process.env.CONDITERA_PROJECT_ROOT ||= projectRoot;
process.env.PRODUCT_MEDIA_ROOT ||= path.join(projectRoot, "storage");
process.env.SUPABASE_STORAGE_ROOT ||= path.join(projectRoot, "upload", "storage");
process.env.PORT ||= "3000";
process.env.HOSTNAME ||= "0.0.0.0";

await import(pathToFileURL(serverPath).href);
