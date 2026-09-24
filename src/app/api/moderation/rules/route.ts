/**
 * GET  /api/moderation/rules — список правил модерации
 * POST /api/moderation/rules — создать новое правило (только ADMIN)
 *
 * Тело POST (валидируется через zod):
 *  {
 *    "name": "string 2-200",
 *    "description": "string optional max 1000",
 *    "ruleType": "regex" | "keywords" | "url_pattern" | "email_pattern",
 *    "pattern": "string 1-2000",
 *    "caseSensitive": "boolean (default false)",
 *    "wholeWord": "boolean (default false)",
 *    "violation": "string 1-50",
 *    "action": "reject" | "flag" | "warn" (default "flag"),
 *    "isActive": "boolean (default true)"
 *  }
 *
 * Auth GET:  ADMIN или MODERATOR
 * Auth POST: только ADMIN
 *
 * Соответствует таблице: moderation_rules
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole, requireRole } from "@/lib/role-guards";
import { z } from "zod";

export const runtime = "nodejs";

const createRuleSchema = z.object({
  name: z.string().min(2).max(200),
  description: z.string().max(1000).optional(),
  ruleType: z.enum(["regex", "keywords", "url_pattern", "email_pattern"]),
  pattern: z.string().min(1).max(2000),
  caseSensitive: z.boolean().default(false),
  wholeWord: z.boolean().default(false),
  violation: z.string().min(1).max(50),
  action: z.enum(["reject", "flag", "warn"]).default("flag"),
  isActive: z.boolean().default(true),
});

/**
 * GET /api/moderation/rules — получить список правил.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    // Проверка роли — ADMIN или MODERATOR
    const guard = await requireAnyRole(user.id, ["ADMIN", "MODERATOR"]);
    if (guard) {
      return new NextResponse(guard.body, {
        status: guard.status,
        headers: guard.headers,
      });
    }

    const { data: rules, error } = await supabaseAdmin
      .from("moderation_rules")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[moderation/rules] GET error:", error.message);
      return NextResponse.json(
        { error: "Database query failed", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ rules: rules || [] });
  } catch (error: any) {
    console.error("GET /api/moderation/rules error:", error?.message);
    return NextResponse.json(
      { error: "Internal error", detail: error?.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/moderation/rules — создать новое правило модерации.
 * Только ADMIN.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    // Проверка роли — только ADMIN
    const guard = await requireRole(user.id, "ADMIN");
    if (guard) {
      return new NextResponse(guard.body, {
        status: guard.status,
        headers: guard.headers,
      });
    }

    const body = await request.json();
    const parse = createRuleSchema.safeParse(body);

    if (!parse.success) {
      return NextResponse.json(
        { error: "Invalid data", details: parse.error.flatten() },
        { status: 400 }
      );
    }

    const data = parse.data;

    // Создать правило в БД (snake_case mapping)
    const { data: rule, error } = await supabaseAdmin
      .from("moderation_rules")
      .insert({
        name: data.name,
        description: data.description || null,
        rule_type: data.ruleType,
        pattern: data.pattern,
        case_sensitive: data.caseSensitive,
        whole_word: data.wholeWord,
        violation: data.violation,
        action: data.action,
        is_active: data.isActive,
        created_by: user.id,
      })
      .select()
      .single();

    if (error) {
      console.error("[moderation/rules] POST error:", error.message);
      return NextResponse.json(
        { error: "Database insert failed", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ rule }, { status: 201 });
  } catch (error: any) {
    console.error("POST /api/moderation/rules error:", error?.message);
    return NextResponse.json(
      { error: "Internal error", detail: error?.message },
      { status: 500 }
    );
  }
}
