#!/usr/bin/env python3
"""
Генерация SQL миграции 0017_sync_missing_tables.sql
Извлекает все CREATE TABLE из Prisma миграции 0001_full_schema.sql,
которые отсутствуют в Supabase миграциях.
"""
import re
import os

with open('prisma/migrations/0001_full_schema.sql', 'r') as f:
    prisma_content = f.read()

# Все таблицы из Prisma migration
prisma_tables = set()
for m in re.finditer(r'CREATE TABLE\s+"(\w+)"', prisma_content):
    prisma_tables.add(m.group(1).lower())

# Таблицы которые уже есть в Supabase миграциях
supabase_tables = set()
for f in os.listdir('supabase/migrations'):
    if f.endswith('.sql'):
        with open(f'supabase/migrations/{f}', 'r') as fh:
            content = fh.read()
            for m in re.finditer(r'CREATE TABLE\s+(?:IF NOT EXISTS\s+)?public\.(\w+)', content):
                supabase_tables.add(m.group(1).lower())

missing = prisma_tables - supabase_tables
print(f"Prisma tables: {len(prisma_tables)}")
print(f"Supabase tables: {len(supabase_tables)}")
print(f"Missing: {len(missing)}")

# Извлекаем CREATE TABLE блоки с regex (DOTALL для многострочных)
output_lines = [
    "-- 0017_sync_missing_tables.sql",
    "-- Синхронизация: перенос недостающих таблиц из Prisma migration в Supabase.",
    f"-- Добавлено таблиц: {len(missing)}",
    "",
]

found = 0
# Pattern: CREATE TABLE "tablename" ( ... );
for m in re.finditer(r'(CREATE TABLE\s+"(\w+)".*?;)', prisma_content, re.DOTALL):
    full_stmt = m.group(1)
    table_name = m.group(2).lower()
    if table_name in missing:
        # Конвертируем: CREATE TABLE → CREATE TABLE IF NOT EXISTS
        converted = full_stmt.replace('CREATE TABLE', 'CREATE TABLE IF NOT EXISTS', 1)
        output_lines.append(converted)
        output_lines.append("")
        found += 1

# Добавляем индексы
output_lines.append("-- ===== Индексы для недостающих таблиц =====")
for m in re.finditer(r'(CREATE\s+(?:UNIQUE\s+)?INDEX\s+.*?;)', prisma_content, re.DOTALL):
    stmt = m.group(1)
    for table in missing:
        if f'"{table}"' in stmt.lower():
            converted = stmt.replace('CREATE INDEX', 'CREATE INDEX IF NOT EXISTS')
            converted = converted.replace('CREATE UNIQUE INDEX', 'CREATE UNIQUE INDEX IF NOT EXISTS')
            output_lines.append(converted)
            break

with open('supabase/migrations/0017_sync_missing_tables.sql', 'w') as f:
    f.write('\n'.join(output_lines))

print(f"\nGenerated: supabase/migrations/0017_sync_missing_tables.sql")
print(f"Tables added: {found}")
print(f"File size: {os.path.getsize('supabase/migrations/0017_sync_missing_tables.sql')} bytes")
