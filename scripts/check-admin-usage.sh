#!/bin/bash
# scripts/check-admin-usage.sh — report-only инвентаризация использования supabaseAdmin.
# Baseline: 201 (см. docs/SUPABASE_ADMIN_POLICY.md). Рост — повод для review-объяснения.

BASELINE=201
count=$(rg -l "supabaseAdmin" src/app/api --type ts | wc -l)

echo "route.ts с supabaseAdmin: ${count} (baseline: ${BASELINE})"

if [ "${count}" -gt "${BASELINE}" ]; then
  echo ""
  echo "⚠️  Число выросло относительно baseline (${BASELINE}). Новые route.ts должны"
  echo "    следовать docs/SUPABASE_ADMIN_POLICY.md: user-scoped CRUD — без admin-клиента."
  echo ""
  echo "    Проверить новые файлы: git diff --name-only origin/main...HEAD | grep route.ts"
  echo "    и убедиться, что каждый новый supabaseAdmin обоснован политикой."
fi
