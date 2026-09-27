"use client";

/**
 * VenueBookingsManager — реальные брони площадок (таблица venue_bookings).
 *
 * Режимы:
 *  - "owner"   — входящие заявки на площадки владельца: подтверждение/отказ/завершение
 *  - "customer"— брони текущего пользователя: отмена, статусы, депозит
 *
 * Данные: GET  /api/venues/bookings  → { mine, incoming }
 * Действия: PATCH /api/venues/:venueId/bookings/:bookingId
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  CalendarDays,
  Clock,
  Loader2,
  MapPin,
  Phone,
  Users,
  Inbox,
  Check,
  X,
  Ban,
  CheckCheck,
} from "lucide-react";
import { getSessionAuthHeaders, getCsrfToken } from "@/lib/api-client";

type BookingStatus = "pending" | "confirmed" | "rejected" | "cancelled" | "completed";

interface VenueBooking {
  id: string;
  venue_id: string;
  user_id?: string;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  hours: number | null;
  guests: number | null;
  contact_name: string | null;
  contact_phone: string | null;
  message: string | null;
  status: BookingStatus;
  deposit_amount: number;
  owner_reply: string | null;
  price_snapshot: number | null;
  created_at: string;
  venues?: { id: string; name: string; address?: string; city?: string; images?: string[] } | null;
}

const STATUS_META: Record<BookingStatus, { label: string; className: string }> = {
  pending: { label: "Ожидает ответа", className: "bg-amber-100 text-amber-800 border-amber-200" },
  confirmed: { label: "Подтверждена", className: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  rejected: { label: "Отклонена", className: "bg-rose-100 text-rose-700 border-rose-200" },
  cancelled: { label: "Отменена", className: "bg-muted text-muted-foreground" },
  completed: { label: "Завершена", className: "bg-sky-100 text-sky-800 border-sky-200" },
};

function formatKop(kop: number | null | undefined): string {
  if (!kop) return "—";
  return new Intl.NumberFormat("ru-RU").format(Math.round(kop / 100)) + " ₽";
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    weekday: "short",
  });
}

export function VenueBookingsManager({
  mode = "customer",
}: {
  mode?: "owner" | "customer";
}) {
  const [bookings, setBookings] = useState<VenueBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const headers = await getSessionAuthHeaders();
      const res = await fetch("/api/venues/bookings", { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { mine?: VenueBooking[]; incoming?: VenueBooking[] };
      setBookings(mode === "owner" ? json.incoming || [] : json.mine || []);
    } catch {
      setBookings([]);
    } finally {
      setLoading(false);
    }
  }, [mode]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = useCallback(
    async (booking: VenueBooking, status: string, ownerReply?: string) => {
      setBusyId(booking.id);
      try {
        const [csrf, headers] = await Promise.all([
          getCsrfToken(),
          getSessionAuthHeaders(),
        ]);
        const res = await fetch(
          `/api/venues/${booking.venue_id}/bookings/${booking.id}`,
          {
            method: "PATCH",
            headers: { ...headers, "x-csrf-token": csrf },
            body: JSON.stringify({ status, owner_reply: ownerReply }),
          }
        );
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(json.error || `Ошибка ${res.status}`);
          return;
        }
        toast.success(`Статус: ${STATUS_META[status as BookingStatus]?.label ?? status}`);
        setBookings((prev) =>
          prev.map((b) => (b.id === booking.id ? { ...b, status: status as BookingStatus } : b))
        );
        setReplyFor(null);
        setReplyText("");
      } catch {
        toast.error("Сеть недоступна");
      } finally {
        setBusyId(null);
      }
    },
    []
  );

  const pendingCount = useMemo(
    () => bookings.filter((b) => b.status === "pending").length,
    [bookings]
  );

  if (loading) {
    return (
      <Card className="p-8 text-center">
        <Loader2 className="h-6 w-6 mx-auto animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground mt-2">Загружаем брони…</p>
      </Card>
    );
  }

  if (!bookings.length) {
    return (
      <Card className="p-8 text-center">
        <Inbox className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
        <h3 className="font-semibold">
          {mode === "owner" ? "Заявок пока нет" : "Бронирований пока нет"}
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          {mode === "owner"
            ? "Новые заявки с витрины «Площадки» появятся здесь."
            : "Выберите площадку в разделе «Услуги и площадки» и отправьте заявку."}
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">
          {mode === "owner" ? "Заявки на бронирование" : "Мои брони площадок"}
        </h2>
        {pendingCount > 0 && (
          <Badge className="bg-amber-100 text-amber-800 border border-amber-200">
            Новых: {pendingCount}
          </Badge>
        )}
      </div>

      {bookings.map((b) => {
        const meta = STATUS_META[b.status];
        const isPending = b.status === "pending";
        return (
          <Card key={b.id} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold truncate">
                  {b.venues?.name || "Площадка"}
                </div>
                {b.venues?.address && (
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    <MapPin className="h-3 w-3" /> {b.venues.address}
                  </div>
                )}
              </div>
              <Badge variant="outline" className={meta.className}>
                {meta.label}
              </Badge>
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <CalendarDays className="h-3.5 w-3.5" /> {formatDate(b.event_date)}
              </span>
              {(b.start_time || b.end_time) && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  {b.start_time || "—"}–{b.end_time || "—"}
                  {b.hours ? ` (${b.hours} ч)` : ""}
                </span>
              )}
              {b.guests && (
                <span className="flex items-center gap-1">
                  <Users className="h-3.5 w-3.5" /> {b.guests} гостей
                </span>
              )}
              <span>Депозит: {formatKop(b.deposit_amount)}</span>
            </div>

            {b.message && (
              <p className="text-sm mt-2 p-2 rounded bg-muted">«{b.message}»</p>
            )}
            {b.contact_phone && (
              <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                <Phone className="h-3 w-3" /> {b.contact_phone}
              </p>
            )}
            {b.owner_reply && (
              <p className="text-xs mt-1 text-emerald-700">
                Ответ площадки: {b.owner_reply}
              </p>
            )}

            {(mode === "owner" ? isPending : b.status === "confirmed" || b.status === "pending") && (
              <div className="flex flex-wrap gap-2 mt-3">
                {mode === "owner" ? (
                  <>
                    <Button
                      size="sm"
                      onClick={() => patch(b, "confirmed")}
                      disabled={busyId === b.id}
                    >
                      {busyId === b.id ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
                      Подтвердить
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setReplyFor(replyFor === b.id ? null : b.id);
                        setReplyText("");
                      }}
                    >
                      Ответить / отказать
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => patch(b, "cancelled")}
                    disabled={busyId === b.id}
                  >
                    {busyId === b.id ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Ban className="h-4 w-4 mr-1" />}
                    Отменить бронь
                  </Button>
                )}
              </div>
            )}

            {mode === "owner" && b.status === "confirmed" && (
              <div className="flex gap-2 mt-3">
                <Button size="sm" variant="outline" onClick={() => patch(b, "completed")} disabled={busyId === b.id}>
                  {busyId === b.id ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCheck className="h-4 w-4 mr-1" />}
                  Мероприятие состоялось
                </Button>
              </div>
            )}

            {mode === "owner" && replyFor === b.id && (
              <div className="mt-3 space-y-2 border-t pt-3">
                <Textarea
                  rows={2}
                  placeholder="Комментарий для клиента (необязательно)"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button size="sm" variant="destructive" onClick={() => patch(b, "rejected", replyText || undefined)} disabled={busyId === b.id}>
                    <X className="h-4 w-4 mr-1" /> Отклонить
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setReplyFor(null)}>
                    Отмена
                  </Button>
                </div>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
