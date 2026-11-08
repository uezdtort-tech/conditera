"use client";

/**
 * ConfectionerProcurement — закупочные заказы кондитера (Z-v17).
 *
 * Реальные операции через /api/purchase-orders (GET свои) и PATCH /api/purchase-orders/[id]:
 *  - отмена (SUBMITTED/CONFIRMED — сервер освобождает резерв);
 *  - подтверждение доставки (SHIPPED → DELIVERED — сервер списывает остаток);
 *  - спор по активному заказу;
 *  - история статусов каждого заказа.
 */

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { csrfFetch } from "@/lib/api-client";
import {
  ClipboardList, XCircle, PackageCheck, AlertTriangle, History, Truck,
} from "lucide-react";

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  DRAFT: { label: "Черновик", className: "bg-stone-100 text-stone-700" },
  SUBMITTED: { label: "Отправлен", className: "bg-amber-100 text-amber-800" },
  CONFIRMED: { label: "Подтверждён", className: "bg-emerald-100 text-emerald-800" },
  REJECTED: { label: "Отклонён", className: "bg-red-100 text-red-800" },
  PROCESSING: { label: "В обработке", className: "bg-blue-100 text-blue-800" },
  READY_FOR_SHIPMENT: { label: "К отгрузке", className: "bg-purple-100 text-purple-800" },
  SHIPPED: { label: "Отгружен", className: "bg-cyan-100 text-cyan-800" },
  DELIVERED: { label: "Доставлен", className: "bg-emerald-100 text-emerald-800" },
  CANCELLED: { label: "Отменён", className: "bg-stone-100 text-stone-500" },
  DISPUTED: { label: "Спор", className: "bg-red-100 text-red-800" },
};

const UNIT_LABELS: Record<string, string> = {
  kg: "кг", g: "г", liter: "л", ml: "мл", piece: "шт", box: "кор.", pack: "уп.",
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
  supplierName: string;
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
  history?: { to_status: string; comment: string | null; created_at: string }[];
}

export function ConfectionerProcurement() {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [disputeFor, setDisputeFor] = useState<PurchaseOrder | null>(null);
  const [disputeText, setDisputeText] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await csrfFetch("/api/purchase-orders");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Ошибка загрузки");
      setOrders(json.orders ?? []);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (order: PurchaseOrder, action: string, extra?: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await csrfFetch(`/api/purchase-orders/${order.id}`, {
        method: "PATCH",
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

  const openHistory = async (order: PurchaseOrder) => {
    try {
      const res = await csrfFetch(`/api/purchase-orders/${order.id}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Ошибка загрузки истории");
      setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, history: json.order.history } : o)));
      setExpanded(expanded === order.id ? null : order.id);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  if (loading) return <Card className="p-6 text-sm text-muted-foreground">Загружаем закупки…</Card>;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-2xl font-bold flex items-center gap-2">
          <ClipboardList className="h-5 w-5" /> Закупки у поставщиков
        </h2>
        <p className="text-xs text-muted-foreground">
          Ваши заказы поставщикам. Подтверждение доставки списывает товар со склада поставщика.
        </p>
      </div>

      {orders.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          <ClipboardList className="h-8 w-8 mx-auto mb-2 opacity-40" />
          Закупок пока нет. Найдите поставщиков в разделе «Поставщики».
        </Card>
      ) : (
        <div className="grid gap-3">
          {orders.map((o) => {
            const badge = STATUS_BADGE[o.status] ?? STATUS_BADGE.DRAFT;
            const active = !["DELIVERED", "REJECTED", "CANCELLED"].includes(o.status);
            return (
              <Card key={o.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-sm">{o.number}</span>
                      <Badge className={badge.className}>{badge.label}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Поставщик: <b className="text-foreground">{o.supplierName}</b> •
                      {" "}{new Date(o.created_at).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} •
                      {" "}{o.delivery_method === "pickup" ? "Самовывоз" : "Доставка"}
                    </div>
                    {o.promised_shipment_date && (
                      <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                        <Truck className="h-3 w-3" /> отгрузка обещана к {new Date(o.promised_shipment_date).toLocaleDateString("ru-RU")}
                      </div>
                    )}
                    {o.rejection_reason && (
                      <p className="text-xs mt-1 text-red-700">Причина отказа: {o.rejection_reason}</p>
                    )}
                    {o.supplier_comment && (
                      <p className="text-xs mt-1 p-2 rounded bg-muted">Поставщик: {o.supplier_comment}</p>
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

                <div className="mt-3 border-t border-border pt-2 space-y-1">
                  {o.items.map((it) => (
                    <div key={it.id} className="flex justify-between text-xs">
                      <span>
                        {it.product_name} — {it.confirmed_quantity ?? it.quantity} {UNIT_LABELS[it.unit] ?? it.unit}
                        {it.confirmed_quantity !== null && it.confirmed_quantity !== it.quantity && (
                          <span className="text-amber-700"> (согласовано из {it.quantity})</span>
                        )}
                      </span>
                      <span className="text-muted-foreground">{(it.line_total / 100).toLocaleString("ru-RU")} ₽</span>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap gap-1.5 mt-3 pt-2 border-t border-border">
                  {(o.status === "SUBMITTED" || o.status === "CONFIRMED") && (
                    <Button size="sm" variant="outline" disabled={busy}
                      onClick={() => act(o, "cancel", { comment: "Отмена покупателем" })}>
                      <XCircle className="h-4 w-4 mr-1" /> Отменить
                    </Button>
                  )}
                  {o.status === "SHIPPED" && (
                    <Button size="sm" disabled={busy} onClick={() => act(o, "confirm_delivery")}>
                      <PackageCheck className="h-4 w-4 mr-1" /> Подтвердить доставку
                    </Button>
                  )}
                  {active && (
                    <Button size="sm" variant="ghost" disabled={busy}
                      onClick={() => { setDisputeFor(o); setDisputeText(""); }}>
                      <AlertTriangle className="h-4 w-4 mr-1" /> Открыть спор
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => openHistory(o)}>
                    <History className="h-4 w-4 mr-1" /> История
                  </Button>
                </div>

                {expanded === o.id && o.history && (
                  <div className="mt-3 pt-2 border-t border-border max-h-40 overflow-y-auto space-y-1">
                    {o.history.map((h, i) => (
                      <div key={i} className="flex gap-2 text-[11px] text-muted-foreground">
                        <span className="shrink-0">{new Date(h.created_at).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                        <span className="shrink-0 font-medium text-foreground">{h.to_status}</span>
                        <span>{h.comment ?? ""}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Спор */}
      <Dialog open={!!disputeFor} onOpenChange={(v) => !v && setDisputeFor(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Открытие спора по {disputeFor?.number}</DialogTitle>
            <DialogDescription>
              Опишите проблему — вторая сторона и поддержка увидят детали.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="disputeText">Описание проблемы</Label>
              <Textarea id="disputeText" rows={3} value={disputeText}
                onChange={(e) => setDisputeText(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDisputeFor(null)}>Отмена</Button>
              <Button variant="destructive" disabled={!disputeText.trim() || busy}
                onClick={async () => {
                  if (disputeFor) {
                    await act(disputeFor, "dispute", { comment: disputeText.trim() });
                    setDisputeFor(null);
                  }
                }}>
                Открыть спор
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
