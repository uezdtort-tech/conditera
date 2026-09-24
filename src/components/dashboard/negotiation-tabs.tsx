import { toast } from "sonner";
"use client";

import { useAppStore } from "@/lib/store";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Trash2,
  Save,
  Send,
  Check,
  X,
  Clock,
  AlertCircle,
  FileText,
  History,
  ShoppingBag,
  CheckCircle2,
  MessageCircle,
  Edit,
  RotateCcw,
} from "lucide-react";
import { formatCurrency, formatDateTime } from "@/lib/finance";
import type { NegotiationItem, OrderNegotiation } from "@/lib/types";

const STATUS_INFO: Record<string, { label: string; color: string; icon: any }> = {
  pending_confectioner: { label: "Ждёт вашей реакции", color: "bg-amber-100 text-amber-800 border-amber-200", icon: Clock },
  pending_customer: { label: "Ждёт ответа покупателя", color: "bg-blue-100 text-blue-800 border-blue-200", icon: Send },
  approved: { label: "Одобрено покупателем", color: "bg-emerald-100 text-emerald-800 border-emerald-200", icon: CheckCircle2 },
  rejected: { label: "Отклонено покупателем", color: "bg-red-100 text-red-800 border-red-200", icon: X },
  expired: { label: "Срок истёк", color: "bg-slate-100 text-slate-800 border-slate-200", icon: AlertCircle },
  revised: { label: "Пересмотрено", color: "bg-purple-100 text-purple-800 border-purple-200", icon: History },
};

const ITEM_CATEGORIES = [
  { value: "cake", label: "🎂 Торт" },
  { value: "filling", label: "🍰 Начинка" },
  { value: "coating", label: "🎨 Покрытие" },
  { value: "decoration", label: "✨ Декор" },
  { value: "service", label: "📝 Услуга" },
  { value: "delivery", label: "🚚 Доставка" },
  { value: "other", label: "📦 Другое" },
];

