"use client";

/**
 * order-breakdown-dialog.tsx — разбор заказа по ингредиентам (Task 3-D).
 *
 * Данные:
 *   • GET /api/orders/{id}/breakdown — состав заказа + дефицит склада;
 *   • POST /api/orders/{id}/purchase-draft — создать черновик закупки из дефицита
 *     (201 {draft, items} | 422 NO_SHORTAGES).
 *
 * Статусы ингредиентов: ok→emerald, shortage→red, no_stock→amber, unit_mismatch→slate.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Loader2, PackageSearch, RefreshCw, XCircle } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { csrfFetch, getCsrfToken, getSessionAuthHeaders } from "@/lib/api-client";
import { formatRub, type BreakdownIngredient, type OrderBreakdownResponse } from "@/lib/ops-client-types";

function IngredientStatusBadge({ ing }: { ing: BreakdownIngredient }) {
  switch (ing.status) {
    case "ok":
      return (
        <Badge variant="outline" className="text-[10px] border-emerald-200 bg-emerald-50 text-emerald-700">
          🟢 В наличии
        </Badge>
      );
    case "shortage":
      return (
        <Badge variant="outline" className="text-[10px] border-red-200 bg-red-50 text-red-700">
          🔴 Не хватает {Math.round(Math.max(0, ing.required - ing.stock) * 100) / 100} {ing.unit}
        </Badge>
      );
    case "no_stock":
      return (
        <Badge variant="outline" className="text-[10px] border-amber-200 bg-amber-50 text-amber-700">
          ⚠ Нет на складе
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="text-[10px] border-slate-200 text-slate-600">
          Ед. изм. не совпадает
        </Badge>
      );
  }
}

export function OrderBreakdownDialog({
  orderId,
  open,
  onOpenChange,
  onCreated,
}: {
  orderId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (draftId: string) => void;
}) {
  const queryClient = useQueryClient();

  const breakdownQuery = useQuery({
    queryKey: ["order-breakdown", orderId],
    enabled: open && !!orderId,
    queryFn: async (): Promise<OrderBreakdownResponse> => {
      const res = await csrfFetch(`/api/orders/${orderId}/breakdown`);
      if (!res.ok) throw new Error(`Не удалось разобрать заказ (HTTP ${res.status})`);
      return (await res.json()) as OrderBreakdownResponse;
    },
  });

  const createDraftMutation = useMutation({
    mutationFn: async (): Promise<{ draft: { id: string; status: string } }> => {
      const res = await csrfFetch(`/api/orders/${orderId}/purchase-draft`, {
        method: "POST",
        headers: await getSessionAuthHeaders(await getCsrfToken()),
        body: JSON.stringify({}),
      });
      if (res.status === 422) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        if (err?.error === "NO_SHORTAGES") throw new Error("Нет дефицита — закупка не требуется");
        throw new Error(err?.error || "Невозможно создать черновик закупки");
      }
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(err?.error || `HTTP ${res.status}`);
      }
      return (await res.json()) as { draft: { id: string; status: string } };
    },
    onSuccess: (data) => {
      toast.success("Черновик закупки создан", {
        description: `Статус: ${data.draft.status} — смотрите список закупок`,
      });
      void queryClient.invalidateQueries({ queryKey: ["ops-today"] });
      void breakdownQuery.refetch();
      onCreated?.(data.draft.id);
    },
    onError: (error: Error) => {
      toast.error("Не удалось создать черновик закупки", { description: error.message });
    },
  });

  const data = breakdownQuery.data;
  const shortages = data?.shortages ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap pr-6">
            <ClipboardList className="h-5 w-5 text-primary" />
            Разбор заказа{data?.order.number ? ` № ${data.order.number}` : ""}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {data?.order.delivery_date && (
              <span>Дата выдачи: {new Date(data.order.delivery_date).toLocaleDateString("ru-RU")}</span>
            )}
            {data &&
              (data.can_produce ? (
                <Badge variant="outline" className="text-[10px] border-emerald-200 bg-emerald-50 text-emerald-700">
                  ✅ Можно производить
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] border-red-200 bg-red-50 text-red-700">
                  ❌ Дефицит {shortages.length} поз. (≈{formatRub(data.total_shortage_cost)})
                </Badge>
              ))}
          </DialogDescription>
        </DialogHeader>

        {breakdownQuery.isLoading ? (
          <div className="py-10 flex flex-col items-center gap-2 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            <p className="text-sm">Разбираем заказ по ингредиентам...</p>
          </div>
        ) : breakdownQuery.error ? (
          <div className="py-8 text-center space-y-3">
            <p className="text-sm text-destructive">
              {(breakdownQuery.error as Error).message || "Ошибка загрузки разбора"}
            </p>
            <Button variant="outline" size="sm" onClick={() => void breakdownQuery.refetch()}>
              <RefreshCw className="h-4 w-4 mr-1" />
              Повторить
            </Button>
          </div>
        ) : data ? (
          <>
            {/* Позиции заказа */}
            <div className="flex flex-wrap gap-1.5">
              {data.items.map((it, idx) => (
                <Badge key={`${it.product_id}-${idx}`} variant="secondary" className="text-[11px] font-normal">
                  {it.title} × {it.quantity}
                </Badge>
              ))}
            </div>

            {/* Ингредиенты */}
            <div className="rounded-lg border border-border max-h-96 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ингредиент</TableHead>
                    <TableHead className="text-right">Нужно</TableHead>
                    <TableHead className="text-right">На складе</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead className="text-right">Оценка</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.ingredients.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-6">
                        <PackageSearch className="h-5 w-5 mx-auto mb-1" />
                        Рецепт не привязан или состав пуст — ингредиенты не определены
                      </TableCell>
                    </TableRow>
                  ) : (
                    data.ingredients.map((ing, idx) => (
                      <TableRow key={`${ing.name}-${idx}`}>
                        <TableCell className="font-medium text-sm">{ing.name}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          {Math.round(ing.required * 100) / 100} {ing.unit}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          {Math.round(ing.stock * 100) / 100} {ing.unit}
                        </TableCell>
                        <TableCell>
                          <IngredientStatusBadge ing={ing} />
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          {ing.estimated_cost > 0 ? formatRub(ing.estimated_cost) : "—"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </>
        ) : null}

        <DialogFooter className="flex-col sm:flex-row gap-2 pt-2 border-t">
          {data && !data.can_produce && shortages.length > 0 && (
            <div className="flex-1 text-left text-xs text-muted-foreground self-center">
              Дефицит: {shortages.map((s) => s.name).slice(0, 3).join(", ")}
              {shortages.length > 3 ? ` +${shortages.length - 3}` : ""} · ≈{formatRub(data.total_shortage_cost)}
            </div>
          )}
          <Button
            type="button"
            disabled={createDraftMutation.isPending || !data || shortages.length === 0}
            onClick={() => createDraftMutation.mutate()}
          >
            {createDraftMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <ClipboardList className="h-4 w-4 mr-1" />
            )}
            Создать закупку
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <XCircle className="h-4 w-4 mr-1" />
            Закрыть
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
