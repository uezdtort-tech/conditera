"use client";

import { useAppStore } from "@/lib/store";
import { ChevronRight, Home } from "lucide-react";
import type { ViewKey } from "@/lib/types";

interface Crumb {
  label: string;
  view?: ViewKey;
  params?: Record<string, string>;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  const navigate = useAppStore((s) => s.navigate);

  return (
    <nav className="flex items-center gap-1 text-xs text-muted-foreground mb-4 overflow-x-auto whitespace-nowrap">
      <button
        onClick={() => navigate("home")}
        className="flex items-center gap-1 hover:text-primary transition-colors"
      >
        <Home className="h-3 w-3" />
        <span className="hidden sm:inline">Главная</span>
      </button>
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1">
          <ChevronRight className="h-3 w-3 shrink-0" />
          {item.view ? (
            <button
              onClick={() => navigate(item.view!, item.params)}
              className="hover:text-primary transition-colors"
            >
              {item.label}
            </button>
          ) : (
            <span className="text-foreground font-medium">{item.label}</span>
          )}
        </div>
      ))}
    </nav>
  );
}
