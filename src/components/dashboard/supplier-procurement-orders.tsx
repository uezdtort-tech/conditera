"use client";

/**
 * SupplierProcurementOrders — входящие закупочные заказы поставщика (Z-v17).
 *
 * Реальные операции через /api/supplier/orders и /api/supplier/orders/[id]/action:
 *  - подтверждение (с опциональной корректировкой согласованных количеств);
 *  - отклонение с обязательной причиной;
 *  - обработка → готовность к отгрузке (с датой) → отгрузка;
 *  - история статусов каждой операции.
 * Все переходы валидирует сервер (CAS) — гонки дают честный 409.
 */

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { csrfFetch } from "@/lib/api-client";
import {
  ShoppingCart, Check, X, Play, Truck, PackageCheck, History, Package,
} from "lucide-react";

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  DRAFT: { label: "Черновик", className: "bg-stone-100 text-stone-700" },
  SUBMITTED: { label: "Новый", className: "bg-amber-100 text-amber-800" },
  CONFIRMED: { label: "Подтверждён", className: "bg-emerald-100 text-emerald-800" },
  REJECTED: { label: "Отклонён", className: "bg-red-100 text-red-800" },
  PROCESSING: { label: "В обработке", className: "bg-blue-100 text-blue-800" },
  READY_FOR_SHIPMENT: { label: "К отгрузке", className: "bg-purple-100 text-purple-800" },
  SHIPPED: { label: "Отгружен", className: "bg-cyan-100 text-cyan-800" },
  DELIVERED: { label: "Доставлен", className: "bg-emerald-100 text-emerald-800" },
  CANCELLED: { label: "Отменён", className: "bg-stone-100 text-stone-500" },
  DISPUTED: { label: "Спор", className: "bg-red-100 text-red-800" },
};

interface OrderItem {
  id: string;
  product_name: string;
  unit: string;
  quantity: number;
  confirmed_quantity: number | null;
  unit_price: number;
  line_total: number;
}

interface PurchaseOrder {
  id: string;
  number: string;
  status: string;
  buyerName: string;
  subtotal: number;
  confirmed_subtotal: number | null;
  delivery_method: string;
  delivery_address: string | null;
  requested_delivery_date: string | null;
  promised_shipment_date: string | null;
  buyer_comment: string | null;
  supplier_comment: string | null;
  rejection_reason: string | null;
  created_at: string;
  items: OrderItem[];
  history?: { to_status: string; comment: string | null; created_at: string; changed_by_role: string | null }[];
}

