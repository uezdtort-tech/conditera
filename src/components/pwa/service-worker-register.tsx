"use client";

import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    // Регистрируем только в продакшене или при явном разрешении
    const isDev = process.env.NODE_ENV === "development";
    if (isDev && !localStorage.getItem("uk_sw_dev")) return;

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });

        // Проверяем обновления
        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              // Новая версия доступна
              console.log("[PWA] Новая версия доступна, перезагрузите страницу");
              // Можно показать toast "Доступно обновление"
            }
          });
        });

        // Периодическая проверка обновлений (раз в час)
        setInterval(() => {
          registration.update().catch(() => {});
        }, 60 * 60 * 1000);

        console.log("[PWA] Service Worker зарегистрирован");
      } catch (err) {
        console.warn("[PWA] Ошибка регистрации SW:", err);
      }
    };

    // Регистрируем после загрузки страницы
    window.addEventListener("load", register);

    return () => {
      window.removeEventListener("load", register);
    };
  }, []);

  return null;
}
