/**
 * route.patch-atomic.test.ts — PATCH /api/recipes/[id]: контракт атомарного
 * обновления через ОДИН БД-RPC update_recipe_with_ingredients
 * (Z-v32, ZV31-003, миграция 0081).
 *
 * До Z-v32 route обновлял корень и состав отдельными запросами (UPDATE recipes;
 * DELETE recipe_ingredients; INSERT ...; steps; variants; sources) без общей
 * транзакции — читатель видел промежуточный пустой/частичный состав.
 * Теперь route вызывает один RPC: корень + ВСЕ переданные типы детей в одной
 * транзакции. Файл лочит КОНТРАКТ: ровно один вызов RPC, НИКАКИХ отдельных
 * .delete()/.insert() в таблицы детей, состав аргументов (p_root — только
 * переданные поля + updated_at; p_ingredients/p_substitutes с
 * ingredient_position; NULL для непереданных типов), неизменный формат ответа
 * { data: { id, status, offerLinked }, message } и существующие коды ошибок.
 *
 * supabaseAdmin замокан canned-ответами — реальная БД не затрагивается.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const OWNER = "11111111-1111-4111-8111-111111111101";
const RECIPE_ID = "8806b15e-7d98-44b5-965d-05ba64b48cc7";

const rootRow = {
  id: RECIPE_ID,
  author_id: OWNER,
  title: "Старое название",
  slug: "staroe-nazvanie",
  status: "draft",
  published_at: null,
  updated_at: "2026-11-11T17:00:00.000Z",
};

const rpcState = {
  calls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  data: null as unknown,
  error: null as (Error & { code?: string }) | null,
};

const fromCalls: Array<{ table: string; ops: string[] }> = [];
let currentFrom: { table: string; ops: string[] } | null = null;

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcState.calls.push({ name, args });
      return { data: rpcState.data, error: rpcState.error };
    },
    from: (table: string) => {
      currentFrom = { table, ops: [] };
      fromCalls.push(currentFrom);
      const rec = (op: string) => (..._args: unknown[]) => {
        currentFrom!.ops.push(op);
        return api;
      };
      const api: Record<string, unknown> = {
        select: rec("select"),
        eq: rec("eq"),
        neq: rec("neq"),
        limit: rec("limit"),
        insert: rec("insert"),
        update: rec("update"),
        delete: rec("delete"),
        maybeSingle: () => {
          currentFrom!.ops.push("maybeSingle");
          // Только корневой recipes-SELECT отдаёт строку; остальные (оффер, slug) — пусто
          const data = table === "recipes" ? rootRow : null;
          return Promise.resolve({ data, error: null });
        },
        then: (
          onFulfilled: (v: { data: unknown; error: unknown }) => unknown,
          onRejected?: (e: unknown) => unknown
        ) => Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected),
        catch: (onRejected: (e: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).catch(onRejected),
      };
      return api;
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  getUserFromRequest: vi.fn(async () => ({ userId: OWNER, id: OWNER, roles: ["CONFECTIONER"] })),
}));
vi.mock("@/lib/role-guards", () => ({
  isAdmin: vi.fn(async () => true),
}));

import { PATCH as patchRecipe } from "./route";

const req = (body: Record<string, unknown>) =>
  new NextRequest(`http://localhost:3000/api/recipes/${RECIPE_ID}`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  rpcState.calls = [];
  rpcState.data = null;
  rpcState.error = null;
  fromCalls.length = 0;
  currentFrom = null;
});

describe("PATCH /api/recipes/[id] — атомарный контракт RPC 0081 (ZV31-003)", () => {
  it("правка корня → ровно ОДИН вызов update_recipe_with_ingredients, дети = null, ответ формата не менял", async () => {
    const res = await patchRecipe(req({ title: "Новое название торта" }), {
      params: Promise.resolve({ id: RECIPE_ID }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { id: string; status: string; offerLinked: boolean }; message: string };
    expect(json.data.id).toBe(RECIPE_ID);
    expect(json.data.status).toBe("draft");
    expect(json.data.offerLinked).toBe(false);
    expect(json.message).toBe("Рецепт обновлён");

    expect(rpcState.calls).toHaveLength(1);
    const call = rpcState.calls[0];
    expect(call.name).toBe("update_recipe_with_ingredients");
    expect(call.args.p_recipe_id).toBe(RECIPE_ID);
    const root = call.args.p_root as Record<string, unknown>;
    expect(root.title).toBe("Новое название торта");
    expect(typeof root.slug).toBe("string");
    expect(typeof root.updated_at).toBe("string");
    expect(call.args.p_steps).toBeNull();
    expect(call.args.p_ingredients).toBeNull();
    expect(call.args.p_substitutes).toBeNull();
    expect(call.args.p_variants).toBeNull();
    expect(call.args.p_sources).toBeNull();
  });

  it("правка состава → НЕТ отдельных delete/insert в таблицы детей (одна транзакция RPC)", async () => {
    const res = await patchRecipe(
      req({
        ingredients: [
          { name: "Мука", qty: 500, unit: "г" },
          { name: "Ягоды", qty: 250, unit: "г", substitutes: [{ name: "Крахмал", qty: 30, unit: "г" }] },
        ],
      }),
      { params: Promise.resolve({ id: RECIPE_ID }) }
    );
    expect(res.status).toBe(200);
    // Ни одного .from() в таблицы детей: DELETE/INSERT делает только RPC в БД
    expect(fromCalls.map((c) => c.table)).toEqual(["recipes", "recipe_marketplace"]);

    const call = rpcState.calls[0];
    expect(call.name).toBe("update_recipe_with_ingredients");
    const ingredients = call.args.p_ingredients as Array<Record<string, unknown>>;
    expect(ingredients).toHaveLength(2);
    expect(ingredients[0]).toMatchObject({ recipe_id: RECIPE_ID, name: "Мука", qty: 500, unit: "г", position: 1, sort_order: 0 });
    expect(ingredients[1]).toMatchObject({ name: "Ягоды", qty: 250, unit: "г", position: 2, sort_order: 1 });
    const subs = call.args.p_substitutes as Array<Record<string, unknown>>;
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ ingredient_position: 2, name: "Крахмал", qty: 30, unit: "г", position: 1 });
    // Корень: только bump updated_at (чистая замена состава)
    expect(Object.keys(call.args.p_root as Record<string, unknown>)).toEqual(["updated_at"]);
  });

  it("передан только steps → p_steps заполнен, остальные типы детей = null", async () => {
    const res = await patchRecipe(
      req({ steps: [{ description: "Взбить массу", time_min: 10 }] }),
      { params: Promise.resolve({ id: RECIPE_ID }) }
    );
    expect(res.status).toBe(200);
    const call = rpcState.calls[0];
    const steps = call.args.p_steps as Array<Record<string, unknown>>;
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ recipe_id: RECIPE_ID, position: 1, description: "Взбить массу", time_min: 10 });
    expect(call.args.p_ingredients).toBeNull();
    expect(call.args.p_substitutes).toBeNull();
    expect(call.args.p_variants).toBeNull();
    expect(call.args.p_sources).toBeNull();
  });

  it("пустой массив ingredients → p_ingredients = [] (полная очистка состава)", async () => {
    await patchRecipe(req({ ingredients: [] }), { params: Promise.resolve({ id: RECIPE_ID }) });
    expect(rpcState.calls[0].args.p_ingredients).toEqual([]);
  });

  it("RPC отсутствует (PGRST202) → 500 fail-closed", async () => {
    rpcState.error = Object.assign(new Error("Could not find the function"), { code: "PGRST202" });
    const res = await patchRecipe(req({ title: "Новое название торта" }), {
      params: Promise.resolve({ id: RECIPE_ID }),
    });
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain("0081");
  });

  it("RPC not_found → 404 «Рецепт не найден»", async () => {
    rpcState.error = Object.assign(new Error(`[recipe_patch] not_found:${RECIPE_ID}`), { code: "P0001" });
    const res = await patchRecipe(req({ title: "Новое название торта" }), {
      params: Promise.resolve({ id: RECIPE_ID }),
    });
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("Рецепт не найден");
  });

  it("прочая ошибка RPC (конфликт slug) → 500 с откатом в БД", async () => {
    rpcState.error = Object.assign(new Error('duplicate key value violates unique constraint "recipes_slug_key"'), {
      code: "23505",
    });
    const res = await patchRecipe(req({ title: "Новое название торта" }), {
      params: Promise.resolve({ id: RECIPE_ID }),
    });
    expect(res.status).toBe(500);
  });

  it("некорректное тело (title 2 символа) → 422 без вызова RPC", async () => {
    const res = await patchRecipe(req({ title: "Йа" }), { params: Promise.resolve({ id: RECIPE_ID }) });
    expect(res.status).toBe(422);
    expect(rpcState.calls).toHaveLength(0);
  });
});
