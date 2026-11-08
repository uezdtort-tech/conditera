/**
 * POST /api/supplier/profile/submit — отправить профиль на модерацию.
 *
 * Переходы (серверные):
 *   draft | changes_requested | rejected → submitted
 * Повторный submit в submitted/under_review/approved/suspended — 409.
 * Перед отправкой валидируются обязательные поля (validateForSubmit).
 * Уведомления: всем ADMIN/SUPER_ADMIN (новая заявка) + подтверждение поставщику.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireRole } from "@/lib/role-guards";
import { getPool } from "@/lib/postgrest/pool";
import { validateForSubmit } from "../route";
import { sendNotification } from "@/lib/notifications";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    const guard = await requireRole(user.id, "SUPPLIER");
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    const { data: profile } = await supabaseAdmin
      .from("supplier_profiles")
      .select("*")
      .eq("userId", user.id)
      .maybeSingle();

    if (!profile) {
      return NextResponse.json({ error: "Профиль не найден" }, { status: 404 });
    }

    const from = profile.verificationStatus as string;
    const allowed = ["draft", "changes_requested", "rejected"];
    if (!allowed.includes(from)) {
      return NextResponse.json(
        { error: `Отправка недоступна из статуса ${from}` },
        { status: 409 }
      );
    }

    const errors = validateForSubmit(profile as unknown as Record<string, unknown>);
    if (errors.length > 0) {
      return NextResponse.json(
        { error: "Заполните обязательные поля", details: errors },
        { status: 400 }
      );
    }

    // CAS: статус мог измениться параллельно.
    const cas = await supabaseAdmin
      .from("supplier_profiles")
      .update({
        verificationStatus: "submitted",
        submittedAt: new Date().toISOString(),
        reviewComment: null,
        updatedAt: new Date().toISOString(),
      })
      .eq("id", profile.id)
      .eq("verificationStatus", from)
      .select("id")
      .single();

    if (cas.error || !cas.data) {
      return NextResponse.json(
        { error: "Статус профиля изменился, обновите страницу" },
        { status: 409 }
      );
    }

    const pool = getPool();
    await pool.query(
      `INSERT INTO supplier_profile_reviews
         (profile_id, action, from_status, to_status, actor_id, actor_role)
       VALUES ($1,'submitted',$2,'submitted',$3,'supplier')`,
      [profile.id, from, user.id]
    );

    // Уведомление администраторам (non-blocking).
    try {
      const admins = await supabaseAdmin
        .from("user_roles")
        .select("user_id")
        .in("role", ["ADMIN", "SUPER_ADMIN"])
        .eq("is_active", true);
      const adminIds = [...new Set((admins.data ?? []).map((r) => r.user_id))];
      for (const adminId of adminIds) {
        await sendNotification({
          userId: adminId,
          template: "SUPPLIER_SUBMITTED",
          vars: { companyName: String(profile.companyName ?? "") },
          data: {
            type: "supplier_verification_submitted",
            supplierProfileId: profile.id,
            companyName: profile.companyName,
          },
          dedupKey: `supplier-submitted:${profile.id}`,
        });
      }
      await sendNotification({
        userId: user.id,
        template: "SUPPLIER_PROFILE_SUBMITTED",
        vars: {},
        data: {
          type: "supplier_profile_submitted",
          dedupKey: `supplier-submitted-ack:${profile.id}`,
        },
        dedupKey: `supplier-submitted-ack:${profile.id}`,
      });
    } catch (notifyErr) {
      console.warn("[supplier/profile/submit] notify failed:", (notifyErr as Error).message);
    }

    return NextResponse.json({
      ok: true,
      status: "submitted",
      message: "Заявка отправлена на проверку",
    });
  } catch (e: any) {
    console.error("[supplier/profile/submit]:", e?.message);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}
