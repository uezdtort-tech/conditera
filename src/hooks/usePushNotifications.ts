"use client";

/**
 * Web Push lifecycle for the authenticated browser user.
 * The subscription is persisted server-side; local permission alone is not
 * treated as a successful subscription.
 */
import { useState, useEffect, useCallback } from "react";
import { csrfFetch } from "@/lib/api-client";

export function usePushNotifications(enabled = true, userId?: string) {
  const [isSupported, setIsSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const supported =
      "Notification" in window &&
      "serviceWorker" in navigator &&
      "PushManager" in window;
    setIsSupported(supported);
    if (!supported) return;

    setPermission(Notification.permission);
    let cancelled = false;

    navigator.serviceWorker.ready
      .then(async (registration) => {
        const subscription = await registration.pushManager.getSubscription();
        if (cancelled) return;
        setIsSubscribed(!!subscription);
        if (subscription) {
          const saved = await csrfFetch("/api/notifications/push-subscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(subscription.toJSON()),
          });
          if (!saved.ok) {
            setIsSubscribed(false);
            throw new Error("Не удалось синхронизировать push-подписку с аккаунтом");
          }
        }
      })
      .catch((error) => {
        if (!cancelled) console.warn("[push] subscription sync failed:", error);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, userId]);

  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!isSupported) throw new Error("Push-уведомления не поддерживаются браузером");

    setLoading(true);
    try {
      const nextPermission = await Notification.requestPermission();
      setPermission(nextPermission);
      if (nextPermission !== "granted") return false;

      const keyResponse = await csrfFetch("/api/notifications/vapid-key");
      if (!keyResponse.ok) {
        throw new Error("VAPID-ключи Web Push не настроены на сервере");
      }
      const { publicKey } = await keyResponse.json() as { publicKey?: string };
      if (!publicKey) throw new Error("Сервер не вернул публичный VAPID-ключ");

      const registration = await navigator.serviceWorker.ready;
      const applicationServerKey = urlBase64ToUint8Array(publicKey) as BufferSource;
      const existing = await registration.pushManager.getSubscription();
      let subscription = existing ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });

      let saveResponse = await csrfFetch("/api/notifications/push-subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });

      // A browser may retain a subscription created while another account was
      // active. On an ownership conflict, rotate the browser endpoint in the
      // current user gesture and register the new subscription.
      if (saveResponse.status === 409 && existing) {
        await existing.unsubscribe();
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        });
        saveResponse = await csrfFetch("/api/notifications/push-subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(subscription.toJSON()),
        });
      }

      if (!saveResponse.ok) {
        const payload = await saveResponse.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error || "Не удалось сохранить push-подписку");
      }

      setIsSubscribed(true);
      return true;
    } catch (error) {
      console.error("[push] subscribe error:", error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [isSupported]);

  const unsubscribe = useCallback(async () => {
    setLoading(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const response = await csrfFetch(
          `/api/notifications/push-subscribe?endpoint=${encodeURIComponent(subscription.endpoint)}`,
          { method: "DELETE" },
        );
        if (!response.ok) {
          throw new Error("Не удалось удалить push-подписку с сервера");
        }
        await subscription.unsubscribe();
      }
      setIsSubscribed(false);
    } catch (error) {
      console.error("[push] unsubscribe error:", error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    isSupported,
    permission,
    isSubscribed,
    loading,
    subscribe,
    unsubscribe,
  };
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
