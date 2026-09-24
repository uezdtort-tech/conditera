"use client";

/**
 * VerificationStatusBanner — баннер статуса модерации для кондитера.
 *
 * Показывает:
 *  - pending: "Ваш профиль на модерации. Ожидайте подтверждения администратора."
 *  - approved: "Профиль подтверждён. Полный доступ к платформе."
 *  - rejected: "Профиль отклонён. Причина: ... Отправить снова."
 *  - needs_revision: "Запрошены правки: ... Отправить снова."
 *
 * Вставляется в шапку кабинета кондитера.
 */

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Send,
  Info,
} from "lucide-react";
import { toast } from "sonner";

interface VerificationInfo {
  status: "pending" | "approved" | "rejected" | "needs_revision";
  rejectionReason?: string | null;
  verifiedAt?: string | null;
}

export function VerificationStatusBanner() {
  const [info, setInfo] = useState<VerificationInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  async function loadStatus() {
    try {
      // Используем gate endpoint
      const res = await fetch("/api/confectioner/status");
      if (res.ok) {
        const data = await res.json();
        setInfo(data);
      }
    } catch (e) {
      // Тихо игнорируем — может быть, что кондитер ещё не создал профиль
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStatus();
  }, []);

  async function handleResubmit() {
    setSubmitting(true);
    try {
      const res = await fetch("/api/confectioner/resubmit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (res.ok) {
        toast.success("Профиль отправлен на повторную модерацию");
        loadStatus();
      } else {
        const err = await res.json();
        toast.error(err.error || "Не удалось отправить");
      }
    } catch (e) {
      toast.error("Ошибка сети");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || !info) return null;

  // approved — не показываем баннер (всё хорошо, ничего не отвлекает)
  if (info.status === "approved") return null;

  const config: Record<string, {
    icon: typeof Clock;
    color: string;
    iconColor: string;
    title: string;
    message: string;
    badge: string;
    badgeColor: string;
    showResubmit?: boolean;
  }> = {
    pending: {
      icon: Clock,
      color: "border-amber-200 bg-amber-50/50",
      iconColor: "text-amber-500",
      title: "Профиль на модерации",
      message:
        "Ваш профиль ожидает подтверждения администратора. Обычно это занимает 1-2 рабочих дня. Пока статус не изменится, вы не можете публиковать товары и принимать заказы.",
      badge: "Ожидает",
      badgeColor: "bg-amber-100 text-amber-800",
    },
    rejected: {
      icon: XCircle,
      color: "border-red-200 bg-red-50/50",
      iconColor: "text-red-500",
      title: "Профиль отклонён",
      message: info.rejectionReason || "Причина не указана",
      badge: "Отказ",
      badgeColor: "bg-red-100 text-red-800",
      showResubmit: true,
    },
    needs_revision: {
      icon: AlertCircle,
      color: "border-blue-200 bg-blue-50/50",
      iconColor: "text-blue-500",
      title: "Запрошены правки",
      message: info.rejectionReason || "Внесите правки и отправьте снова",
      badge: "Правки",
      badgeColor: "bg-blue-100 text-blue-800",
      showResubmit: true,
    },
  };

  const c = config[info.status];
  const Icon = c.icon;

  return (
    <Card className={`p-4 border-2 ${c.color}`}>
      <div className="flex items-start gap-3">
        <Icon className={`h-5 w-5 ${c.iconColor} mt-0.5 shrink-0`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-display font-medium">{c.title}</h3>
            <Badge className={`text-[10px] ${c.badgeColor}`}>{c.badge}</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">{c.message}</p>
          {c.showResubmit && (
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                onClick={handleResubmit}
                disabled={submitting}
                className="gap-1.5"
              >
                <Send className="h-3.5 w-3.5" />
                Отправить на повторную модерацию
              </Button>
            </div>
          )}
          {info.status === "pending" && (
            <div className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <div>
                Пока ждёте — можете заполнить профиль подробнее:
                добавить портфолио, описать специализации, настроить способы оплаты.
                После подтверждения вы сразу сможете публиковать товары.
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
