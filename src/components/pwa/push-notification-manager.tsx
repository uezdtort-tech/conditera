"use client";

import { useEffect, useState, useCallback } from "react";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Bell, BellOff, Check } from "lucide-react";
import { toast } from "sonner";

export function PushNotificationManager() {
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [isSupported, setIsSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const user = useAppStore((s) => s.user);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setIsSupported("Notification" in window && "serviceWorker" in navigator);
    if ("Notification" in window) {
      setPermission(Notification.permission);
    }
    // Проверяем, подписан ли уже
    if (user && localStorage.getItem(`uk_push_${user.id}`) === "true") {
      setSubscribed(true);
    }
  }, [user]);

  const requestPermission = useCallback(async () => {
    if (!isSupported) {
      toast.error("Push-уведомления не поддерживаются вашим браузером");
      return;
    }
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === "granted") {
      toast.success("Уведомления включены!", {
        description: "Вы будете получать оповещения о заказах и сообщениях",
      });
      // Отправляем тестовое уведомление
      setTimeout(() => {
        new Notification("Кондитера", {
          body: "🎂 Уведомления включены! Теперь вы не пропустите важные события.",
          icon: "/icon-192.png",
          badge: "/icon-192.png",
          tag: "uk-welcome",
        });
      }, 1000);

      // В реальном приложении здесь была бы подписка через Push API
      // const registration = await navigator.serviceWorker.ready;
      // const subscription = await registration.pushManager.subscribe({...});
      // await fetch("/api/notifications/subscribe", { ... })

      if (user) {
        localStorage.setItem(`uk_push_${user.id}`, "true");
      }
      setSubscribed(true);
    } else if (result === "denied") {
      toast.error("Уведомления заблокированы", {
        description: "Вы можете изменить это в настройках браузера",
      });
    }
  }, [isSupported, user]);

  const unsubscribe = useCallback(() => {
    if (user) {
      localStorage.removeItem(`uk_push_${user.id}`);
    }
    setSubscribed(false);
    toast.info("Уведомления отключены");
  }, [user]);

  // Автоматически запрашиваем разрешение при первом входе (через 30 сек)
  useEffect(() => {
    if (!user || !isSupported || permission !== "default") return;
    if (localStorage.getItem("uk_push_asked")) return;

    const timer = setTimeout(() => {
      localStorage.setItem("uk_push_asked", "true");
      // Показываем мягкий тост с предложением
      toast("Включить уведомления?", {
        description: "Будем сообщать о заказах и сообщениях",
        action: {
          label: "Включить",
          onClick: requestPermission,
        },
        duration: 10000,
      });
    }, 30000);

    return () => clearTimeout(timer);
  }, [user, isSupported, permission, requestPermission]);

  // Невидимый компонент — управляет только логикой
  return null;
}
