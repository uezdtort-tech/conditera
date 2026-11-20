"use client";

import { useEffect, useCallback } from "react";
import { useAppStore } from "@/lib/store";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { toast } from "sonner";

/**
 * Offers an unobtrusive opt-in and persists a real PushManager subscription.
 * Browser permission alone is never presented as a server subscription.
 */
export function PushNotificationManager() {
  const user = useAppStore((s) => s.user);
  const { isSupported, permission, isSubscribed, subscribe } = usePushNotifications(!!user);

  const requestPermission = useCallback(async () => {
    try {
      const saved = await subscribe();
      if (saved) {
        toast.success("Push-уведомления включены", {
          description: "Вы будете получать оповещения о заказах и сообщениях",
        });
      } else if (typeof Notification !== "undefined" && Notification.permission === "denied") {
        toast.error("Уведомления заблокированы", {
          description: "Разрешите уведомления в настройках браузера",
        });
      }
    } catch (error) {
      toast.error("Не удалось включить push-уведомления", {
        description: error instanceof Error ? error.message : "Проверьте настройки браузера и сервера",
      });
    }
  }, [subscribe]);

  useEffect(() => {
    if (!user || !isSupported || isSubscribed || permission !== "default") return;
    const promptKey = `uk_push_asked_${user.id}`;
    if (localStorage.getItem(promptKey) === "true") return;

    const timer = window.setTimeout(() => {
      localStorage.setItem(promptKey, "true");
      toast("Включить push-уведомления?", {
        description: "Будем сообщать о заказах и сообщениях",
        action: {
          label: "Включить",
          onClick: requestPermission,
        },
        duration: 10000,
      });
    }, 30000);

    return () => window.clearTimeout(timer);
  }, [user, isSupported, isSubscribed, permission, requestPermission]);

  return null;
}