// ==================== КОНДИТЕР: ВКЛАДКА СОГЛАСОВАНИЕ ====================
export function ConfectionerNegotiationTab({ confectionerId }: { confectionerId: string }) {
  const negotiations = useAppStore((s) => s.negotiations);
  const quoteNegotiation = useAppStore((s) => s.quoteNegotiation);
  const reviseNegotiation = useAppStore((s) => s.reviseNegotiation);
  const withdrawNegotiation = useAppStore((s) => s.withdrawNegotiation);
  const [editingId, setEditingId] = useState<string | null>(null);

  const myNegotiations = negotiations.filter((n) => n.confectionerId === confectionerId);

  // Вкладки фильтрации по статусу
  const [activeFilter, setActiveFilter] = useState<"all" | "pending_confectioner" | "pending_customer" | "approved" | "rejected">("all");

  const pendingCount = myNegotiations.filter((n) => n.status === "pending_confectioner").length;
  const waitingCount = myNegotiations.filter((n) => n.status === "pending_customer").length;
  const approvedCount = myNegotiations.filter((n) => n.status === "approved").length;
  const rejectedCount = myNegotiations.filter((n) => n.status === "rejected").length;

  // Фильтрованный список
  const filteredNegotiations = activeFilter === "all"
    ? myNegotiations
    : myNegotiations.filter((n) => n.status === activeFilter);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-bold flex items-center gap-2">
          <FileText className="h-6 w-6 text-primary" />
          Согласование заказов
        </h1>
        <p className="text-sm text-muted-foreground">
          Получайте заявки из конструктора, корректируйте состав и цену, отправляйте на согласование покупателю
        </p>
      </div>

      {/* Stats — кликабельные, переключают фильтр */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card
          className={`p-3 cursor-pointer transition-all ${activeFilter === "pending_confectioner" ? "ring-2 ring-amber-400" : "hover:border-amber-300"}`}
          onClick={() => setActiveFilter(activeFilter === "pending_confectioner" ? "all" : "pending_confectioner")}
        >
          <Clock className="h-5 w-5 text-amber-600 mb-1" />
          <div className="font-display text-xl font-bold text-amber-600">{pendingCount}</div>
          <div className="text-xs text-muted-foreground">Ждут реакции</div>
        </Card>
        <Card
          className={`p-3 cursor-pointer transition-all ${activeFilter === "pending_customer" ? "ring-2 ring-blue-400" : "hover:border-blue-300"}`}
          onClick={() => setActiveFilter(activeFilter === "pending_customer" ? "all" : "pending_customer")}
        >
          <Send className="h-5 w-5 text-blue-600 mb-1" />
          <div className="font-display text-xl font-bold text-blue-600">{waitingCount}</div>
          <div className="text-xs text-muted-foreground">Ждут ответа</div>
        </Card>
        <Card
          className={`p-3 cursor-pointer transition-all ${activeFilter === "approved" ? "ring-2 ring-emerald-400" : "hover:border-emerald-300"}`}
          onClick={() => setActiveFilter(activeFilter === "approved" ? "all" : "approved")}
        >
          <CheckCircle2 className="h-5 w-5 text-emerald-600 mb-1" />
          <div className="font-display text-xl font-bold text-emerald-600">{approvedCount}</div>
          <div className="text-xs text-muted-foreground">Одобрено</div>
        </Card>
        <Card
          className={`p-3 cursor-pointer transition-all ${activeFilter === "rejected" ? "ring-2 ring-red-400" : "hover:border-red-300"}`}
          onClick={() => setActiveFilter(activeFilter === "rejected" ? "all" : "rejected")}
        >
          <X className="h-5 w-5 text-red-600 mb-1" />
          <div className="font-display text-xl font-bold text-red-600">{rejectedCount}</div>
          <div className="text-xs text-muted-foreground">Отклонено</div>
        </Card>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${activeFilter === "all" ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/70"}`}
          onClick={() => setActiveFilter("all")}
        >
          Все ({myNegotiations.length})
        </button>
        <button
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${activeFilter === "pending_confectioner" ? "bg-amber-500 text-white" : "bg-amber-50 text-amber-700 hover:bg-amber-100"}`}
          onClick={() => setActiveFilter("pending_confectioner")}
        >
          Ждут реакции ({pendingCount})
        </button>
        <button
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${activeFilter === "pending_customer" ? "bg-blue-500 text-white" : "bg-blue-50 text-blue-700 hover:bg-blue-100"}`}
          onClick={() => setActiveFilter("pending_customer")}
        >
          Ждут ответа ({waitingCount})
        </button>
        <button
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${activeFilter === "approved" ? "bg-emerald-500 text-white" : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"}`}
          onClick={() => setActiveFilter("approved")}
        >
          Одобрено ({approvedCount})
        </button>
        <button
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${activeFilter === "rejected" ? "bg-red-500 text-white" : "bg-red-50 text-red-700 hover:bg-red-100"}`}
          onClick={() => setActiveFilter("rejected")}
        >
          Отклонено ({rejectedCount})
        </button>
      </div>

      {/* List */}
      <div className="space-y-3">
        {filteredNegotiations.length === 0 && (
          <Card className="p-8 text-center text-muted-foreground">
            <FileText className="h-10 w-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">
              {activeFilter === "all"
                ? "Заявок из конструктора пока нет"
                : "Нет заявок с этим статусом"}
            </p>
          </Card>
        )}
        {filteredNegotiations.map((neg) => {
          const status = STATUS_INFO[neg.status] || STATUS_INFO.pending_confectioner;
          const StatusIcon = status.icon;
          const needsAction = neg.status === "pending_confectioner";
          const wasRejected = neg.status === "rejected";
          const waitingCustomer = neg.status === "pending_customer";
          const canEdit = waitingCustomer && neg.quotedItems.length > 0;
          return (
            <Card key={neg.id} className={`p-4 ${needsAction ? "border-amber-300 bg-amber-50/30" : ""}`}>
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-3">
                  <Avatar className="h-10 w-10">
                    <AvatarImage src={neg.customerAvatar} alt={neg.customerName} />
                    <AvatarFallback>{neg.customerName[0]}</AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="font-semibold text-sm">{neg.customerName}</div>
                    <div className="text-xs text-muted-foreground">
                      Заявка от {formatDateTime(neg.createdAt)}
                    </div>
                  </div>
                </div>
                <Badge className={status.color}>
                  <StatusIcon className="h-3 w-3 mr-1" />
                  {status.label}
                </Badge>
              </div>

              {/* Original request */}
              <div className="bg-muted/30 rounded-lg p-3 mb-3">
                <div className="text-xs font-semibold text-muted-foreground mb-2">Запрос покупателя:</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div><span className="text-muted-foreground">Мероприятие:</span> {neg.originalRequest.eventType}</div>
                  <div><span className="text-muted-foreground">Основа:</span> {neg.originalRequest.base}</div>
                  <div><span className="text-muted-foreground">Начинка:</span> {neg.originalRequest.filling}</div>
                  <div><span className="text-muted-foreground">Покрытие:</span> {neg.originalRequest.coating}</div>
                  <div><span className="text-muted-foreground">Порций:</span> {neg.originalRequest.servings}</div>
                  <div><span className="text-muted-foreground">Город:</span> {neg.originalRequest.city}</div>
                  <div><span className="text-muted-foreground">Дата:</span> {neg.originalRequest.deliveryDate}</div>
                  <div><span className="text-muted-foreground">Оценка:</span> {formatCurrency(neg.originalRequest.estimatedPrice)}</div>
                </div>
                {neg.originalRequest.comment && (
                  <div className="text-xs mt-2 italic text-muted-foreground">«{neg.originalRequest.comment}»</div>
                )}
                {neg.originalRequest.inscription && (
                  <div className="text-xs mt-1">Надпись: <strong>«{neg.originalRequest.inscription}»</strong></div>
                )}
              </div>

              {/* Quoted items (если есть) */}
              {neg.quotedItems.length > 0 && (
                <div className="mb-3">
                  <div className="text-xs font-semibold text-muted-foreground mb-2">Ваше предложение:</div>
                  <div className="space-y-1">
                    {neg.quotedItems.map((item, i) => (
                      <div key={i} className="flex items-center justify-between p-2 bg-card border border-border rounded text-xs">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium">{item.name}</div>
                          <div className="text-muted-foreground line-clamp-1">{item.description}</div>
                        </div>
                        <div className="font-semibold ml-2 shrink-0">{formatCurrency(item.totalPrice)}</div>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between font-bold text-sm mt-2 pt-2 border-t">
                    <span>Итого:</span>
                    <span className="text-primary">{formatCurrency(neg.quotedTotal)}</span>
                  </div>
                  {neg.quotedComment && (
                    <div className="text-xs mt-2 p-2 bg-primary/5 rounded italic">💬 {neg.quotedComment}</div>
                  )}
                </div>
              )}

              {/* Customer response */}
              {neg.customerResponse && (
                <div className={`p-2 rounded text-xs mb-3 ${
                  neg.customerResponse === "approved" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"
                }`}>
                  <strong>Ответ покупателя:</strong> {neg.customerResponse === "approved" ? "✅ Одобрено" : "❌ Отклонено"}
                  {neg.customerComment && ` — «${neg.customerComment}»`}
                </div>
              )}

              {/* Actions */}
              {(needsAction || wasRejected) && (
                <Button
                  onClick={() => setEditingId(neg.id)}
                  className="w-full"
                  variant={needsAction ? "default" : "outline"}
                >
                  {needsAction ? (
                    <><FileText className="h-4 w-4 mr-1" /> Составить предложение</>
                  ) : (
                    <><History className="h-4 w-4 mr-1" /> Пересмотреть предложение</>
                  )}
                </Button>
              )}

              {/* Кнопки для предложений, ожидающих ответа покупателя */}
              {canEdit && (
                <div className="flex gap-2">
                  <Button
                    onClick={() => setEditingId(neg.id)}
                    variant="outline"
                    className="flex-1"
                  >
                    <Edit className="h-4 w-4 mr-1" /> Редактировать
                  </Button>
                  <Button
                    onClick={() => {
                      if (confirm("Отозвать предложение? Покупатель получит уведомление.")) {
                        withdrawNegotiation(neg.id);
                        toast.success("Предложение отозвано");
                      }
                    }}
                    variant="outline"
                    className="flex-1 text-amber-600 border-amber-300 hover:bg-amber-50"
                  >
                    <RotateCcw className="h-4 w-4 mr-1" /> Отозвать
                  </Button>
                </div>
              )}

              {neg.status === "approved" && (
                <div className="flex items-center gap-2 text-sm text-emerald-600 font-medium">
                  <CheckCircle2 className="h-4 w-4" />
                  Заказ согласован — покупатель может оплатить
                </div>
              )}

              {/* History */}
              {neg.revisions.length > 1 && (
                <details className="mt-3">
                  <summary className="text-xs text-muted-foreground cursor-pointer flex items-center gap-1">
                    <History className="h-3 w-3" />
                    История ({neg.revisions.length})
                  </summary>
                  <div className="mt-2 space-y-1">
                    {neg.revisions.map((rev) => (
                      <div key={rev.id} className="text-xs p-1.5 border-l-2 border-border pl-2">
                        <span className="text-muted-foreground">{formatDateTime(rev.at)}</span> —
                        <span className="font-medium"> {rev.action}</span>
                        {rev.oldTotal !== undefined && rev.newTotal !== undefined && (
                          <span className="text-muted-foreground"> ({formatCurrency(rev.oldTotal)} → {formatCurrency(rev.newTotal)})</span>
                        )}
                        {rev.comment && <span className="text-muted-foreground italic"> — {rev.comment}</span>}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </Card>
          );
        })}
      </div>

      {/* Editor dialog */}
      {editingId && (
        <NegotiationEditorDialog
          negotiation={myNegotiations.find((n) => n.id === editingId)!}
          isRevision={myNegotiations.find((n) => n.id === editingId)?.status === "rejected"}
          isEdit={myNegotiations.find((n) => n.id === editingId)?.status === "pending_customer"}
          onClose={() => setEditingId(null)}
          onSubmit={(items, total, comment, deliveryCost, prepTime) => {
            const neg = myNegotiations.find((n) => n.id === editingId)!;
            if (neg.status === "pending_confectioner") {
              quoteNegotiation(editingId, items, total, comment, deliveryCost, prepTime);
              toast.success("Предложение отправлено покупателю!");
            } else {
              reviseNegotiation(editingId, items, total, comment, deliveryCost, prepTime);
              toast.success("Предложение обновлено и отправлено покупателю!");
            }
            setEditingId(null);
          }}
        />
      )}
    </div>
  );
}

// ==================== ДИАЛОГ РЕДАКТИРОВАНИЯ СОСТАВА И ЦЕНЫ ====================
function NegotiationEditorDialog({
  negotiation,
  isRevision,
  isEdit,
  onClose,
  onSubmit,
}: {
  negotiation: OrderNegotiation;
  isRevision: boolean;
  isEdit?: boolean;
  onClose: () => void;
  onSubmit: (items: NegotiationItem[], total: number, comment: string, deliveryCost: number, prepTime: string) => void;
}) {
  const [items, setItems] = useState<NegotiationItem[]>(
    negotiation.quotedItems.length > 0
      ? negotiation.quotedItems
      : [
          {
            name: `Торт (${negotiation.originalRequest.servings} порций)`,
            description: `${negotiation.originalRequest.base}, ${negotiation.originalRequest.filling}, ${negotiation.originalRequest.coating}`,
            quantity: 1,
            unitPrice: negotiation.originalRequest.estimatedPrice,
            totalPrice: negotiation.originalRequest.estimatedPrice,
            category: "cake" as const,
          },
        ]
  );
  const [comment, setComment] = useState(negotiation.quotedComment || "");
  const [deliveryCost, setDeliveryCost] = useState(negotiation.quotedDeliveryCost || 0);
  const [prepTime, setPrepTime] = useState(negotiation.quotedPrepTime || "2 дня");

  const total = items.reduce((sum, item) => sum + item.totalPrice, 0) + deliveryCost;

  const addItem = () => {
    setItems([
      ...items,
      { name: "", description: "", quantity: 1, unitPrice: 0, totalPrice: 0, category: "other" as const },
    ]);
  };

  const updateItem = (index: number, updates: Partial<NegotiationItem>) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], ...updates };
    newItems[index].totalPrice = newItems[index].quantity * newItems[index].unitPrice;
    setItems(newItems);
  };

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Редактирование предложения" : isRevision ? "Пересмотр предложения" : "Составление предложения"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Внесите изменения в состав или цену. Покупатель получит обновлённое предложение."
              : "Отредактируйте состав заказа и цену. Покупатель получит предложение и сможет одобрить или отклонить."}
          </DialogDescription>
        </DialogHeader>

        {/* Original request summary */}
        <div className="bg-muted/30 rounded-lg p-3 text-xs">
          <div className="font-semibold mb-1">Запрос покупателя:</div>
          <div className="text-muted-foreground">
            {negotiation.originalRequest.eventType} • {negotiation.originalRequest.servings} порц. • {negotiation.originalRequest.city} • {negotiation.originalRequest.deliveryDate}
          </div>
          <div className="text-muted-foreground mt-1">
            Оценка покупателя: <strong>{formatCurrency(negotiation.originalRequest.estimatedPrice)}</strong>
          </div>
          {negotiation.originalRequest.comment && (
            <div className="italic mt-1">«{negotiation.originalRequest.comment}»</div>
          )}
        </div>

        {/* Items editor */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="font-semibold">Состав заказа</Label>
            <Button size="sm" variant="outline" onClick={addItem}>
              <Plus className="h-3 w-3 mr-1" /> Добавить позицию
            </Button>
          </div>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {items.map((item, i) => (
              <div key={i} className="p-2 border border-border rounded-lg space-y-2">
                <div className="flex items-start gap-2">
                  <Select value={item.category} onValueChange={(v) => updateItem(i, { category: v as any })}>
                    <SelectTrigger className="w-32 h-8 text-xs shrink-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ITEM_CATEGORIES.map((c) => (
                        <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    value={item.name}
                    onChange={(e) => updateItem(i, { name: e.target.value })}
                    placeholder="Название позиции"
                    className="h-8 text-sm flex-1"
                  />
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive shrink-0" onClick={() => removeItem(i)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <Input
                  value={item.description}
                  onChange={(e) => updateItem(i, { description: e.target.value })}
                  placeholder="Описание (необязательно)"
                  className="h-8 text-xs"
                />
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1">
                    <Label className="text-xs whitespace-nowrap">Кол-во:</Label>
                    <Input
                      type="number"
                      value={item.quantity}
                      onChange={(e) => updateItem(i, { quantity: +e.target.value })}
                      className="h-8 w-16 text-sm"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <Label className="text-xs whitespace-nowrap">Цена:</Label>
                    <Input
                      type="number"
                      value={item.unitPrice}
                      onChange={(e) => updateItem(i, { unitPrice: +e.target.value })}
                      className="h-8 w-24 text-sm"
                    />
                    <span className="text-xs text-muted-foreground">₽</span>
                  </div>
                  <div className="ml-auto text-sm font-semibold">
                    {formatCurrency(item.totalPrice)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Delivery + prep time */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Доставка (₽)</Label>
            <Input type="number" value={deliveryCost} onChange={(e) => setDeliveryCost(+e.target.value)} />
          </div>
          <div>
            <Label>Срок готовки</Label>
            <Input value={prepTime} onChange={(e) => setPrepTime(e.target.value)} placeholder="2 дня" />
          </div>
        </div>

        {/* Comment */}
        <div>
          <Label>Комментарий покупателю</Label>
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Объясните изменения в составе и цене. Какие материалы добавлены, почему цена отличается от оценки..."
            rows={3}
          />
        </div>

        {/* Total */}
        <div className="flex items-center justify-between p-3 bg-primary/5 rounded-lg">
          <div>
            <div className="text-xs text-muted-foreground">Оценка покупателя: {formatCurrency(negotiation.originalRequest.estimatedPrice)}</div>
            <div className="font-display text-xl font-bold text-primary">
              Итого: {formatCurrency(total)}
            </div>
            {total !== negotiation.originalRequest.estimatedPrice && (
              <div className="text-xs">
                Разница: {total > negotiation.originalRequest.estimatedPrice ? "+" : ""}
                {formatCurrency(total - negotiation.originalRequest.estimatedPrice)}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={() => onSubmit(items, total, comment, deliveryCost, prepTime)}>
            <Send className="h-4 w-4 mr-1" />
            {isEdit ? "Обновить предложение" : isRevision ? "Отправить пересмотр" : "Отправить предложение"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ==================== ПОКУПАТЕЛЬ: ФОРМА СОГЛАСИЯ ====================
export function CustomerNegotiationTab() {
  const negotiations = useAppStore((s) => s.negotiations);
  const user = useAppStore((s) => s.user);
  const approveNegotiation = useAppStore((s) => s.approveNegotiation);
  const rejectNegotiation = useAppStore((s) => s.rejectNegotiation);
  const setCartOpen = useAppStore((s) => s.setCartOpen);
  const setChatOpen = useAppStore((s) => s.setChatOpen);

  // Показываем все согласования, где покупатель — текущий пользователь (или u1 для demo)
  const myNegotiations = negotiations.filter((n) => n.customerId === user?.id || n.customerId === "u1" || n.customerId === "u9");
  const pendingCount = myNegotiations.filter((n) => n.status === "pending_customer").length;
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [response, setResponse] = useState<"approve" | "reject" | null>(null);
  const [comment, setComment] = useState("");

  // Вкладки фильтрации
  const [activeFilter, setActiveFilter] = useState<"all" | "pending_customer" | "approved" | "rejected">("all");
  const approvedCount = myNegotiations.filter((n) => n.status === "approved").length;
  const rejectedCount = myNegotiations.filter((n) => n.status === "rejected").length;
  const filteredNegotiations = activeFilter === "all"
    ? myNegotiations
    : myNegotiations.filter((n) => n.status === activeFilter);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-bold flex items-center gap-2">
          <ShoppingBag className="h-6 w-6 text-primary" />
          Согласование заказов
        </h1>
        <p className="text-sm text-muted-foreground">
          Просмотрите предложения кондитеров, одобрите или отклоните. После одобрения — переходите к оплате.
        </p>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${activeFilter === "all" ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/70"}`}
          onClick={() => setActiveFilter("all")}
        >
          Все ({myNegotiations.length})
        </button>
        <button
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${activeFilter === "pending_customer" ? "bg-amber-500 text-white" : "bg-amber-50 text-amber-700 hover:bg-amber-100"}`}
          onClick={() => setActiveFilter("pending_customer")}
        >
          Ждут ответа ({pendingCount})
        </button>
        <button
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${activeFilter === "approved" ? "bg-emerald-500 text-white" : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"}`}
          onClick={() => setActiveFilter("approved")}
        >
          Одобрено ({approvedCount})
        </button>
        <button
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${activeFilter === "rejected" ? "bg-red-500 text-white" : "bg-red-50 text-red-700 hover:bg-red-100"}`}
          onClick={() => setActiveFilter("rejected")}
        >
          Отклонено ({rejectedCount})
        </button>
      </div>

      {/* List */}
      <div className="space-y-3">
        {filteredNegotiations.length === 0 && (
          <Card className="p-8 text-center text-muted-foreground">
            <ShoppingBag className="h-10 w-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">
              {activeFilter === "all"
                ? "Предложений от кондитеров пока нет"
                : "Нет предложений с этим статусом"}
            </p>
          </Card>
        )}
        {filteredNegotiations.map((neg) => {
          const status = STATUS_INFO[neg.status] || STATUS_INFO.pending_customer;
          const StatusIcon = status.icon;
          const needsResponse = neg.status === "pending_customer";
          const isApproved = neg.status === "approved";

          return (
            <Card key={neg.id} className={`p-4 ${needsResponse ? "border-blue-300 bg-blue-50/30" : ""}`}>
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-3">
                  <Avatar className="h-10 w-10">
                    <AvatarImage src={neg.confectionerAvatar} alt={neg.confectionerName} />
                    <AvatarFallback>{neg.confectionerName[0]}</AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="font-semibold text-sm">{neg.confectionerName}</div>
                    <div className="text-xs text-muted-foreground">
                      Предложение от {neg.quotedAt ? formatDateTime(neg.quotedAt) : "—"}
                    </div>
                  </div>
                </div>
                <Badge className={status.color}>
                  <StatusIcon className="h-3 w-3 mr-1" />
                  {status.label}
                </Badge>
              </div>

              {/* Original request */}
              <div className="bg-muted/30 rounded-lg p-3 mb-3 text-xs">
                <div className="font-semibold mb-1">Ваш запрос:</div>
                <div className="text-muted-foreground">
                  {neg.originalRequest.eventType} • {neg.originalRequest.servings} порц. • {neg.originalRequest.city} • {neg.originalRequest.deliveryDate}
                </div>
                <div className="text-muted-foreground mt-1">
                  Оценка: <strong>{formatCurrency(neg.originalRequest.estimatedPrice)}</strong>
                </div>
              </div>

              {/* Quoted items */}
              {neg.quotedItems.length > 0 && (
                <div className="mb-3">
                  <div className="text-xs font-semibold text-muted-foreground mb-2">Предложение кондитера:</div>
                  <div className="space-y-1">
                    {neg.quotedItems.map((item, i) => (
                      <div key={i} className="flex items-center justify-between p-2 bg-card border border-border rounded text-xs">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium">{item.name}</div>
                          <div className="text-muted-foreground line-clamp-1">{item.description}</div>
                        </div>
                        <div className="font-semibold ml-2 shrink-0">{formatCurrency(item.totalPrice)}</div>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between font-bold text-sm mt-2 pt-2 border-t">
                    <span>Итого:</span>
                    <span className="text-primary">{formatCurrency(neg.quotedTotal)}</span>
                  </div>
                  {neg.quotedComment && (
                    <div className="text-xs mt-2 p-2 bg-primary/5 rounded italic">💬 {neg.quotedComment}</div>
                  )}
                  {neg.quotedPrepTime && (
                    <div className="text-xs mt-1 text-muted-foreground">⏱ Срок готовки: {neg.quotedPrepTime}</div>
                  )}
                  {neg.validUntil && (
                    <div className="text-xs text-amber-600 mt-1">⚠ Предложение действительно до {formatDateTime(neg.validUntil)}</div>
                  )}
                </div>
              )}

              {/* Price comparison */}
              {neg.quotedTotal > 0 && (
                <div className={`p-2 rounded text-xs mb-3 ${
                  neg.quotedTotal > neg.originalRequest.estimatedPrice
                    ? "bg-amber-50 text-amber-800"
                    : neg.quotedTotal < neg.originalRequest.estimatedPrice
                    ? "bg-emerald-50 text-emerald-800"
                    : "bg-muted/30 text-muted-foreground"
                }`}>
                  {neg.quotedTotal > neg.originalRequest.estimatedPrice ? (
                    <>Цена выше вашей оценки на <strong>{formatCurrency(neg.quotedTotal - neg.originalRequest.estimatedPrice)}</strong></>
                  ) : neg.quotedTotal < neg.originalRequest.estimatedPrice ? (
                    <>Цена ниже вашей оценки на <strong>{formatCurrency(neg.originalRequest.estimatedPrice - neg.quotedTotal)}</strong> 🎉</>
                  ) : (
                    <>Цена совпадает с вашей оценкой</>
                  )}
                </div>
              )}

              {/* Customer response (если уже ответил) */}
              {neg.customerResponse && (
                <div className={`p-2 rounded text-xs mb-3 ${
                  neg.customerResponse === "approved" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"
                }`}>
                  <strong>Ваш ответ:</strong> {neg.customerResponse === "approved" ? "✅ Одобрено" : "❌ Отклонено"}
                  {neg.customerComment && ` — «${neg.customerComment}»`}
                </div>
              )}

              {/* Actions */}
              {needsResponse && (
                <div className="flex gap-2">
                  <Button
                    className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                    onClick={() => {
                      setRespondingId(neg.id);
                      setResponse("approve");
                      setComment("");
                    }}
                  >
                    <Check className="h-4 w-4 mr-1" /> Одобрить
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1 text-destructive border-red-300 hover:bg-red-50"
                    onClick={() => {
                      setRespondingId(neg.id);
                      setResponse("reject");
                      setComment("");
                    }}
                  >
                    <X className="h-4 w-4 mr-1" /> Отклонить
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => setChatOpen(true)}>
                    <MessageCircle className="h-4 w-4" />
                  </Button>
                </div>
              )}

              {isApproved && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm text-emerald-600 font-medium">
                    <CheckCircle2 className="h-4 w-4" />
                    Заказ одобрен — можно оплачивать!
                  </div>
                  <Button className="w-full" onClick={() => toast.success("Переход к оплате...")}>
                    <ShoppingBag className="h-4 w-4 mr-1" /> Перейти к оплате {formatCurrency(neg.quotedTotal)}
                  </Button>
                </div>
              )}

              {/* History */}
              {neg.revisions.length > 1 && (
                <details className="mt-3">
                  <summary className="text-xs text-muted-foreground cursor-pointer flex items-center gap-1">
                    <History className="h-3 w-3" />
                    История ({neg.revisions.length})
                  </summary>
                  <div className="mt-2 space-y-1">
                    {neg.revisions.map((rev) => (
                      <div key={rev.id} className="text-xs p-1.5 border-l-2 border-border pl-2">
                        <span className="text-muted-foreground">{formatDateTime(rev.at)}</span> —
                        <span className="font-medium"> {rev.action}</span>
                        {rev.comment && <span className="text-muted-foreground italic"> — {rev.comment}</span>}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </Card>
          );
        })}
      </div>

      {/* Response dialog */}
      {respondingId && response && (
        <Dialog open onOpenChange={() => setRespondingId(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {response === "approve" ? "✅ Одобрить заказ?" : "❌ Отклонить заказ?"}
              </DialogTitle>
              <DialogDescription>
                {response === "approve"
                  ? "После одобрения вы сможете перейти к оплате. Кондитер получит уведомление."
                  : "Укажите причину отклонения. Кондитер сможет пересмотреть предложение."}
              </DialogDescription>
            </DialogHeader>
            {response === "reject" && (
              <div>
                <Label>Причина отклонения</Label>
                <Textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Например: дорого, нужно дешевле / не подходит состав / нашёл другого кондитера"
                  rows={3}
                />
              </div>
            )}
            {response === "approve" && (
              <div>
                <Label>Комментарий (необязательно)</Label>
                <Textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Всё нравится, оплачиваю!"
                  rows={2}
                />
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setRespondingId(null)}>Отмена</Button>
              <Button
                className={response === "approve" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"}
                onClick={() => {
                  if (response === "approve") {
                    approveNegotiation(respondingId, comment);
                    toast.success("Заказ одобрен! Можно переходить к оплате.");
                  } else {
                    if (!comment.trim()) {
                      toast.error("Укажите причину отклонения");
                      return;
                    }
                    rejectNegotiation(respondingId, comment);
                    toast.success("Заказ отклонён. Кондитер получит уведомление.");
                  }
                  setRespondingId(null);
                }}
              >
                {response === "approve" ? "Одобрить" : "Отклонить"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
