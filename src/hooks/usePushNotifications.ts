"use client";

/**
 * usePushNotifications — client-side hook for Web Push.
 *
 * - Requests notification permission
 * - Subscribes to push via VAPID
 * - Sends subscription to backend
 * - Listens for incoming push events (via Service Worker)
 *
 * Usage:
 *   const { isSupported, permission, subscribe, unsubscribe } = usePushNotifications();
 *   if (isSupported && permission === "default") subscribe();
 */
import { useState, useEffect, useCallback } from "react";

export function usePushNotifications() {
  const [isSupported, setIsSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window) {
      setIsSupported(true);
      setPermission(Notification.permission);

      // Check if already subscribed
      navigator.serviceWorker.ready
        .then((reg) => reg.pushManager.getSubscription())
        .then((sub) => setIsSubscribed(!!sub))
        .catch(() => {});
    }
  }, []);

  const subscribe = useCallback(async () => {
    if (!isSupported) return;

    setLoading(true);
    try {
      // Request permission
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") {
        return;
      }

      // Get VAPID public key from backend
      const resp = await fetch("/api/notifications/vapid-key");
      if (!resp.ok) {
        console.warn("[push] VAPID key not configured");
        return;
      }
      const { publicKey } = await resp.json();

      // Convert VAPID key to Uint8Array
      const applicationServerKey = urlBase64ToUint8Array(publicKey);

      // Subscribe via Service Worker
      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey as BufferSource,
      });

      // Send subscription to backend
      const sub = subscription.toJSON();
      await fetch("/api/notifications/push-subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: sub.endpoint,
          keys: sub.keys,
        }),
      });

      setIsSubscribed(true);
      console.info("[push] subscribed successfully");
    } catch (err) {
      console.error("[push] subscribe error:", err);
    } finally {
      setLoading(false);
    }
  }, [isSupported]);

  const unsubscribe = useCallback(async () => {
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await sub.unsubscribe();
        await fetch(`/api/notifications/push-subscribe?endpoint=${encodeURIComponent(sub.endpoint)}`, {
          method: "DELETE",
        });
      }
      setIsSubscribed(false);
      console.info("[push] unsubscribed");
    } catch (err) {
      console.error("[push] unsubscribe error:", err);
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
