"use client";

/**
 * CommandPalette — глобальный поиск и навигация по Cmd+K / Ctrl+K.
 *
 * Возможности:
 *   - Быстрый переход к разделам (каталог, корзина, дашборд, рецепты и т.д.)
 *   - Поиск товаров по названию
 *   - Поиск кондитеров по имени/городу
 *   - Быстрые действия (создать акцию, добавить товар, открыть чат)
 *   - Поиск по разделам дашборда кондитера
 *
 * Открытие: Cmd+K (Mac) / Ctrl+K (Win/Linux) или клик по кнопке поиска в header.
 *
 * Архитектура: фильтрует команды по введённому тексту, показывает до 8 результатов,
 * навигация стрелками ↑↓, Enter = выполнить, Esc = закрыть.
 */
import { useEffect, useState, useMemo, useRef } from "react";
import { useAppStore } from "@/lib/store";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Search, Home, ShoppingBag, ShoppingCart, ChefHat, Users, Cake,
  Gift, FileText, Settings, MessageCircle, Plus, Package, TrendingUp,
  ShieldCheck, Calendar, Boxes, Bell, Star, Heart, MapPin, Sparkles,
  ArrowRight, CornerDownLeft,
} from "lucide-react";
import type { ViewKey } from "@/lib/types";

