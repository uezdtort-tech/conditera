"use client";

import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const isDev = process.env.NODE_ENV === "development";
    if (isDev && localStorage.getItem("uk_sw_dev") !== "true") return;

    let disposed = false;
    let updateInterval: number | undefined;

    const register = async () => {
      if (disposed) return;
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });

        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          if (!newWorker) return;
          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              console.info("[PWA] Новая версия service worker готова");
            }
          });
        });

        if (updateInterval === undefined) {
          updateInterval = window.setInterval(() => {
            registration.update().catch(() => {});
          }, 60 * 60 * 1000);
        }
        console.info("[PWA] Service Worker зарегистрирован");
      } catch (error) {
        console.warn("[PWA] Ошибка регистрации SW:", error);
      }
    };

    if (document.readyState === "complete") {
      void register();
    } else {
      window.addEventListener("load", register, { once: true });
    }

    return () => {
      disposed = true;
      window.removeEventListener("load", register);
      if (updateInterval !== undefined) window.clearInterval(updateInterval);
    };
  }, []);

  return null;
}
