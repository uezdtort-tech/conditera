/**
 * POST /api/orders/[id]/purchase-draft — черновик закупки из дефицита заказа
 * (Task 2-b).
 *
 * Повторно считает разбор заказа (src/lib/ops/breakdown.ts) и создаёт
 * purchase_draft (source='order_shortage') + purchase_draft_items по дефициту:
 *   • quantity — shortage в единице СКЛАДА, округление вверх до 0.01
 *     (если склад-позиции нет — в единице рецепта);
 *   • unit — единица inventory_items (или рецепта для no_stock);
 *   • estimated_cost — как в breakdown (ceil → × cost_per_unit).
 *
 * Права: как у GET /api/orders/[id]/breakdown (владелец или ADMIN/SUPER_ADMIN).
 * Ошибки: 401 / 403 / 404; 422 NO_SHORTAGES — дефицита нет.
 *
 * Тело: { note?: string } (опционально; по умолчанию «Дефицит по заказу #<number>»).
 * Ответ 201: { draft: {...}, items: [...] }.
 * Побочный эффект: recordEvent('purchase.draft_created', …) — fire-and-forget.
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { hasAnyRole } from "@/lib/role-guards";
import { getPool } from "@/lib/postgrest/pool";
import { computeOrderBreakdown, shortageForDraft } from "@/lib/ops/breakdown";
import { recordEvent } from "@/lib/ops/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DraftRow = {
  id: string;
  owner_id: string;
  status: string;
  source: string;
  note: string | null;
  created_at: string;
};

type DraftItemRow = {
  id: string;
  draft_id: string;
  inventory_item_id: string | null;
  name: string;
  quantity: string | number;
  unit: string;
  estimated_cost: number | null;
  supplier: string | null;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json(
        { error: "UNAUTHORIZED", message: "Требуется аутентификация" },
        { status: 401 }
      );
    }

    // Тело опционально: пустой body / невалидный JSON — не ошибка.
    let note: string | null = null;
    try {
      const body = (await request.json()) as { note?: unknown };
      if (typeof body?.note === "string" && body.note.trim().length > 0) {
        note = body.note.trim().slice(0, 1000);
      }
    } catch {
      // тела нет — используем дефолтную заметку
    }

    const breakdown = await computeOrderBreakdown(id);
    if (!breakdown) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Заказ не найден" },
        { status: 404 }
      );
    }

    const isOwner =
      breakdown.order.confectioner_id !== null &&
      breakdown.order.confectioner_id === user.id;
    if (!isOwner) {
      const isAdmin = await hasAnyRole(user.id, ["ADMIN", "SUPER_ADMIN"]);
      if (!isAdmin) {
        return NextResponse.json(
          { error: "FORBIDDEN", message: "Нет доступа к заказу" },
          { status: 403 }
        );
      }
    }

    if (breakdown.shortages.length === 0) {
      return NextResponse.json(
        { error: "NO_SHORTAGES", message: "Все ингредиенты в наличии" },
        { status: 422 }
      );
    }

    const ownerId = breakdown.order.confectioner_id;
    if (!ownerId) {
      return NextResponse.json(
        {
          error: "NO_CONFECTIONER",
          message: "У заказа не указан кондитер — некому создавать закупку",
        },
        { status: 422 }
      );
    }

    const pool = getPool();
    const draftNote =
      note ?? `Дефицит по заказу #${breakdown.order.number}`;

    const draftResult = await pool.query<DraftRow>(
      `INSERT INTO public.purchase_drafts (owner_id, status, source, note)
       VALUES ($1::uuid, 'draft', 'order_shortage', $2)
       RETURNING id::text, owner_id::text, status, source, note, created_at`,
      [ownerId, draftNote]
    );
    const draft = draftResult.rows[0];

    // Позиции: quantity в единице склада (ceil до 0.01), supplier — со склада.
    const itemValues = breakdown.shortages.map((s) => {
      const { quantity, unit } = shortageForDraft(s);
      return {
        inventoryItemId: s.inventory_item_id,
        name: s.warehouse_item_name ?? s.name,
        quantity,
        unit,
        estimatedCost: s.estimated_cost,
        supplier: s.supplier,
      };
    });

    const inserted: DraftItemRow[] = [];
    // Мульти-вставка построчно — позиций немного (дефицит), нужен RETURNING.
    for (const it of itemValues) {
      const res = await pool.query<DraftItemRow>(
        `INSERT INTO public.purchase_draft_items
           (draft_id, inventory_item_id, name, quantity, unit, estimated_cost, supplier)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7)
         RETURNING id::text, draft_id::text, inventory_item_id::text, name,
                   quantity, unit, estimated_cost, supplier`,
        [
          draft.id,
          it.inventoryItemId,
          it.name,
          it.quantity,
          it.unit,
          it.estimatedCost,
          it.supplier,
        ]
      );
      inserted.push(res.rows[0]);
    }

    void recordEvent("purchase.draft_created", {
      entityType: "purchase_draft",
      entityId: draft.id,
      actorId: user.id,
      payload: { source: "order_shortage", orderId: breakdown.order.id },
    });

    return NextResponse.json(
      {
        draft,
        items: inserted.map((i) => ({ ...i, quantity: Number(i.quantity) })),
      },
      { status: 201 }
    );
  } catch (err) {
    console.error(
      "[orders/purchase-draft] POST failed:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: "INTERNAL", message: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