interface Command {
  id: string;
  title: string;
  subtitle?: string;
  group: "navigation" | "products" | "confectioners" | "actions" | "dashboard";
  icon: React.ComponentType<{ className?: string }>;
  keywords?: string[];
  action: () => void;
  shortcut?: string;
}

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const navigate = useAppStore((s) => s.navigate);
  const user = useAppStore((s) => s.user);
  const products = useAppStore((s) => s.products);
  const confectioners = useAppStore((s) => s.confectioners);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // === Статичные команды навигации ===
  const navCommands: Command[] = useMemo(() => [
    {
      id: "nav-home",
      title: "Главная",
      subtitle: "Лента, акции, популярные торты",
      group: "navigation",
      icon: Home,
      keywords: ["home", "главная", "лента", "start"],
      action: () => navigate("home"),
    },
    {
      id: "nav-catalog",
      title: "Каталог тортов",
      subtitle: "Все товары маркетплейса",
      group: "navigation",
      icon: ShoppingBag,
      keywords: ["catalog", "каталог", "товары", "products", "торты"],
      action: () => navigate("catalog"),
    },
    {
      id: "nav-confectioners",
      title: "Кондитеры",
      subtitle: "Каталог мастеров",
      group: "navigation",
      icon: Users,
      keywords: ["confectioners", "кондитеры", "мастера", "bakers"],
      action: () => navigate("confectioners"),
    },
    {
      id: "nav-cake-builder",
      title: "Конструктор торта",
      subtitle: "Соберите торт по своим параметрам",
      group: "navigation",
      icon: Cake,
      keywords: ["builder", "конструктор", "собрать", "custom", "кастом"],
      action: () => navigate("cake-builder"),
    },
    {
      id: "nav-cart",
      title: "Корзина",
      subtitle: "Оформление заказа",
      group: "navigation",
      icon: ShoppingCart,
      keywords: ["cart", "корзина", "checkout", "заказ"],
      action: () => navigate("cart"),
    },
    {
      id: "nav-recipes",
      title: "Рецепты",
      subtitle: "Каталог рецептов с KБЖУ",
      group: "navigation",
      icon: ChefHat,
      keywords: ["recipes", "рецепты", "готовка", "cooking"],
      action: () => navigate("recipes"),
    },
    {
      id: "nav-promotions",
      title: "Акции и скидки",
      subtitle: "Текущие предложения",
      group: "navigation",
      icon: Gift,
      keywords: ["promotions", "акции", "скидки", "sale"],
      action: () => navigate("promotions"),
    },
    {
      id: "nav-gift-certificates",
      title: "Подарочные сертификаты",
      subtitle: "Подарок на любой праздник",
      group: "navigation",
      icon: Gift,
      keywords: ["certificates", "сертификаты", "подарок", "gift"],
      action: () => navigate("gift-certificates"),
    },
    {
      id: "nav-corporate",
      title: "Корпоративные мероприятия",
      subtitle: "Торты для офиса и событий",
      group: "navigation",
      icon: Calendar,
      keywords: ["corporate", "корпоратив", "офис", "мероприятие"],
      action: () => navigate("corporate-events"),
    },
    {
      id: "nav-help",
      title: "Помощь и FAQ",
      subtitle: "Ответы на частые вопросы",
      group: "navigation",
      icon: FileText,
      keywords: ["help", "faq", "помощь", "вопрос"],
      action: () => navigate("help"),
    },
  ], [navigate]);

  // === Дашборд-команды (зависят от роли) ===
  const dashboardCommands: Command[] = useMemo(() => {
    if (!user) return [];
    const role = user.roles?.[0] || "CUSTOMER";
    const dashboardView: ViewKey =
      role === "CONFECTIONER" ? "dashboard-confectioner"
      : role === "ADMIN" || role === "SUPER_ADMIN" ? "dashboard-admin"
      : role === "COURIER" ? "dashboard-courier"
      : role === "SUPPLIER" ? "dashboard-supplier"
      : "dashboard-customer";

    const cmds: Command[] = [{
      id: "nav-dashboard",
      title: "Мой дашборд",
      subtitle: `Кабинет (${role})`,
      group: "dashboard",
      icon: Settings,
      keywords: ["dashboard", "дашборд", "кабинет", "profile", "профиль"],
      action: () => navigate(dashboardView),
    }];

    // Подразделы кондитера
    if (role === "CONFECTIONER") {
      cmds.push(
        {
          id: "dash-orders",
          title: "Заказы",
          subtitle: "Дашборд кондитера → Заказы",
          group: "dashboard",
          icon: ShoppingBag,
          keywords: ["orders", "заказы"],
          action: () => navigate(dashboardView),
        },
        {
          id: "dash-products",
          title: "Каталог товаров",
          subtitle: "Дашборд кондитера → Каталог",
          group: "dashboard",
          icon: Package,
          keywords: ["products", "каталог", "товары"],
          action: () => navigate(dashboardView),
        },
        {
          id: "dash-slices",
          title: "Срезы тортов",
          subtitle: "Редактор срезов по начинкам",
          group: "dashboard",
          icon: Cake,
          keywords: ["slices", "срезы", "начинки"],
          action: () => navigate(dashboardView),
        },
        {
          id: "dash-simplex",
          title: "SimpleX (E2E-чат)",
          subtitle: "Приватный канал для премиум-клиентов",
          group: "dashboard",
          icon: ShieldCheck,
          keywords: ["simplex", "приватный", "e2e", "чат"],
          action: () => navigate(dashboardView),
        },
        {
          id: "dash-recipe-stats",
          title: "Статистика рецептов",
          subtitle: "Конверсия подтверждений → заказов",
          group: "dashboard",
          icon: TrendingUp,
          keywords: ["stats", "статистика", "recipes", "рецепты"],
          action: () => navigate(dashboardView),
        },
        {
          id: "dash-inventory",
          title: "Склад",
          subtitle: "Управление инвентарём",
          group: "dashboard",
          icon: Boxes,
          keywords: ["inventory", "склад", "ингредиенты"],
          action: () => navigate(dashboardView),
        },
      );
    }

    return cmds;
  }, [user, navigate]);

  // === Быстрые действия ===
  const actionCommands: Command[] = useMemo(() => {
    const cmds: Command[] = [
      {
        id: "action-chat",
        title: "Открыть чат",
        subtitle: "Сообщения с кондитерами и поддержкой",
        group: "actions",
        icon: MessageCircle,
        keywords: ["chat", "чат", "messages", "сообщения"],
        action: () => navigate("chat"),
      },
    ];

    if (user?.roles?.includes("CONFECTIONER")) {
      cmds.push(
        {
          id: "action-add-product",
          title: "Добавить товар",
          subtitle: "Создать новую карточку торта",
          group: "actions",
          icon: Plus,
          keywords: ["add", "create", "new", "добавить", "создать", "товар"],
          action: () => navigate("dashboard-confectioner"),
        },
        {
          id: "action-ai-photo",
          title: "Сгенерировать фото торта (AI)",
          subtitle: "Создать превью через нейросеть",
          group: "actions",
          icon: Sparkles,
          keywords: ["ai", "generate", "photo", "фото", "генерация"],
          action: () => navigate("dashboard-confectioner"),
        },
      );
    }

    return cmds;
  }, [user, navigate]);

  // === Динамический поиск по товарам ===
  const productCommands: Command[] = useMemo(() => {
    if (!query || query.length < 2) return [];
    const q = query.toLowerCase();
    return products
      .filter((p: any) =>
        p.title?.toLowerCase().includes(q) ||
        p.category?.toLowerCase().includes(q) ||
        p.tags?.some((t: string) => t.toLowerCase().includes(q))
      )
      .slice(0, 5)
      .map((p: any) => ({
        id: `product-${p.id}`,
        title: p.title,
        subtitle: `${p.category} · ${p.price} ₽`,
        group: "products" as const,
        icon: Cake,
        action: () => navigate("product", { id: p.id }),
      }));
  }, [products, query, navigate]);

  // === Динамический поиск по кондитерам ===
  const confectionerCommands: Command[] = useMemo(() => {
    if (!query || query.length < 2) return [];
    const q = query.toLowerCase();
    return confectioners
      .filter((c: any) =>
        c.businessName?.toLowerCase().includes(q) ||
        c.city?.toLowerCase().includes(q) ||
        c.specialization?.some((s: string) => s.toLowerCase().includes(q))
      )
      .slice(0, 4)
      .map((c: any) => ({
        id: `confectioner-${c.id}`,
        title: c.businessName,
        subtitle: `${c.city} · ⭐ ${c.rating}`,
        group: "confectioners" as const,
        icon: ChefHat,
        action: () => navigate("confectioner-profile", { id: c.userId || c.id }),
      }));
  }, [confectioners, query, navigate]);

  // === Объединяем все команды ===
  const allCommands = useMemo(() => {
    return [
      ...actionCommands,
      ...navCommands,
      ...dashboardCommands,
      ...productCommands,
      ...confectionerCommands,
    ];
  }, [actionCommands, navCommands, dashboardCommands, productCommands, confectionerCommands]);

  // === Фильтрация по запросу ===
  const filtered = useMemo(() => {
    if (!query) {
      // Без запроса — показываем навигацию + действия + дашборд
      return [
        ...actionCommands,
        ...navCommands.slice(0, 6),
        ...dashboardCommands,
      ].slice(0, 8);
    }
    const q = query.toLowerCase();
    return allCommands
      .filter((cmd) => {
        if (cmd.group === "products" || cmd.group === "confectioners") return true; // уже отфильтрованы
        return (
          cmd.title.toLowerCase().includes(q) ||
          cmd.subtitle?.toLowerCase().includes(q) ||
          cmd.keywords?.some((k) => k.includes(q))
        );
      })
      .slice(0, 8);
  }, [query, allCommands, actionCommands, navCommands, dashboardCommands]);

  // === Сброс индекса при изменении фильтра ===
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // === Фокус на инпут при открытии ===
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery("");
    }
  }, [open]);

  // === Клавиатурная навигация ===
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = filtered[selectedIndex];
      if (cmd) {
        cmd.action();
        onOpenChange(false);
      }
    }
  };

  const grouped = useMemo(() => {
    const groups: Record<string, Command[]> = {};
    filtered.forEach((cmd) => {
      if (!groups[cmd.group]) groups[cmd.group] = [];
      groups[cmd.group].push(cmd);
    });
    return groups;
  }, [filtered]);

  const groupLabels: Record<string, string> = {
    actions: "⚡ Быстрые действия",
    navigation: "🧭 Навигация",
    dashboard: "📊 Дашборд",
    products: "🎂 Товары",
    confectioners: "👩‍🍳 Кондитеры",
  };

  let runningIndex = 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 max-w-2xl gap-0 overflow-hidden" style={{ top: "10vh" }}>
        <DialogTitle className="sr-only">Панель команд</DialogTitle>
        {/* Search input */}
        <div className="flex items-center border-b px-4">
          <Search className="h-5 w-5 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Поиск: разделы, товары, кондитеры, действия..."
            className="flex-1 px-3 py-4 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden sm:inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              <Search className="h-8 w-8 mx-auto mb-2 opacity-30" />
              Ничего не найдено по запросу «{query}»
            </div>
          ) : (
            Object.entries(grouped).map(([group, cmds]) => (
              <div key={group} className="py-2">
                <div className="px-4 py-1.5 text-[10px] font-semibold uppercase text-muted-foreground tracking-wider">
                  {groupLabels[group] || group}
                </div>
                {cmds.map((cmd) => {
                  const idx = runningIndex++;
                  const isSelected = idx === selectedIndex;
                  const Icon = cmd.icon;
                  return (
                    <button
                      key={cmd.id}
                      onClick={() => {
                        cmd.action();
                        onOpenChange(false);
                      }}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                        isSelected ? "bg-primary/10" : "hover:bg-muted/50"
                      }`}
                    >
                      <div className={`h-8 w-8 rounded-md flex items-center justify-center shrink-0 ${
                        isSelected ? "bg-primary text-primary-foreground" : "bg-muted"
                      }`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{cmd.title}</div>
                        {cmd.subtitle && (
                          <div className="text-xs text-muted-foreground truncate">{cmd.subtitle}</div>
                        )}
                      </div>
                      {isSelected && (
                        <CornerDownLeft className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="border-t px-4 py-2 flex items-center justify-between text-[10px] text-muted-foreground">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="inline-flex h-4 items-center rounded border bg-muted px-1 font-mono">↑↓</kbd>
              навигация
            </span>
            <span className="flex items-center gap-1">
              <kbd className="inline-flex h-4 items-center rounded border bg-muted px-1 font-mono">↵</kbd>
              выбор
            </span>
            <span className="flex items-center gap-1">
              <kbd className="inline-flex h-4 items-center rounded border bg-muted px-1 font-mono">esc</kbd>
              закрыть
            </span>
          </div>
          <div className="hidden sm:block">
            {filtered.length} результат(ов)
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// === Хук для глобального слушателя Cmd+K ===
export function useCommandPaletteShortcut() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return { open, setOpen };
}
