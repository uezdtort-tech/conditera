/**
 * /api/inquiries — проекты индивидуальных изделий и переговоры с кондитерами.
 * GET: запросы пользователя или открытые запросы для кондитера.
 * POST: атомарно создаёт draft + inquiry + negotiations из проекта конструктора.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserFromRequest } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { withClaims } from "@/lib/postgrest/execute";

const projectSchema = z.object({
  productType: z.string().trim().min(1).max(80),
  eventType: z.string().trim().max(80).nullable().optional(),
  base: z.string().trim().max(80).nullable().optional(),
  tiers: z.number().int().min(1).max(10).nullable().optional(),
  shape: z.string().trim().max(80).nullable().optional(),
  filling: z.string().trim().max(80).nullable().optional(),
  coating: z.string().trim().max(80).nullable().optional(),
  decorations: z.array(z.string().trim().min(1).max(80)).max(40).default([]),
  dietary: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  servings: z.number().int().min(1).max(500).default(8),
  quantity: z.number().int().min(1).max(1000).default(1),
  city: z.string().trim().min(2).max(120),
  deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => !Number.isNaN(Date.parse(value)), "Некорректная дата"),
  deliveryType: z.enum(["delivery", "pickup"]),
  address: z.string().trim().max(500).optional().default(""),
  inscription: z.string().max(50).optional().default(""),
  comment: z.string().max(3000).optional().default(""),
}).superRefine((project, ctx) => {
  if (project.deliveryType === "delivery" && !project.address.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["address"], message: "Для доставки укажите адрес" });
  }
});

const submitSchema = z.object({
  project: projectSchema,
  confectionerIds: z.array(z.string().uuid()).min(1).max(20),
  estimatedPriceRubles: z.number().finite().min(0).max(10_000_000),
  estimatedDeliveryCostRubles: z.number().finite().min(0).max(1_000_000).default(0),
  requestDiscount: z.boolean().default(false),
  discountPercent: z.number().int().min(0).max(30).default(0),
  discountComment: z.string().max(1000).default(""),
}).superRefine((body, ctx) => {
  if (new Set(body.confectionerIds).size !== body.confectionerIds.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["confectionerIds"], message: "Список кондитеров содержит дубликаты" });
  }
});

function errorResponse(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return errorResponse("Не авторизован", 401);

    const filter = request.nextUrl.searchParams.get("filter") || "own";
    const city = request.nextUrl.searchParams.get("city");
    let query = supabaseAdmin.from("inquiries").select("*, negotiations:negotiations(*)");

    if (filter === "available") {
      if (!user.roles.includes("CONFECTIONER") && !user.roles.includes("ADMIN") && !user.roles.includes("SUPER_ADMIN")) {
        return errorResponse("Только кондитеры могут просматривать доступные запросы", 403);
      }
      query = query.eq("status", "open");
      if (city) query = query.eq("city", city);
    } else if (filter === "own") {
      query = query.eq("user_id", user.id);
    } else {
      return errorResponse("Неизвестный фильтр запросов", 400);
    }

    const { data, error } = await query.order("submitted_at", { ascending: false });
    if (error) {
      console.error("[inquiries] GET failed:", error.message);
      return errorResponse("Не удалось загрузить запросы", 500);
    }
    const rows = data || [];
    const visible = filter === "available" && !user.roles.includes("ADMIN") && !user.roles.includes("SUPER_ADMIN")
      ? rows.filter((inquiry) => Array.isArray(inquiry.negotiations) && inquiry.negotiations.some((negotiation: { confectioner_id?: string }) => negotiation.confectioner_id === user.id))
      : rows;
    return NextResponse.json({ inquiries: visible });
  } catch (error) {
    console.error("[inquiries] GET error:", error instanceof Error ? error.message : String(error));
    return errorResponse("Внутренняя ошибка сервера", 500);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getUserFromRequest(request);
  if (!user) return errorResponse("Не авторизован", 401);

  const body = await request.json().catch(() => null);
  const parsed = submitSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Проверьте параметры проекта", details: parsed.error.flatten() }, { status: 400 });
  }

  const input = parsed.data;
  const project = input.project;
  const selectedIds = input.confectionerIds;
  if (selectedIds.includes(user.id)) return errorResponse("Нельзя отправить запрос самому себе", 400);
  const priceKopecks = Math.round(input.estimatedPriceRubles * 100);
  const deliveryKopecks = Math.round(input.estimatedDeliveryCostRubles * 100);
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  const projectSpec = {
    ...project,
    price: {
      productRubles: input.estimatedPriceRubles,
      deliveryRubles: input.estimatedDeliveryCostRubles,
      totalRubles: input.estimatedPriceRubles + input.estimatedDeliveryCostRubles,
      productKopecks: priceKopecks,
      deliveryKopecks,
      totalKopecks: priceKopecks + deliveryKopecks,
      isEstimate: true,
    },
  };

  try {
    const result = await withClaims(
      { role: "service_role", sub: user.id, raw: { role: "service_role", sub: user.id } },
      async (client) => {
        const validConfectioners = await client.query<{ user_id: string }>(
          `SELECT DISTINCT ur.user_id::text
             FROM public.user_roles ur
             JOIN public.confectioners c ON c."userId" = ur.user_id::text
            WHERE ur.user_id = ANY($1::uuid[])
              AND ur.role::text = 'CONFECTIONER'
              AND ur.is_active = TRUE
              AND c.verified = TRUE
              AND c."verificationStatus" = 'approved'`,
          [selectedIds]
        );
        const validIds = new Set(validConfectioners.rows.map((row) => row.user_id));
        if (selectedIds.some((id) => !validIds.has(id))) {
          const err = new Error("Один или несколько выбранных кондитеров недоступны") as Error & { status?: number };
          err.status = 422;
          throw err;
        }

        const draftResult = await client.query<{ id: string }>(
          `INSERT INTO public.cake_builder_drafts (
             user_id, product_type, event_type, base, tiers, shape, filling, coating,
             decorations, dietary, servings, quantity, city, delivery_date, delivery_type,
             address, inscription, comment, step, is_submitted, project_spec
           ) VALUES (
             $1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::text[], $10::text[],
             $11, $12, $13, $14::date, $15, $16, $17, $18, 8, TRUE, $19::jsonb
           ) RETURNING id::text`,
          [
            user.id, project.productType, project.eventType || null, project.base || null,
            project.tiers ?? null, project.shape || null, project.filling || null, project.coating || null,
            project.decorations, project.dietary, project.servings, project.quantity, project.city,
            project.deliveryDate, project.deliveryType, project.address, project.inscription, project.comment,
            JSON.stringify(projectSpec),
          ]
        );
        const draftId = draftResult.rows[0]?.id;
        if (!draftId) throw new Error("Не удалось сохранить проект");

        const inquiryResult = await client.query<{ id: string }>(
          `INSERT INTO public.inquiries (
             user_id, product_type, event_type, base, tiers, shape, filling, coating,
             decorations, dietary, servings, quantity, city, delivery_date, delivery_type,
             address, inscription, comment, estimated_price, estimated_delivery_cost,
             project_spec, status, expires_at, negotiations_count
           ) VALUES (
             $1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::text[], $10::text[],
             $11, $12, $13, $14::date, $15, $16, $17, $18, $19, $20,
             $21::jsonb, 'open', $22::timestamptz, $23
           ) RETURNING id::text`,
          [
            user.id, project.productType, project.eventType || null, project.base || null,
            project.tiers ?? null, project.shape || null, project.filling || null, project.coating || null,
            project.decorations, project.dietary, project.servings, project.quantity, project.city,
            project.deliveryDate, project.deliveryType, project.address, project.inscription, project.comment,
            priceKopecks, deliveryKopecks, JSON.stringify(projectSpec), expiresAt, selectedIds.length,
          ]
        );
        const inquiryId = inquiryResult.rows[0]?.id;
        if (!inquiryId) throw new Error("Не удалось создать запрос кондитерам");

        const negotiationsResult = await client.query<{ id: string; confectioner_id: string }>(
          `INSERT INTO public.negotiations (
             inquiry_id, user_id, confectioner_id, discount_requested, discount_percent,
             discount_comment, status, expires_at
           )
           SELECT $1::uuid, $2::uuid, selected.confectioner_id, $4::boolean, $5::integer,
                  $6::text, 'pending_confectioner', $7::timestamptz
             FROM unnest($3::uuid[]) AS selected(confectioner_id)
           RETURNING id::text, confectioner_id::text`,
          [inquiryId, user.id, selectedIds, input.requestDiscount, input.requestDiscount ? input.discountPercent : 0, input.requestDiscount ? input.discountComment : "", expiresAt]
        );

        return { draftId, inquiryId, negotiations: negotiationsResult.rows };
      }
    );

    try {
      const { emitEvent } = await import("@/lib/n8n");
      await emitEvent("inquiry.created", {
        inquiryId: result.inquiryId,
        customerId: user.id,
        confectionerIds: selectedIds,
        negotiationsCount: result.negotiations.length,
      });
    } catch (notificationError) {
      console.warn("[inquiries] notification event failed:", notificationError instanceof Error ? notificationError.message : String(notificationError));
    }

    return NextResponse.json({
      success: true,
      draftId: result.draftId,
      inquiryId: result.inquiryId,
      negotiationsCount: result.negotiations.length,
      negotiations: result.negotiations,
    }, { status: 201 });
  } catch (error) {
    const status = typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: unknown }).status) || 500
      : 500;
    const message = error instanceof Error ? error.message : "Не удалось отправить проект";
    console.error("[inquiries] POST failed:", message);
    return errorResponse(status >= 400 && status < 500 ? message : "Не удалось отправить проект. Попробуйте позже.", status);
  }
}
