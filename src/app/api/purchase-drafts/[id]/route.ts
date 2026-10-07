/**
 * PATCH /api/purchase-drafts/[id] — управление черновиком закупки (ТЗ §20).
 *
 * Body: { expectedEta?: string | null }  — ISO-дата/время поставки.
 *
 * ETA используется Acceptance Engine: если поставка придёт ПОСЛЕ безопасного
 * старта производства — заказ принять нельзя (CANNOT_ACCEPT); если до —
 * CAN_ACCEPT_WITH_PURCHASE.
 *
 * Права: владелец черновика (кондитер) или ADMIN/SUPER_ADMIN.
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { hasAnyRole } from "@/lib/role-guards";
import { getPool } from "@/lib/postgrest/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "NOT_FOUND", message: "Черновик не найден" }, { status: 404 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json(
        { error: "UNAUTHORIZED", message: "Требуется аутентификация" },
        { status: 401 }
      );
    }

    let body: { expectedEta?: string | null };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "Ожидается JSON" },
        { status: 400 }
      );
    }

    let eta: string | null = null;
    if (body.expectedEta !== undefined && body.expectedEta !== null) {
      const d = new Date(body.expectedEta);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json(
          { error: "BAD_DATE", message: "expectedEta не является датой" },
          { status: 400 }
        );
      }
      eta = d.toISOString();
    }

    const pool = getPool();
    const check = await pool.query<{ owner_id: string }>(
      `SELECT owner_id::text FROM public.purchase_drafts WHERE id = $1::uuid`,
      [id]
    );
    const draft = check.rows[0];
    if (!draft) {
      return NextResponse.json({ error: "NOT_FOUND", message: "Черновик не найден" }, { status: 404 });
    }
    if (draft.owner_id !== user.id) {
      const isAdmin = await hasAnyRole(user.id, ["ADMIN", "SUPER_ADMIN"]);
      if (!isAdmin) {
        return NextResponse.json(
          { error: "FORBIDDEN", message: "Нет доступа к черновику" },
          { status: 403 }
        );
      }
    }

    const res = await pool.query<{ id: string; expected_eta: Date | null }>(
      `UPDATE public.purchase_drafts SET expected_eta = $2::timestamptz, updated_at = now()
       WHERE id = $1::uuid
       RETURNING id::text, expected_eta`,
      [id, eta]
    );

    return NextResponse.json({
      draft: {
        id: res.rows[0].id,
        expectedEta: res.rows[0].expected_eta ? new Date(res.rows[0].expected_eta).toISOString() : null,
      },
    });
  } catch (err) {
    console.error(
      "[purchase-drafts/eta] PATCH failed:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: "INTERNAL", message: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
