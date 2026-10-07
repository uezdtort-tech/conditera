"use client";

/**
 * confectioner-chat-tab.tsx — таб «Чат» в дашборде кондитера (p1-b, B3).
 *
 * Список реальных комнат из GET /api/chat/rooms (member-фильтрация на
 * сервере: кондитер видит свои order-комнаты и диалоги). Для order-комнат —
 * карточка «Заказ» с мини-сводкой (№, статус человеческим языком из
 * ORDER_STATUS_LABELS, сумма) и кнопками «Открыть чат» / «Открыть заказ».
 *
 * «Открыть чат» фокусирует глобальный ChatWidget (смонтирован в
 * dashboard/page.tsx) на этой комнате через store (setActiveChatRoom +
 * setChatOpen) — сам виджет не дублируется.
 *
 * «Открыть заказ» — переход к табу «Заказы» (колбэк из дашборда);
 * OrderWorkspaceDialog сознательно не используется: его API (ops-центр)
 * рассчитан на staff-роли.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageCircle, ExternalLink, RefreshCw, Loader2 } from "lucide-react";
import { ORDER_STATUS_LABELS, formatCurrency } from "@/lib/finance";
import { getStoredAccessToken } from "@/lib/api-client";
import { useAppStore } from "@/lib/store";
import {
  fetchChatRooms,
  type ApiChatRoom,
} from "@/components/chat/chat-api";

interface OrderBrief {
  number: string;
  status: string;
  total: number;
}

export function ConfectionerChatTab({
  onOpenOrders,
}: {
  /** «Открыть заказ» → переход к табу заказов дашборда */
  onOpenOrders?: () => void;
}) {
  const [rooms, setRooms] = useState<ApiChatRoom[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Мини-сводки заказов (лениво, один запрос на orderId за сессию)
  const [orderBriefs, setOrderBriefs] = useState<Map<string, OrderBrief>>(new Map());
  const briefsCacheRef = useRef<Map<string, OrderBrief>>(new Map());
  const [openingChatRoomId, setOpeningChatRoomId] = useState<string | null>(null);

  const loadRooms = useCallback(async () => {
    setLoading(true);
    setError(null);
    const list = await fetchChatRooms();
    if (list === null) {
      setError("Не удалось загрузить чаты. Проверьте соединение и войдите заново.");
    } else {
      setRooms(list);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadRooms();
  }, [loadRooms]);

  // Ленивая догрузка сводок по order-комнатам (пачка пропущенных — по одному)
  useEffect(() => {
    const pending = (rooms || [])
      .filter((r) => r.type === "order" && r.orderId && !briefsCacheRef.current.has(r.orderId))
      .map((r) => r.orderId as string);
    if (pending.length === 0) return;
    let cancelled = false;
    (async () => {
      const token = getStoredAccessToken();
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      const updates = new Map<string, OrderBrief>();
      for (const orderId of pending.slice(0, 12)) {
        try {
          const res = await fetch(`/api/orders/${orderId}`, { headers });
          if (!res.ok) continue;
          const data = (await res.json()) as {
            order?: { number?: string; status?: string; total?: number };
          };
          if (data?.order?.number) {
            const brief: OrderBrief = {
              number: data.order.number,
              status: data.order.status || "",
              total: Number(data.order.total) || 0,
            };
            briefsCacheRef.current.set(orderId, brief);
            updates.set(orderId, brief);
          }
        } catch {
          // сводка не критична — карточка покажет комнату без деталей
        }
      }
      if (!cancelled && updates.size > 0) {
        setOrderBriefs((prev) => new Map([...prev, ...updates]));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rooms]);

  /** Открыть комнату в глобальном ChatWidget (дравер над дашбордом). */
  const openChat = (roomId: string) => {
    setOpeningChatRoomId(roomId);
    const store = useAppStore.getState();
    store.setActiveChatRoom(roomId);
    store.setChatOpen(true);
    setOpeningChatRoomId(null);
  };

  const orderRooms = (rooms || []).filter((r) => r.type === "order");
  const otherRooms = (rooms || []).filter((r) => r.type !== "order");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="font-display text-2xl font-bold">Чат</h1>
        <Button size="sm" variant="outline" onClick={loadRooms} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
          Обновить
        </Button>
      </div>

      {error && (
        <Card className="p-4 text-sm text-destructive">{error}</Card>
      )}

      {loading && !rooms && (
        <div className="space-y-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      )}

      {rooms && rooms.length === 0 && !error && (
        <Card className="p-8 text-center text-muted-foreground text-sm">
          Чатов пока нет — переписка по заказам появится здесь автоматически
        </Card>
      )}

      {/* Order-комнаты: карточка «Заказ» с мини-сводкой */}
      {orderRooms.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">Чаты по заказам</h2>
          {orderRooms.map((room) => {
            const brief = room.orderId ? orderBriefs.get(room.orderId) : undefined;
            const status = brief ? ORDER_STATUS_LABELS[brief.status] : undefined;
            return (
              <Card key={room.id} className="p-4">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <Badge variant="outline" className="text-[10px]">Заказ</Badge>
                      <span className="font-semibold text-sm">
                        №{brief?.number || room.name.replace(/^Заказ\s*№?\s*/, "") || "…"}
                      </span>
                      {status && (
                        <Badge variant="outline" className={`text-[10px] ${status.color}`}>
                          {status.label}
                        </Badge>
                      )}
                      {room.unreadCount > 0 && (
                        <Badge className="text-[9px] h-4 min-w-4 px-1">
                          {room.unreadCount > 99 ? "99+" : room.unreadCount}
                        </Badge>
                      )}
                    </div>
                    {brief && (
                      <div className="text-xs text-muted-foreground">
                        Сумма: {formatCurrency(brief.total)}
                      </div>
                    )}
                    {room.lastMessage && (
                      <div className="text-xs text-muted-foreground truncate mt-1 max-w-md">
                        {room.lastMessage}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 shrink-0">
                    <Button
                      size="sm"
                      onClick={() => openChat(room.id)}
                      disabled={openingChatRoomId === room.id}
                    >
                      <MessageCircle className="h-4 w-4 mr-1" />
                      Открыть чат
                    </Button>
                    {onOpenOrders && (
                      <Button size="sm" variant="outline" onClick={onOpenOrders}>
                        <ExternalLink className="h-4 w-4 mr-1" />
                        Открыть заказ
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Остальные комнаты (direct/support): простые строки */}
      {otherRooms.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Диалоги</h2>
          <Card className="divide-y max-h-96 overflow-y-auto">
            {otherRooms.map((room) => (
              <div key={room.id} className="p-3 flex items-center gap-3">
                <Avatar className="h-8 w-8 shrink-0">
                  <AvatarImage src={room.avatar} alt={room.name} />
                  <AvatarFallback className="text-[10px]">{room.name.slice(0, 2)}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{room.name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {room.lastMessage || "Нет сообщений"}
                  </div>
                </div>
                {room.unreadCount > 0 && (
                  <Badge className="shrink-0 h-4 min-w-4 px-1 text-[9px]">
                    {room.unreadCount > 99 ? "99+" : room.unreadCount}
                  </Badge>
                )}
                <Button size="sm" variant="outline" onClick={() => openChat(room.id)}>
                  Открыть
                </Button>
              </div>
            ))}
          </Card>
        </div>
      )}
    </div>
  );
}
