"use client";

import { useAppStore } from "@/lib/store";
import { Moon, Sun } from "lucide-react";
import { useEffect } from "react";

export function ThemeToggle() {
  const theme = useAppStore((s) => s.theme);
  const setTheme = (t: "light" | "dark") => {
    useAppStore.setState({ theme: t });
  };

  useEffect(() => {
    if (typeof document !== "undefined") {
      if (theme === "dark") {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
    }
  }, [theme]);

  return (
    <button
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      className="h-9 w-9 rounded-lg hover:bg-accent flex items-center justify-center transition-all"
      aria-label="Переключить тему"
    >
      {theme === "dark" ? (
        <Sun className="h-4 w-4 text-amber-500" />
      ) : (
        <Moon className="h-4 w-4 text-muted-foreground" />
      )}
    </button>
  );
}
