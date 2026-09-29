#!/usr/bin/env bun
/**
 * scripts/db-push.mjs — prisma-free замена `prisma db push`.
 *
 * Контекст (deploy-fix, см. worklog «deploy-fix-round»):
 *  - Prisma полностью удалена из проекта (v2.0: Supabase), но деплой-пайплайн
 *    платформы (.zscripts/database-runtime-build.sh) и IDE-старт (.zscripts/dev.sh)
 *    вызывают `bun run db:push`.
 *  - `prisma db push` падал "command not found" → packaging деплоя падал
 *    (set -e в скриптах) → «Sorry, there was a problem deploying the code».
 *  - Кроме того, .zscripts/start.sh требует существования упакованной БД
 *    /app/db/custom.db — если файла нет, старт деплоя завершается exit 1.
 *
 * Поведение: гарантирует существование SQLite-файла по DATABASE_URL
 * (legacy-артефакт для контрактов деплоя). Приложение это файл в рантайме
 * не использует (данные — в Supabase).
 */
import fs from "node:fs";
import path from "node:path";

const raw = process.env.DATABASE_URL || "file:db/custom.db";
const file = raw.startsWith("file:") ? raw.slice("file:".length) : raw;

fs.mkdirSync(path.dirname(file), { recursive: true });
// openSync с флагом "a" создаёт файл, если его нет, и не трогает существующий
fs.closeSync(fs.openSync(file, "a"));

console.log(`[db:push] ok: ${file} (SQLite legacy-файл; приложение использует Supabase)`);
