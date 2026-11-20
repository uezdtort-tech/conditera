"use client";

import { useEffect } from "react";

type PublicDesign = {
  primary_color?: string;
  accent_color?: string;
  background_color?: string;
  text_color?: string;
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function DesignSettingsRuntime() {
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/cms/design", { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Design settings unavailable")))
      .then((payload: { design?: PublicDesign | null }) => {
        if (controller.signal.aborted || !payload.design) return;
        const design = payload.design;
        const root = document.documentElement;
        const vars: Array<[string, string | undefined]> = [
          ["--primary", design.primary_color],
          ["--accent", design.accent_color],
          ["--background", design.background_color],
          ["--foreground", design.text_color],
          ["--card", design.background_color],
          ["--popover", design.background_color],
        ];
        for (const [name, value] of vars) {
          if (value && HEX_COLOR.test(value)) root.style.setProperty(name, value);
        }
      })
      .catch(() => {
        // Сохраняем CSS-палитру из globals.css как безопасный fallback.
      });
    return () => controller.abort();
  }, []);

  return null;
}