export function SupplierProcurementOrders() {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [rejectFor, setRejectFor] = useState<PurchaseOrder | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [confirmFor, setConfirmFor] = useState<PurchaseOrder | null>(null);
  const [adjustedQty, setAdjustedQty] = useState<Record<string, string>>({});
  const [shipDate, setShipDate] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url = statusFilter !== "all"
        ? `/api/supplier/orders?status=${encodeURIComponent(statusFilter)}`
        : "/api/supplier/orders";
      const res = await csrfFetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Ошибка загрузки");
      setOrders(json.orders ?? []);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (
    order: PurchaseOrder,
    action: string,
    extra?: Record<string, unknown>
  ) => {
    setBusy(true);
    try {
      const res = await csrfFetch(`/api/supplier/orders/${order.id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Ошибка действия");
      toast.success(`Заказ ${order.number}: ${json.order.status}`);
      await load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const confirmOrder = async () => {
    if (!confirmFor) return;
    const confirmedItems = confirmFor.items
      .map((it) => {
        const raw = adjustedQty[it.id];
        if (raw === undefined || raw === "" || Number(raw) === it.quantity) return null;
        return { itemId: it.id, quantity: Math.max(0, Number(raw) || 0) };
      })
      .filter(Boolean);
    await act(confirmFor, "confirm", confirmedItems.length ? { confirmedItems } : {});
    setConfirmFor(null);
    setAdjustedQty({});
  };

  const openHistory = async (order: PurchaseOrder) => {
    try {
      const res = await csrfFetch(`/api/purchase-orders/${order.id}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Ошибка загрузки истории");
      setExpanded(expanded === order.id ? null : order.id);
      setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, history: json.order.history } : o)));
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  if (loading) return <Card className="p-6 text-sm text-muted-foreground">Загружаем заказы…</Card>;

  const newCount = orders.filter((o) => o.status === "SUBMITTED").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" /> Закупочные заказы
            {newCount > 0 && <Badge className="bg-amber-100 text-amber-800">новых: {newCount}</Badge>}
          </h2>
          <p className="text-xs text-muted-foreground">Заказы кондитеров на ваш каталог</p>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {["all", "SUBMITTED", "CONFIRMED", "PROCESSING", "READY_FOR_SHIPMENT", "SHIPPED", "DELIVERED", "REJECTED", "CANCELLED", "DISPUTED"].map((s) => (
            <button key={s}
              onClick={() => setStatusFilter(s)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                statusFilter === s ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border text-muted-foreground hover:bg-muted"
              }`}>
              {s === "all" ? "Все" : STATUS_BADGE[s]?.label ?? s}
            </button>
          ))}
        </div>
      </div>

      {orders.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          <Package className="h-8 w-8 mx-auto mb-2 opacity-40" />
          Заказов нет. Они появятся, когда кондитеры закажут ваши товары.
        </Card>
      ) : (
        <div className="grid gap-3">
          {orders.map((o) => {
            const badge = STATUS_BADGE[o.status] ?? STATUS_BADGE.DRAFT;
            const actionable = o.status !== "DELIVERED" && o.status !== "REJECTED" && o.status !== "CANCELLED";
            return (
              <Card key={o.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-sm">{o.number}</span>
                      <Badge className={badge.className}>{badge.label}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Кондитер: <b className="text-foreground">{o.buyerName}</b> •
                      {" "}{new Date(o.created_at).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} •
                      {" "}{o.delivery_method === "pickup" ? "Самовывоз" : "Доставка"}
                      {o.requested_delivery_date && <> • желает к {new Date(o.requested_delivery_date).toLocaleDateString("ru-RU")}</>}
                    </div>
                    {o.buyer_comment && (
                      <p className="text-xs mt-1 p-2 rounded bg-muted">Комментарий: {o.buyer_comment}</p>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-sm">
                      {((o.confirmed_subtotal ?? o.subtotal) / 100).toLocaleString("ru-RU")} ₽
                    </div>
                    {o.confirmed_subtotal !== null && o.confirmed_subtotal !== o.subtotal && (
                      <div className="text-[10px] text-muted-foreground line-through">
                        было {(o.subtotal / 100).toLocaleString("ru-RU")} ₽
                      </div>
                    )}
                  </div>
                </div>

                {/* Позиции */}
                <div className="mt-3 border-t border-border pt-2 space-y-1">
                  {o.items.map((it) => (
                    <div key={it.id} className="flex justify-between text-xs">
                      <span className={it.confirmed_quantity !== null && it.confirmed_quantity !== it.quantity ? "text-amber-700" : ""}>
                        {it.product_name} — {it.confirmed_quantity ?? it.quantity} / {it.quantity} {it.unit}
                        {it.confirmed_quantity !== null && it.confirmed_quantity !== it.quantity && " (согласовано)"}
                      </span>
                      <span className="text-muted-foreground">{(it.line_total / 100).toLocaleString("ru-RU")} ₽</span>
                    </div>
                  ))}
                </div>

                {/* Действия */}
                {actionable && (
                  <div className="flex flex-wrap gap-1.5 mt-3 pt-2 border-t border-border">
                    {o.status === "SUBMITTED" && (
                      <>
                        <Button size="sm" onClick={() => { setConfirmFor(o); setAdjustedQty({}); }} disabled={busy}>
                          <Check className="h-4 w-4 mr-1" /> Подтвердить
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => { setRejectFor(o); setRejectReason(""); }} disabled={busy}>
                          <X className="h-4 w-4 mr-1" /> Отклонить
                        </Button>
                      </>
                    )}
                    {o.status === "CONFIRMED" && (
                      <Button size="sm" onClick={() => act(o, "process")} disabled={busy}>
                        <Play className="h-4 w-4 mr-1" /> В обработку
                      </Button>
                    )}
                    {o.status === "PROCESSING" && (
                      <Button size="sm" onClick={() => act(o, "ready_for_shipment", { promisedShipmentDate: shipDate[o.id] || undefined })} disabled={busy}>
                        <PackageCheck className="h-4 w-4 mr-1" /> Готов к отгрузке
                      </Button>
                    )}
                    {o.status === "READY_FOR_SHIPMENT" && (
                      <div className="flex items-center gap-2">
                        <Input type="date" className="h-8 text-xs w-36"
                          value={shipDate[o.id] ?? ""}
                          onChange={(e) => setShipDate((s) => ({ ...s, [o.id]: e.target.value }))} />
                        <Button size="sm" onClick={() => act(o, "ship")} disabled={busy}>
                          <Truck className="h-4 w-4 mr-1" /> Отгрузить
                        </Button>
                      </div>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => openHistory(o)}>
                      <History className="h-4 w-4 mr-1" /> История
                    </Button>
                  </div>
                )}

                {o.rejection_reason && (
                  <p className="text-xs mt-2 text-red-700">Причина отказа: {o.rejection_reason}</p>
                )}

                {/* История */}
                {expanded === o.id && o.history && (
                  <div className="mt-3 pt-2 border-t border-border max-h-40 overflow-y-auto space-y-1">
                    {o.history.map((h, i) => (
                      <div key={i} className="flex gap-2 text-[11px] text-muted-foreground">
                        <span className="shrink-0">{new Date(h.created_at).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                        <span className="shrink-0 font-medium text-foreground">{h.to_status}</span>
                        <span>{h.comment ?? ""} {h.changed_by_role ? `(${h.changed_by_role})` : ""}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Отклонение */}
      <Dialog open={!!rejectFor} onOpenChange={(v) => !v && setRejectFor(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Отклонение заказа {rejectFor?.number}</DialogTitle>
            <DialogDescription>
              Причина обязательна — её увидит кондитер. Резерв по заказу будет освобождён автоматически.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="rejReason">Причина (минимум 10 символов)</Label>
              <Textarea id="rejReason" rows={3} value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRejectFor(null)}>Отмена</Button>
              <Button variant="destructive" disabled={rejectReason.trim().length < 10 || busy}
                onClick={async () => { if (rejectFor) { await act(rejectFor, "reject", { reason: rejectReason.trim() }); setRejectFor(null); } }}>
                Отклонить
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Подтверждение с корректировкой */}
      <Dialog open={!!confirmFor} onOpenChange={(v) => !v && setConfirmFor(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Подтверждение заказа {confirmFor?.number}</DialogTitle>
            <DialogDescription>
              Если можете поставить меньше — укажите согласованное количество. Кондитер увидит изменение.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {confirmFor?.items.map((it) => (
              <div key={it.id} className="flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate">{it.product_name}</p>
                  <p className="text-xs text-muted-foreground">
                    заказано {it.quantity} {it.unit} • {(it.unit_price / 100).toLocaleString("ru-RU")} ₽/{it.unit}
                  </p>
                </div>
                <div className="w-24 shrink-0">
                  <Input type="number" min={0} max={it.quantity} value={adjustedQty[it.id] ?? String(it.quantity)}
                    onChange={(e) => setAdjustedQty((s) => ({ ...s, [it.id]: e.target.value }))} />
                </div>
              </div>
            ))}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmFor(null)}>Отмена</Button>
              <Button onClick={confirmOrder} disabled={busy}>Подтвердить</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
