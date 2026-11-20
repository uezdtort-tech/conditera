"use client";

import { useEffect } from "react";

type PublicDesign = {
  theme?: string;
  primary_color?: string;
  accent_color?: string;
  background_color?: string;
  text_color?: string;
  font_heading?: string;
  font_body?: string;
  layout_style?: string;
  max_width?: number;
  animations_enabled?: boolean;
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const FONT_NAME = /^[a-zA-Z0-9 _-]{1,80}$/;

const FONT_ALIASES: Record<string, string> = {
  "brokgauz_amp_efron-italic": "var(--cms-font-display-default)",
  "triodpostnaja-medium": "var(--cms-font-brand-default)",
  neucha: "var(--cms-font-script-default)",
  geist: "var(--cms-font-geist-default)",
  "geist mono": "var(--cms-font-geist-mono-default)",
};

const RADIUS_TOKENS: Record<string, Record<string, string>> = {
  classic: { base: "0.875rem", sm: "4px", md: "8px", lg: "12px", xl: "16px", "2xl": "24px" },
  modern: { base: "1rem", sm: "8px", md: "12px", lg: "16px", xl: "24px", "2xl": "32px" },
  minimal: { base: "0.5rem", sm: "2px", md: "4px", lg: "6px", xl: "8px", "2xl": "12px" },
};

function resolveFontFamily(value: string | undefined, fallback: string): string {
  const name = typeof value === "string" && FONT_NAME.test(value) ? value.trim() : "";
  if (!name) return fallback;
  return FONT_ALIASES[name.toLowerCase()] ?? `"${name}", sans-serif`;
}

export function DesignSettingsRuntime() {
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/cms/design", { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Design settings unavailable")))
      .then((payload: { design?: PublicDesign | null }) => {
        if (controller.signal.aborted || !payload.design) return;
        const design = payload.design;
        const root = document.documentElement;
        const body = document.body;
        const computed = getComputedStyle(body);

        // Preserve the actual Next/font-generated family names before allowing
        // the CMS to override the public font variables.
        const fontDefaults: Array<[string, string]> = [
          ["--cms-font-display-default", "--font-display"],
          ["--cms-font-brand-default", "--font-brand"],
          ["--cms-font-script-default", "--font-script"],
          ["--cms-font-geist-default", "--font-geist-sans"],
          ["--cms-font-geist-mono-default", "--font-geist-mono"],
        ];
        for (const [alias, source] of fontDefaults) {
          const value = computed.getPropertyValue(source).trim();
          if (value) body.style.setProperty(alias, value);
        }

        const colors: Array<[string, string | undefined]> = [
          ["--primary", design.primary_color],
          ["--accent", design.accent_color],
          ["--background", design.background_color],
          ["--foreground", design.text_color],
          ["--card", design.background_color],
          ["--popover", design.background_color],
        ];
        for (const [name, value] of colors) {
          if (value && HEX_COLOR.test(value)) root.style.setProperty(name, value);
        }

        body.style.setProperty(
          "--font-display",
          resolveFontFamily(design.font_heading, "var(--cms-font-display-default)"),
        );
        body.style.setProperty(
          "--font-geist-sans",
          resolveFontFamily(design.font_body, "var(--cms-font-geist-default)"),
        );

        const layout = design.layout_style && RADIUS_TOKENS[design.layout_style]
          ? design.layout_style
          : "classic";
        root.dataset.cmsLayout = layout;
        for (const [token, value] of Object.entries(RADIUS_TOKENS[layout])) {
          root.style.setProperty(token === "base" ? "--radius" : `--radius-${token}`, value);
        }

        const maxWidth = Number.isInteger(design.max_width) && design.max_width! >= 960 && design.max_width! <= 1600
          ? design.max_width!
          : 1280;
        root.style.setProperty("--cms-max-width", `${maxWidth}px`);
        root.dataset.cmsAnimations = design.animations_enabled === false ? "off" : "on";
      })
      .catch(() => {
        // Сохраняем CSS-палитру и типографику из globals.css как безопасный fallback.
      });
    return () => controller.abort();
  }, []);

  return null;
}
