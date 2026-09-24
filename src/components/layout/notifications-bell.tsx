"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Bell, Check, Trash2, X, ShoppingBag, MessageCircle, Tag,
  Star, Truck, CreditCard, Info, Heart,
} from "lucide-react";
import { getSessionAuthHeaders, getCsrfToken } from "@/lib/api-client";

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
}

const NOTIF_ICONS: Record<string, typeof Bell> = {
  order: ShoppingBag,
  message: MessageCircle,
  promo: Tag,
  review: Star,
  payment: CreditCard,
  delivery: Truck,
  social: Heart,
  system: Info,
};

const NOTIF_COLORS: Record<string, string> = {
  order: "text-blue-500 bg-blue-100 dark:bg-blue-900/30",
  message: "text-purple-500 bg-purple-100 dark:bg-purple-900/30",
  promo: "text-rose-500 bg-rose-100 dark:bg-rose-900/30",
  review: "text-amber-500 bg-amber-100 dark:bg-amber-900/30",
  payment: "text-emerald-500 bg-emerald-100 dark:bg-emerald-900/30",
  delivery: "text-indigo-500 bg-indigo-100 dark:bg-indigo-900/30",
  social: "text-pink-500 bg-pink-100 dark:bg-pink-900/30",
  system: "text-slate-500 bg-slate-100 dark:bg-slate-900/30",
};

export function NotificationsBell() {
  // Local state — self-contained, doesn't depend on Zustand store
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Load from /api/notifications
  useEffect(() => {
    loadNotifications();
  }, []);

  const loadNotifications = async () => {
    try {
      const res = await fetch("/api/notifications", {
        headers: await getSessionAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
      }
    } catch {
      // Silent fail — notifications are non-critical
    }
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markRead = (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    (async () => {
      const headers = await getSessionAuthHeaders(await getCsrfToken());
      fetch("/api/notifications", { method: "PATCH", headers, body: JSON.stringify({ id, read: true }) }).catch(() => {});
    })();
  };

  const markAllRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    (async () => {
      const headers = await getSessionAuthHeaders(await getCsrfToken());
      fetch("/api/notifications", { method: "PATCH", headers, body: JSON.stringify({ readAll: true }) }).catch(() => {});
    })();
  };

  const deleteNotif = (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    (async () => {
      const headers = await getSessionAuthHeaders(await getCsrfToken());
      fetch(`/api/notifications?id=${id}`, { method: "DELETE", headers }).catch(() => {});
    })();
  };

  const clearAll = () => {
    setNotifications([]);
    (async () => {
      const headers = await getSessionAuthHeaders(await getCsrfToken());
      fetch("/api/notifications?all=true", { method: "DELETE", headers }).catch(() => {});
    })();
  };

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <Button
        variant="ghost"
        size="icon"
        className="relative h-9 w-9"
        onClick={() => setOpen(!open)}
        aria-label="Уведомления"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <Badge className="absolute -top-1 -right-1 h-5 min-w-5 px-1 text-[10px] flex items-center justify-center bg-red-500 text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </Badge>
        )}
      </Button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 sm:w-96 bg-card border border-border rounded-lg shadow-xl z-50 max-h-[80vh] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-3 border-b">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Bell className="h-4 w-4" />
              Уведомления
              {unreadCount > 0 && <Badge variant="secondary" className="text-[10px]">{unreadCount}</Badge>}
            </h3>
            <div className="flex gap-1">
              {unreadCount > 0 && (
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={markAllRead}>
                  <Check className="h-3 w-3 mr-1" /> Все прочитано
                </Button>
              )}
              {notifications.length > 0 && (
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={clearAll}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setOpen(false)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                <Bell className="h-8 w-8 mx-auto mb-2 opacity-30" />
                Нет уведомлений
              </div>
            ) : (
              notifications.map((notif) => {
                const Icon = NOTIF_ICONS[notif.type] || Info;
                const color = NOTIF_COLORS[notif.type] || NOTIF_COLORS.system;
                return (
                  <div
                    key={notif.id}
                    className={`flex items-start gap-3 p-3 border-b hover:bg-accent/50 transition-colors cursor-pointer ${!notif.read ? "bg-primary/5" : ""}`}
                    onClick={() => markRead(notif.id)}
                  >
                    <div className={`shrink-0 h-8 w-8 rounded-full flex items-center justify-center ${color}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{notif.title}</div>
                      <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{notif.message}</div>
                      <div className="text-[10px] text-muted-foreground mt-1">
                        {new Date(notif.createdAt).toLocaleString("ru-RU")}
                      </div>
                    </div>
                    {!notif.read && <div className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5" />}
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteNotif(notif.id); }}
                      className="text-muted-foreground hover:text-red-500 shrink-0"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
