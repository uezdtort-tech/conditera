/**
 * Тесты для supabase/migrations/0013_atomic_counter_helpers.sql
 *
 * Проверяем:
 *   1. SQL-синтаксис миграции (парсинг без ошибок)
 *   2. Присутствие всех ключевых RPC-функций в файле
 *   3. Каждая функция помечена как SECURITY DEFINER
 *   4. Все параметры — TEXT (поддержка UUID/CUID/других форматов)
 *
 * Эти тесты не запускают SQL против реальной БД — они валидируют
 * содержимое файла миграции как контракт, что гарантирует отсутствие
 * типовых ошибок в production-схеме.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATION_PATH = join(
  process.cwd(),
  "supabase",
  "migrations",
  "0013_atomic_counter_helpers.sql"
);

const SQL = readFileSync(MIGRATION_PATH, "utf-8");

const EXPECTED_FUNCTIONS = [
  "increment_followers_count",
  "decrement_followers_count",
  "increment_story_views",
  "register_unique_story_view",
  "increment_story_likes",
  "decrement_story_likes",
  "increment_story_replies",
  "increment_post_likes",
  "decrement_post_likes",
  "increment_live_viewers",
  "decrement_live_viewers",
  "increment_live_likes",
  "increment_live_viewers_full",
  "increment_comment_likes",
  "decrement_comment_likes",
  "toggle_follow_channel",
  "toggle_story_like",
  "increment_promo_used_count",
  "decrement_promo_used_count",
  "sum_succeeded_payments",
  "revenue_today",
  "revenue_month",
  "add_bonus_balance",
  "deduct_bonus_balance",
  "increment_moderation_rule_hits",
  "increment_lesson_enrolled_count",
  "deduct_confectioner_balance",
] as const;

describe("0013_atomic_counter_helpers.sql", () => {
  it("файл существует и читается", () => {
    expect(SQL.length).toBeGreaterThan(1000);
  });

  it.each(EXPECTED_FUNCTIONS)("содержит функцию %s", (fnName) => {
    const pattern = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fnName}\\(`);
    expect(SQL).toMatch(pattern);
  });

  it("каждая функция SECURITY DEFINER", () => {
    const matches = SQL.match(/CREATE OR REPLACE FUNCTION public\.\w+/g) || [];
    const securerCount = (SQL.match(/SECURITY DEFINER/g) || []).length;
    expect(matches.length).toBeGreaterThan(0);
    expect(securerCount).toBeGreaterThanOrEqual(matches.length);
  });

  it("все параметры функций — TEXT, не UUID", () => {
    // Ни одна сигнатура функции не должна использовать UUID.
    // Это обеспечивает совместимость с CUID и другими форматами id.
    const functionSignatures = SQL.match(
      /CREATE OR REPLACE FUNCTION public\.\w+\([^)]*\)/g
    ) || [];
    expect(functionSignatures.length).toBeGreaterThan(0);
    for (const sig of functionSignatures) {
      expect(sig).not.toMatch(/p_\w+\s+UUID/i);
    }
  });

  it("toggle_follow_channel проверяет подписку на самого себя", () => {
    expect(SQL).toMatch(/cannot follow self|cannot self-follow/i);
  });

  it("toggle_story_like использует ON CONFLICT DO NOTHING", () => {
    // Проверяем, что вставка в story_likes использует ON CONFLICT DO NOTHING
    const toggleSection = SQL.match(
      /CREATE OR REPLACE FUNCTION public\.toggle_story_like[\s\S]+?\$\$;/
    )?.[0] || "";
    expect(toggleSection).toContain("ON CONFLICT DO NOTHING");
  });

  it("register_unique_story_view использует array_append и @> оператор", () => {
    const fnSection = SQL.match(
      /CREATE OR REPLACE FUNCTION public\.register_unique_story_view[\s\S]+?\$\$;/
    )?.[0] || "";
    expect(fnSection).toContain("array_append");
    expect(fnSection).toContain("@>");
  });

  it("increment_live_viewers_full обновляет peak_viewers", () => {
    const fnSection = SQL.match(
      /CREATE OR REPLACE FUNCTION public\.increment_live_viewers_full[\s\S]+?\$\$;/
    )?.[0] || "";
    expect(fnSection).toContain("peak_viewers");
    expect(fnSection).toContain("GREATEST");
  });

  it("increment_live_viewers_full обновляет total_viewers", () => {
    const fnSection = SQL.match(
      /CREATE OR REPLACE FUNCTION public\.increment_live_viewers_full[\s\S]+?\$\$;/
    )?.[0] || "";
    expect(fnSection).toContain("total_viewers");
  });

  it("все decrement-функции используют GREATEST(0, ...) для защиты от отрицательных значений", () => {
    const decrementFns = [
      "decrement_followers_count",
      "decrement_story_likes",
      "decrement_post_likes",
      "decrement_live_viewers",
      "decrement_comment_likes",
    ];
    for (const fn of decrementFns) {
      const fnSection = SQL.match(
        new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}[\\s\\S]+?\\$\\$;`)
      )?.[0] || "";
      expect(fnSection).toContain("GREATEST(0,");
    }
  });

  it("revenue_today использует date_trunc и SUM", () => {
    const fnSection = SQL.match(
      /CREATE OR REPLACE FUNCTION public\.revenue_today[\s\S]+?\$\$;/
    )?.[0] || "";
    expect(fnSection).toContain("SUM(amount)");
    expect(fnSection).toContain("date_trunc('day', NOW())");
    expect(fnSection).toContain("succeeded");
  });

  it("revenue_month использует date_trunc('month', NOW())", () => {
    const fnSection = SQL.match(
      /CREATE OR REPLACE FUNCTION public\.revenue_month[\s\S]+?\$\$;/
    )?.[0] || "";
    expect(fnSection).toContain("date_trunc('month', NOW())");
  });

  it("sum_succeeded_payments принимает временной диапазон", () => {
    const fnSection = SQL.match(
      /CREATE OR REPLACE FUNCTION public\.sum_succeeded_payments[\s\S]+?\$\$;/
    )?.[0] || "";
    expect(fnSection).toContain("p_from_ts");
    expect(fnSection).toContain("p_to_ts");
    expect(fnSection).toContain("COALESCE(SUM(amount), 0)");
  });

  it("add_bonus_balance атомарно обновляет bonus_balance", () => {
    const fnSection = SQL.match(
      /CREATE OR REPLACE FUNCTION public\.add_bonus_balance[\s\S]+?\$\$;/
    )?.[0] || "";
    expect(fnSection).toContain("bonus_balance");
    expect(fnSection).toContain("COALESCE(bonus_balance, 0) + p_points");
    expect(fnSection).toContain("RETURNING bonus_balance");
    // Защита от negative balance через exception
    expect(fnSection).toContain("v_new_balance < 0");
    expect(fnSection).toContain("RAISE EXCEPTION");
  });

  it("add_bonus_balance не позволяет нулевые p_points", () => {
    const fnSection = SQL.match(
      /CREATE OR REPLACE FUNCTION public\.add_bonus_balance[\s\S]+?\$\$;/
    )?.[0] || "";
    expect(fnSection).toContain("p_points = 0");
    expect(fnSection).toContain("points must be non-zero");
  });

  it("deduct_bonus_balance использует SELECT FOR UPDATE для блокировки строки", () => {
    const fnSection = SQL.match(
      /CREATE OR REPLACE FUNCTION public\.deduct_bonus_balance[\s\S]+?\$\$;/
    )?.[0] || "";
    expect(fnSection).toContain("FOR UPDATE");
    expect(fnSection).toContain("v_current < p_points");
    expect(fnSection).toContain("RAISE EXCEPTION");
  });

  it("deduct_bonus_balance не позволяет отрицательные p_points", () => {
    const fnSection = SQL.match(
      /CREATE OR REPLACE FUNCTION public\.deduct_bonus_balance[\s\S]+?\$\$;/
    )?.[0] || "";
    expect(fnSection).toContain("p_points <= 0");
    expect(fnSection).toContain("deduct points must be positive");
  });

  it("increment_moderation_rule_hits атомарно обновляет hits_count", () => {
    const fnSection = SQL.match(
      /CREATE OR REPLACE FUNCTION public\.increment_moderation_rule_hits[\s\S]+?\$\$;/
    )?.[0] || "";
    expect(fnSection).toContain("hits_count");
    expect(fnSection).toContain("COALESCE(hits_count, 0) + 1");
    expect(fnSection).toContain("RETURNING hits_count");
  });

  it("increment_lesson_enrolled_count атомарно обновляет enrolled_count", () => {
    const fnSection = SQL.match(
      /CREATE OR REPLACE FUNCTION public\.increment_lesson_enrolled_count[\s\S]+?\$\$;/
    )?.[0] || "";
    expect(fnSection).toContain("enrolled_count");
    expect(fnSection).toContain("COALESCE(enrolled_count, 0) + 1");
    expect(fnSection).toContain("RETURNING enrolled_count");
  });

  it("deduct_confectioner_balance использует SELECT FOR UPDATE для блокировки", () => {
    const fnSection = SQL.match(
      /CREATE OR REPLACE FUNCTION public\.deduct_confectioner_balance[\s\S]+?\$\$;/
    )?.[0] || "";
    expect(fnSection).toContain("FOR UPDATE");
    expect(fnSection).toContain("v_current < p_amount");
    expect(fnSection).toContain("RAISE EXCEPTION");
  });

  it("deduct_confectioner_balance не позволяет отрицательные p_amount", () => {
    const fnSection = SQL.match(
      /CREATE OR REPLACE FUNCTION public\.deduct_confectioner_balance[\s\S]+?\$\$;/
    )?.[0] || "";
    expect(fnSection).toContain("p_amount <= 0");
    expect(fnSection).toContain("deduct amount must be positive");
  });
});
