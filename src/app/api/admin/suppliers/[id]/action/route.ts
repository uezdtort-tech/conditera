/**
 * POST /api/admin/suppliers/[id]/action — действия модерации поставщика.
 *
 * Body: { action, comment?, reason? }
 *   start_review      submitted → under_review
 *   approve           submitted | under_review → approved
 *   reject            submitted | under_review → rejected (reason >= 10 симв.)
 *   request_changes   submitted | under_review → changes_requested (comment обязателен)
 *   suspend           approved → suspended (reason обязателен)
 *   resume            suspended → approved
 *
 * Каждое действие: проверка роли на сервере, проверка допустимости перехода
 * (CAS по текущему статусу), запись автора и времени в журнал
 * supplier_profile_reviews, уведомление поставщику.
 * Поставщик НЕ может вызвать этот роут (роль SUPPLIER → 403), статус
 * профиля меняется только здесь.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";
import { getPool } from "@/lib/postgrest/pool";
import { sendNotification } from "@/lib/notifications";

export const runtime = "nodejs";

type Action =
  | "start_review"
  | "approve"
  | "reject"
  | "request_changes"
  | "suspend"
  | "resume";

const TRANSITIONS: Record<Action, { from: string[]; to: string; needReason?: boolean; needComment?: boolean }> = {
  start_review: { from: ["submitted"], to: "under_review" },
  approve: { from: ["submitted", "under_review"], to: "approved" },
  reject: { from: ["submitted", "under_review"], to: "rejected", needReason: true },
  request_changes: { from: ["submitted", "under_review"], to: "changes_requested", needComment: true },
  suspend: { from: ["approved"], to: "suspended", needReason: true },
  resume: { from: ["suspended"], to: "approved" },
};

const MIN_REASON = 10;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    const guard = await requireAnyRole(user.id, ["ADMIN", "SUPER_ADMIN"]);
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    const { id: profileId } = await params;
    const body = (await request.json()) as { action?: string; comment?: string; reason?: string };
    const action = body.action as Action;
    if (!action || !TRANSITIONS[action]) {
      return NextResponse.json({ error: "Недопустимое действие" }, { status: 400 });
    }
    const rule = TRANSITIONS[action];
    const text = (body.reason ?? body.comment ?? "").trim();
    if (rule.needReason && text.length < MIN_REASON) {
      return NextResponse.json(
        { error: `Укажите причину (минимум ${MIN_REASON} символов)` },
        { status: 400 }
      );
    }
    if (rule.needComment && text.length < MIN_REASON) {
      return NextResponse.json(
        { error: `Опишите замечания (минимум ${MIN_REASON} символов)` },
        { status: 400 }
      );
    }

    // Читаем текущий профиль.
    const { data: profile } = await supabaseAdmin
      .from("supplier_profiles")
      .select("id, userId, companyName, verificationStatus, isActive")
      .eq("id", profileId)
      .maybeSingle();
    if (!profile) return NextResponse.json({ error: "Профиль не найден" }, { status: 404 });

    const from = profile.verificationStatus as string;
    if (!rule.from.includes(from)) {
      return NextResponse.json(
        { error: `Действие недопустимо из статуса ${from}` },
        { status: 409 }
      );
    }

    // CAS-обновление статуса + сопутствующие поля.
    const now = new Date().toISOString();
    const update: Record<string, unknown> = {
      verificationStatus: rule.to,
      reviewedBy: user.id,
      reviewedAt: now,
      reviewComment: text || null,
      updatedAt: now,
    };
    if (rule.to === "approved") {
      update.isActive = true;
      update.suspendedAt = null;
    }
    if (rule.to === "submitted") update.submittedAt = now;
    if (rule.to === "suspended") {
      update.suspendedAt = now;
      update.isActive = false;
    }
    if (rule.to === "rejected") update.isActive = false;

    const cas = await supabaseAdmin
      .from("supplier_profiles")
      .update(update)
      .eq("id", profileId)
      .eq("verificationStatus", from) // CAS: статус не изменился параллельно
      .select("id")
      .single();

    if (cas.error || !cas.data) {
      return NextResponse.json(
        { error: "Статус изменился другим запросом, обновите данные" },
        { status: 409 }
      );
    }

    // Журнал модерации (имена действий согласованы с CHECK-констрейнтом).
    const pool = getPool();
    const actionName: Record<Action, string> = {
      start_review: "under_review",
      approve: "approved",
      reject: "rejected",
      request_changes: "changes_requested",
      suspend: "suspended",
      resume: "resumed",
    };
    await pool.query(
      `INSERT INTO supplier_profile_reviews
         (profile_id, action, from_status, to_status, actor_id, actor_role, comment)
       VALUES ($1,$2,$3,$4,$5,'admin',$6)`,
      [profileId, actionName[action], from, rule.to, user.id, text || null]
    );

    // Уведомление поставщику (non-blocking).
    try {
      const notifyMap: Record<Action, () => Parameters<typeof sendNotification>[0]> = {
        start_review: () => ({
          userId: profile.userId,
          template: "ORDER_STATUS_CHANGED",
          vars: { orderNumber: profile.companyName, status: "under_review" },
          data: { type: "supplier_profile_under_review", dedupKey: `sup-review:${profileId}:${now}` },
          dedupKey: `sup-review:${profileId}:${now}`,
        }),
        approve: () => ({
          userId: profile.userId,
          template: "SUPPLIER_APPROVED",
          vars: {},
          data: { type: "supplier_profile_approved", supplierProfileId: profileId },
          dedupKey: `sup-approved:${profileId}:${from}`,
        }),
        reject: () => ({
          userId: profile.userId,
          template: "VERIFICATION_REJECTED",
          vars: { reason: text },
          data: { type: "supplier_profile_rejected", supplierProfileId: profileId },
          dedupKey: `sup-rejected:${profileId}:${now}`,
        }),
        request_changes: () => ({
          userId: profile.userId,
          template: "SUPPLIER_CHANGES_REQUESTED",
          vars: { comment: text },
          data: { type: "supplier_changes_requested", supplierProfileId: profileId },
          dedupKey: `sup-changes:${profileId}:${now}`,
        }),
        suspend: () => ({
          userId: profile.userId,
          template: "SUPPLIER_SUSPENDED",
          vars: { reason: text },
          data: { type: "supplier_suspended", supplierProfileId: profileId },
          dedupKey: `sup-suspended:${profileId}:${now}`,
        }),
        resume: () => ({
          userId: profile.userId,
          template: "SUPPLIER_APPROVED",
          vars: {},
          data: { type: "supplier_profile_resumed", supplierProfileId: profileId },
          dedupKey: `sup-resumed:${profileId}:${now}`,
        }),
      };
      await sendNotification(notifyMap[action]());
    } catch (notifyErr) {
      console.warn("[admin/suppliers/action] notify failed:", (notifyErr as Error).message);
    }

    return NextResponse.json({ ok: true, status: rule.to });
  } catch (e: any) {
    console.error("[admin/suppliers/action]:", e?.message);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}
