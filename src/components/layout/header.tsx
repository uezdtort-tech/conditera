"use client";

import { useState, useEffect } from "react";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Menu, Search, ShoppingCart, Heart, User as UserIcon, LogOut,
  LayoutDashboard, Cake, MessageCircle, ChevronDown, ChevronRight,
  Sparkles, X, Bot, Gift, BookOpen, Building2, Truck, Store,
  Star, TrendingUp, Phone, HelpCircle, Info, Newspaper, Mail,
  Package, Palette, PartyPopper, Users, Award, Zap, Flame,
  Shield, FileText, Cookie, ShoppingBag, Contact, Briefcase,
  ChefHat, Wrench, ChevronLeft, Home as HomeIcon,
} from "lucide-react";
import { CATEGORIES, CATEGORY_GROUPS } from "@/lib/mock-data";
import { LocationPicker } from "@/components/layout/location-picker";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { NotificationsBell } from "@/components/layout/notifications-bell";
import { GlobalSearch } from "@/components/ui/enhanced-components";
import { VisualSearchButton } from "@/components/visual-search/visual-search-button";
import type { ViewKey, Role } from "@/lib/types";

// ===== Навигация: основные разделы =====
const NAV_MAIN: { label: string; view: ViewKey; icon: typeof Cake }[] = [
  { label: "Каталог", view: "catalog", icon: Cake },
  { label: "Кондитеры", view: "confectioners", icon: Users },
  { label: "Акции", view: "promotions", icon: Flame },
  { label: "Рецепты", view: "recipes", icon: BookOpen },
];

// ===== B2B и услуги =====
const NAV_B2B: { label: string; view: ViewKey; icon: typeof Building2; desc: string }[] = [
  { label: "Корпоративам", view: "corporate-events", icon: Building2, desc: "Торты на корпоративы" },
  { label: "Магазин декора", view: "decor-shop", icon: Palette, desc: "Декор, упаковка" },
  { label: "Услуги и площадки", view: "services-shop", icon: PartyPopper, desc: "Батуты, картинг, лофты" },
  { label: "Ингредиенты", view: "supplier-shop", icon: Package, desc: "B2B-магазин" },
  { label: "Тендеры", view: "tenders", icon: Award, desc: "Разместить заказ" },
  { label: "Готовые изделия", view: "ready-made", icon: Zap, desc: "В наличии, быстро" },
];

// ===== Информация =====
const NAV_INFO: { label: string; view: ViewKey; icon: typeof Info; desc: string }[] = [
  { label: "О платформе", view: "about", icon: Info, desc: "Наша миссия" },
  { label: "Блог", view: "blog", icon: Newspaper, desc: "Статьи и новости" },
  { label: "Отзывы", view: "reviews", icon: Star, desc: "Что говорят клиенты" },
  { label: "Контакты", view: "contacts", icon: Phone, desc: "Связаться с нами" },
  { label: "Помощь", view: "help", icon: HelpCircle, desc: "Центр поддержки" },
  { label: "Telegram-бот", view: "telegram-bot", icon: Bot, desc: "Заказы в Telegram" },
  { label: "Подарочные сертификаты", view: "gift-certificates", icon: Gift, desc: "Идеальный подарок" },
  { label: "Вопросы и ответы", view: "faq", icon: HelpCircle, desc: "FAQ" },
];

// ===== Для бизнеса =====
const NAV_BUSINESS: { label: string; view: ViewKey; icon: typeof ChefHat; desc: string }[] = [
  { label: "Кондитерам", view: "for-confectioners", icon: ChefHat, desc: "Стать продавцом" },
  { label: "Поставщикам", view: "for-suppliers", icon: Store, desc: "Разместить товары" },
];

// ===== Промо-баннер (верхняя полоска) — мягкая =====
function TopPromoBar({ onNavigate }: { onNavigate: (view: ViewKey) => void }) {
  const [visible, setVisible] = useState(true);
  const [index, setIndex] = useState(0);

  const promos = [
    { text: "Бесплатная доставка от 3000 ₽", action: "catalog" as ViewKey },
    { text: "Подарочные сертификаты для сладкоежек", action: "gift-certificates" as ViewKey },
    { text: "Заказывайте через Telegram-бот", action: "telegram-bot" as ViewKey },
    { text: "Акции и скидки от кондитеров", action: "promotions" as ViewKey },
  ];

  useEffect(() => {
    try {
      if (sessionStorage.getItem("uk_promo_bar_closed") === "true") setVisible(false);
    } catch {}
  }, []);

  useEffect(() => {
    if (!visible) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % promos.length), 12000);
    return () => clearInterval(timer);
  }, [visible, promos.length]);

  const handleClose = () => {
    setVisible(false);
    try { sessionStorage.setItem("uk_promo_bar_closed", "true"); } catch {}
  };

  if (!visible) return null;

  return (
    <div className="bg-muted/60 border-b border-border/40 text-foreground text-xs">
      <div className="container mx-auto px-4 h-8 flex items-center justify-center gap-3 relative">
        <span className="text-muted-foreground hidden sm:inline">•</span>
        <button
          onClick={() => onNavigate(promos[index].action)}
          className="text-center text-muted-foreground hover:text-foreground transition-colors truncate max-w-[80%]"
        >
          {promos[index].text}
        </button>
        <span className="text-muted-foreground hidden sm:inline">→</span>
        <button onClick={handleClose} className="absolute right-2 hover:bg-accent rounded p-0.5 text-muted-foreground hover:text-foreground" aria-label="Закрыть">
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

// ===== Dashboard map для всех 26 ролей =====
const DASHBOARD_MAP: Record<string, ViewKey> = {
  GUEST: "home",
  CUSTOMER: "dashboard-customer",
  CONFECTIONER: "dashboard-confectioner",
  STUDIO: "dashboard-confectioner",
  SUPPLIER: "dashboard-supplier",
  COURIER: "dashboard-courier",
  ADMIN: "dashboard-admin",
  SUPER_ADMIN: "dashboard-admin",
  MODERATOR: "dashboard-moderator",
  SUPPORT: "dashboard-support",
  COPYWRITER: "dashboard-copywriter",
  FOOD_SERVICE: "dashboard-food-service",
  EVENT_ORGANIZER: "dashboard-event-organizer",
  BLOGGER: "dashboard-blogger",
  PICKUP_POINT: "dashboard-pickup-point",
  WHOLESALER: "dashboard-wholesaler",
  TASTER: "dashboard-taster",
  FRANCHISEE: "dashboard-franchisee",
  NUTRITIONIST: "dashboard-nutritionist",
  CORPORATE_CLIENT: "dashboard-corporate-client",
  QUALITY_INSPECTOR: "dashboard-quality-inspector",
  CERTIFICATION_AGENT: "dashboard-certification-agent",
  VENUE_OWNER: "dashboard-venue-owner",
  ANIMATOR_AGENCY: "dashboard-animator-agency",
  RECREATION_CENTER: "dashboard-recreation-center",
  KIDS_CLUB: "dashboard-kids-club",
};

const ROLE_LABELS: Record<string, string> = {
  GUEST: "Главная",
  CUSTOMER: "Кабинет покупателя",
  CONFECTIONER: "Кабинет кондитера",
  STUDIO: "Студия кондитера",
  SUPPLIER: "Кабинет поставщика",
  COURIER: "Кабинет курьера",
  ADMIN: "Админ-панель",
  SUPER_ADMIN: "Супер-админ",
  MODERATOR: "Модерация",
  SUPPORT: "Поддержка",
  COPYWRITER: "Кабинет копирайтера",
  FOOD_SERVICE: "B2B-кабинет (общепит)",
  EVENT_ORGANIZER: "Кабинет организатора",
  BLOGGER: "Кабинет блогера",
  PICKUP_POINT: "Кабинет ПВЗ",
  WHOLESALER: "Кабинет оптовика",
  TASTER: "Кабинет дегустатора",
  FRANCHISEE: "Кабинет франчайзи",
  NUTRITIONIST: "Кабинет нутрициолога",
  CORPORATE_CLIENT: "Корпоративный кабинет",
  QUALITY_INSPECTOR: "Инспекция качества",
  CERTIFICATION_AGENT: "Агент сертификации",
  VENUE_OWNER: "Кабинет площадки",
  ANIMATOR_AGENCY: "Агентство аниматоров",
  RECREATION_CENTER: "Развлекательный центр",
  KIDS_CLUB: "Детский клуб",
};

export function Header() {
  const navigate = useAppStore((s) => s.navigate);
  const nav = useAppStore((s) => s.nav);
  const user = useAppStore((s) => s.user);
  const activeRole = useAppStore((s) => s.activeRole);
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const logout = useAppStore((s) => s.logout);
  const setAuthModalOpen = useAppStore((s) => s.setAuthModalOpen);
  const setMobileMenuOpen = useAppStore((s) => s.setMobileMenuOpen);
  const mobileMenuOpen = useAppStore((s) => s.mobileMenuOpen);
  const setCartOpen = useAppStore((s) => s.setCartOpen);
  const setChatOpen = useAppStore((s) => s.setChatOpen);
  const cart = useAppStore((s) => s.cart);
  const favorites = useAppStore((s) => s.favorites);

  const [searchQuery, setSearchQuery] = useState("");
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const currentView = nav.view;

  const isActive = (view: ViewKey) => currentView === view;

  const goToDashboard = () => {
    if (!activeRole) return;
    navigate(DASHBOARD_MAP[activeRole] || "home");
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate("catalog", { q: searchQuery.trim() });
      setMobileSearchOpen(false);
      setSearchQuery("");
    }
  };

  const confectioneryCats = CATEGORIES.filter((c) => c.group === "Кондитерские изделия");
  const supplyCats = CATEGORIES.filter((c) => c.group === "Сопутствующие товары");

  // Проверка активной группы
  const isB2BActive = NAV_B2B.some((l) => l.view === currentView);
  const isInfoActive = NAV_INFO.some((l) => l.view === currentView);
  const isBusinessActive = NAV_BUSINESS.some((l) => l.view === currentView);

  return (
    <>
      <TopPromoBar onNavigate={navigate} />

      <header className="sticky top-0 z-40 w-full border-b border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <div className="container mx-auto px-4">
          <div className="flex h-16 items-center justify-between gap-3">
            {/* Logo */}
            <button onClick={() => navigate("home")} className="flex items-center gap-2 shrink-0 group" aria-label="Уездный кондитер — на главную">
              <img src="/logo.png" alt="Уездный кондитер" className="h-12 w-12 rounded-full object-cover shadow-md group-hover:scale-105 transition-transform" />
              <div className="hidden sm:block text-left leading-tight">
                <div className="logo-text text-lg text-foreground">Уездный кондитер</div>
              </div>
            </button>

            {/* Location picker — desktop */}
            <div className="hidden md:block">
              <LocationPicker />
            </div>

            {/* Global search — рядом с локацией */}
            <div className="hidden md:block flex-1 max-w-md">
              <GlobalSearch />
            </div>

            {/* Mobile search trigger */}
            <Button variant="ghost" size="icon" onClick={() => setMobileSearchOpen(true)} className="md:hidden h-9 w-9" aria-label="Поиск">
              <Search className="h-4 w-4" />
            </Button>

            {/* Visual search (по фото) */}
            <VisualSearchButton compact />

            {/* Actions */}
            <div className="flex items-center gap-1 sm:gap-2 ml-auto">
              {/* Конструктор */}
              <Button variant="default" size="sm" onClick={() => navigate("cake-builder")} className="hidden md:flex bg-gradient-to-r from-primary to-accent hover:opacity-90">
                <Cake className="h-4 w-4 mr-1.5" />Конструктор
              </Button>

              {/* Favorites */}
              <Button variant="ghost" size="icon" onClick={() => navigate("dashboard-customer", { tab: "favorites" })} className="relative h-9 w-9" aria-label="Избранное">
                <Heart className="h-4 w-4" />
                {favorites.length > 0 && <Badge className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 text-[10px] bg-primary text-primary-foreground">{favorites.length}</Badge>}
              </Button>

              {/* Chat */}
              <Button variant="ghost" size="icon" onClick={() => setChatOpen(true)} className="h-9 w-9 hidden sm:flex" aria-label="Чат">
                <MessageCircle className="h-4 w-4" />
              </Button>

              {/* Notifications */}
              <NotificationsBell />

              {/* Cart */}
              <Button variant="ghost" size="icon" onClick={() => setCartOpen(true)} className="relative h-9 w-9" aria-label="Корзина">
                <ShoppingCart className="h-4 w-4" />
                {cartCount > 0 && <Badge className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 text-[10px] bg-primary text-primary-foreground">{cartCount}</Badge>}
              </Button>

              {/* Auth */}
              {isAuthenticated && user ? (
                <>
                  <ThemeToggle />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent transition-colors">
                        <Avatar className="h-8 w-8 border border-border">
                          <AvatarImage src={user.avatar} alt={user.name} />
                          <AvatarFallback className="bg-primary/10 text-primary text-xs">{user.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground hidden sm:block" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-64 p-0">
                      <div className="p-3 border-b">
                        <div className="flex items-center gap-2">
                          <Avatar className="h-10 w-10 border border-border">
                            <AvatarImage src={user.avatar} alt={user.name} />
                            <AvatarFallback className="bg-primary/10 text-primary">{user.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">{user.name}</div>
                            <div className="text-xs text-muted-foreground truncate">{user.email}</div>
                          </div>
                        </div>
                      </div>
                      <div className="p-2">
                        <button onClick={goToDashboard} className="w-full flex items-center gap-2 p-2 rounded-md hover:bg-accent text-left">
                          <LayoutDashboard className="h-4 w-4 text-primary" />
                          <div className="flex-1">
                            <div className="text-sm font-medium">{activeRole ? ROLE_LABELS[activeRole] : "Личный кабинет"}</div>
                          </div>
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>

                        {user.roles.length > 1 && (
                          <>
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold px-2 pt-3 pb-1">Сменить роль</div>
                            <div className="grid grid-cols-1 gap-0.5">
                              {user.roles.map((role) => (
                                <button key={role} onClick={() => useAppStore.getState().setActiveRole(role)} className="flex items-center gap-2 p-1.5 rounded-md hover:bg-accent text-left text-xs">
                                  <div className={`w-2 h-2 rounded-full ${activeRole === role ? "bg-primary" : "bg-muted-foreground/30"}`} />
                                  {ROLE_LABELS[role] || role}
                                </button>
                              ))}
                            </div>
                          </>
                        )}

                        <div className="border-t mt-2 pt-2">
                          <button onClick={logout} className="w-full flex items-center gap-2 p-2 rounded-md hover:bg-accent text-left text-destructive">
                            <LogOut className="h-4 w-4" /><span className="text-sm">Выйти</span>
                          </button>
                        </div>
                      </div>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              ) : (
                <>
                  <ThemeToggle />
                  <Button size="sm" onClick={() => setAuthModalOpen(true)} className="hidden sm:flex">
                    <UserIcon className="h-4 w-4 mr-1.5" />Войти
                  </Button>
                </>
              )}

              {/* Mobile menu trigger */}
              <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" className="lg:hidden h-9 w-9">
                    <Menu className="h-5 w-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-80 p-0 overflow-y-auto">
                  <SheetHeader className="p-4 border-b">
                    <SheetTitle className="flex items-center gap-2">
                      <img src="/logo.png" alt="" className="h-10 w-10 rounded-full object-cover" />
                      <div>
                        <div className="logo-text text-base">Уездный кондитер</div>
                        <div className="text-[10px] text-muted-foreground font-normal">маркетплейс кондитеров России</div>
                      </div>
                    </SheetTitle>
                  </SheetHeader>

                  <div className="p-3 space-y-1 max-h-[calc(100vh-80px)] overflow-y-auto">
                    {/* Конструктор */}
                    <Button className="w-full bg-gradient-to-r from-primary to-accent" onClick={() => { navigate("cake-builder"); setMobileMenuOpen(false); }}>
                      <Cake className="h-4 w-4 mr-2" />Конструктор торта
                    </Button>

                    {/* Основная навигация */}
                    <div className="pt-2">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold px-2 mb-1">Навигация</div>
                      {NAV_MAIN.map((link) => (
                        <button key={link.view} onClick={() => { navigate(link.view); setMobileMenuOpen(false); }} className={`w-full flex items-center gap-2 px-3 py-2.5 text-sm font-medium rounded-md ${isActive(link.view) ? "bg-primary/10 text-primary" : "hover:bg-accent"}`}>
                          <link.icon className="h-4 w-4" />{link.label}
                        </button>
                      ))}
                    </div>

                    {/* Категории — collapsible */}
                    <div className="pt-2">
                      <button onClick={() => setExpandedSection(expandedSection === "cats" ? null : "cats")} className="w-full flex items-center justify-between px-2 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold hover:text-foreground">
                        <span>Категории</span>
                        <ChevronDown className={`h-3 w-3 transition-transform ${expandedSection === "cats" ? "rotate-180" : ""}`} />
                      </button>
                      {expandedSection === "cats" && (
                        <div className="grid grid-cols-2 gap-1 px-1 pb-2">
                          {confectioneryCats.slice(0, 12).map((cat) => (
                            <button key={cat.slug} onClick={() => { navigate("catalog", { category: cat.slug }); setMobileMenuOpen(false); }} className="flex items-center gap-1.5 px-2 py-1.5 text-xs hover:bg-accent rounded-md text-left">
                              <span>{cat.icon}</span><span className="truncate">{cat.name}</span>
                            </button>
                          ))}
                          <button onClick={() => { navigate("catalog"); setMobileMenuOpen(false); }} className="col-span-2 text-center text-xs text-primary hover:underline py-1">Все категории →</button>
                        </div>
                      )}
                    </div>

                    {/* B2B и услуги — collapsible */}
                    <div className="pt-1">
                      <button onClick={() => setExpandedSection(expandedSection === "b2b" ? null : "b2b")} className="w-full flex items-center justify-between px-2 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold hover:text-foreground">
                        <span>B2B и услуги</span>
                        <ChevronDown className={`h-3 w-3 transition-transform ${expandedSection === "b2b" ? "rotate-180" : ""}`} />
                      </button>
                      {expandedSection === "b2b" && (
                        <div className="space-y-0.5 px-1 pb-2">
                          {NAV_B2B.map((link) => (
                            <button key={link.view} onClick={() => { navigate(link.view); setMobileMenuOpen(false); }} className="w-full flex items-center gap-2 px-2 py-2 text-sm hover:bg-accent rounded-md">
                              <link.icon className="h-4 w-4 text-muted-foreground" /><span>{link.label}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Для бизнеса — collapsible */}
                    <div className="pt-1">
                      <button onClick={() => setExpandedSection(expandedSection === "biz" ? null : "biz")} className="w-full flex items-center justify-between px-2 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold hover:text-foreground">
                        <span>Для бизнеса</span>
                        <ChevronDown className={`h-3 w-3 transition-transform ${expandedSection === "biz" ? "rotate-180" : ""}`} />
                      </button>
                      {expandedSection === "biz" && (
                        <div className="space-y-0.5 px-1 pb-2">
                          {NAV_BUSINESS.map((link) => (
                            <button key={link.view} onClick={() => { navigate(link.view); setMobileMenuOpen(false); }} className="w-full flex items-center gap-2 px-2 py-2 text-sm hover:bg-accent rounded-md">
                              <link.icon className="h-4 w-4 text-muted-foreground" /><div><div>{link.label}</div><div className="text-[10px] text-muted-foreground">{link.desc}</div></div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Информация — collapsible */}
                    <div className="pt-1">
                      <button onClick={() => setExpandedSection(expandedSection === "info" ? null : "info")} className="w-full flex items-center justify-between px-2 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold hover:text-foreground">
                        <span>Информация</span>
                        <ChevronDown className={`h-3 w-3 transition-transform ${expandedSection === "info" ? "rotate-180" : ""}`} />
                      </button>
                      {expandedSection === "info" && (
                        <div className="space-y-0.5 px-1 pb-2">
                          {NAV_INFO.map((link) => (
                            <button key={link.view} onClick={() => { navigate(link.view); setMobileMenuOpen(false); }} className="w-full flex items-center gap-2 px-2 py-2 text-sm hover:bg-accent rounded-md">
                              <link.icon className="h-4 w-4 text-muted-foreground" /><span>{link.label}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Auth */}
                    {!isAuthenticated && (
                      <div className="pt-3 mt-2 border-t space-y-2">
                        <Button className="w-full" onClick={() => { setMobileMenuOpen(false); setAuthModalOpen(true); }}>Войти / Регистрация</Button>
                      </div>
                    )}
                  </div>
                </SheetContent>
              </Sheet>
            </div>
          </div>
        </div>

        {/* ===== ВТОРАЯ СТРОКА — навигационное под-меню (десктоп) ===== */}
        <div className="hidden lg:block border-t border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
          <div className="container mx-auto px-4">
            <nav className="flex items-center gap-0.5 h-11 overflow-x-auto">
              {/* Каталог — мега-меню */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className={`relative px-3 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center gap-0.5 whitespace-nowrap ${isActive("catalog") || isActive("product") ? "text-primary bg-primary/10" : "text-foreground/80 hover:text-primary hover:bg-accent/50"}`}>
                    <Cake className="h-4 w-4" />Каталог<ChevronDown className="h-3.5 w-3.5" />
                    {(isActive("catalog") || isActive("product")) && <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 w-6 bg-primary rounded-full" />}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-[640px] p-0">
                  <div className="grid grid-cols-3 gap-0">
                    <div className="p-3 border-r">
                      <div className="flex items-center gap-1.5 mb-2 px-2"><span>{CATEGORY_GROUPS[0].icon}</span><span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{CATEGORY_GROUPS[0].name}</span></div>
                      <div className="space-y-0.5">
                        {confectioneryCats.slice(0, 10).map((cat) => (
                          <button key={cat.slug} onClick={() => navigate("catalog", { category: cat.slug })} className="w-full flex items-center gap-2 text-xs px-2 py-1.5 hover:bg-accent rounded-md text-left group">
                            <span className="text-base">{cat.icon}</span><span className="flex-1 group-hover:text-primary">{cat.name}</span>
                            {cat.count > 0 && <span className="text-[10px] text-muted-foreground">{cat.count}</span>}
                          </button>
                        ))}
                        <button onClick={() => navigate("catalog")} className="w-full flex items-center gap-1 text-xs px-2 py-1.5 hover:bg-accent rounded-md text-primary font-medium">Все категории <ChevronRight className="h-3 w-3" /></button>
                      </div>
                    </div>
                    <div className="p-3 border-r">
                      <div className="flex items-center gap-1.5 mb-2 px-2"><span>{CATEGORY_GROUPS[1].icon}</span><span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{CATEGORY_GROUPS[1].name}</span></div>
                      <div className="space-y-0.5">
                        {supplyCats.map((cat) => {
                          const link = (cat as { link?: string }).link;
                          return (
                            <button key={cat.slug} onClick={() => link ? navigate(link as never) : navigate("catalog", { category: cat.slug })} className="w-full flex items-center gap-2 text-xs px-2 py-1.5 hover:bg-accent rounded-md text-left group">
                              <span className="text-base">{cat.icon}</span><span className="flex-1 group-hover:text-primary">{cat.name}</span>
                              <ChevronRight className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100" />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="p-3 bg-accent/30">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 px-1">Популярное</div>
                      <div className="space-y-2">
                        <button onClick={() => navigate("cake-builder")} className="w-full text-left p-2 rounded-lg bg-gradient-to-br from-primary/10 to-accent/40 hover:shadow-md transition group">
                          <div className="flex items-center gap-2 mb-1"><Cake className="h-4 w-4 text-primary" /><span className="text-sm font-semibold">Конструктор торта</span></div>
                          <div className="text-[10px] text-muted-foreground">Соберите свой торт за 8 шагов</div>
                        </button>
                        <button onClick={() => navigate("ready-made")} className="w-full text-left p-2 rounded-lg bg-card hover:shadow-md transition group border border-border/50">
                          <div className="flex items-center gap-2 mb-1"><Zap className="h-4 w-4 text-amber-500" /><span className="text-sm font-semibold">Готовые изделия</span></div>
                          <div className="text-[10px] text-muted-foreground">В наличии, быстрая доставка</div>
                        </button>
                        <button onClick={() => navigate("promotions")} className="w-full text-left p-2 rounded-lg bg-card hover:shadow-md transition group border border-border/50">
                          <div className="flex items-center gap-2 mb-1"><Flame className="h-4 w-4 text-rose-500" /><span className="text-sm font-semibold">Акции и скидки</span></div>
                          <div className="text-[10px] text-muted-foreground">Выгодные предложения</div>
                        </button>
                      </div>
                    </div>
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Кондитеры */}
              <button onClick={() => navigate("confectioners")} className={`relative px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap flex items-center gap-1.5 ${isActive("confectioners") || isActive("confectioner-profile") ? "text-primary bg-primary/10" : "text-foreground/80 hover:text-primary hover:bg-accent/50"}`}>
                <Users className="h-4 w-4" />Кондитеры
                {(isActive("confectioners") || isActive("confectioner-profile")) && <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 w-6 bg-primary rounded-full" />}
              </button>

              {/* Акции */}
              <button onClick={() => navigate("promotions")} className={`relative px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap flex items-center gap-1.5 ${isActive("promotions") ? "text-primary bg-primary/10" : "text-foreground/80 hover:text-primary hover:bg-accent/50"}`}>
                <Flame className="h-4 w-4" />Акции
                {isActive("promotions") && <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 w-6 bg-primary rounded-full" />}
              </button>

              {/* Рецепты */}
              <button onClick={() => navigate("recipes")} className={`relative px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap flex items-center gap-1.5 ${isActive("recipes") || isActive("recipe-detail") ? "text-primary bg-primary/10" : "text-foreground/80 hover:text-primary hover:bg-accent/50"}`}>
                <BookOpen className="h-4 w-4" />Рецепты
                {(isActive("recipes") || isActive("recipe-detail")) && <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 w-6 bg-primary rounded-full" />}
              </button>

              <div className="h-5 w-px bg-border mx-1" />

              {/* B2B и услуги — выпадающее меню */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center gap-0.5 whitespace-nowrap ${isB2BActive ? "text-primary bg-primary/10" : "text-foreground/80 hover:text-primary hover:bg-accent/50"}`}>
                    <Building2 className="h-4 w-4" />B2B и услуги<ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-80 p-0">
                  <div className="p-2">
                    {NAV_B2B.map((link) => (
                      <button key={link.view} onClick={() => navigate(link.view)} className="w-full flex items-start gap-3 p-2 rounded-md hover:bg-accent text-left group">
                        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition"><link.icon className="h-4 w-4 text-primary" /></div>
                        <div className="flex-1 min-w-0"><div className="text-sm font-medium group-hover:text-primary">{link.label}</div><div className="text-[11px] text-muted-foreground line-clamp-1">{link.desc}</div></div>
                      </button>
                    ))}
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Для бизнеса — выпадающее меню */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center gap-0.5 whitespace-nowrap ${isBusinessActive ? "text-primary bg-primary/10" : "text-foreground/80 hover:text-primary hover:bg-accent/50"}`}>
                    <ChefHat className="h-4 w-4" />Для бизнеса<ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-72 p-0">
                  <div className="p-2">
                    {NAV_BUSINESS.map((link) => (
                      <button key={link.view} onClick={() => navigate(link.view)} className="w-full flex items-start gap-3 p-2 rounded-md hover:bg-accent text-left group">
                        <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0 group-hover:bg-emerald-500/20 transition"><link.icon className="h-4 w-4 text-emerald-600" /></div>
                        <div className="flex-1 min-w-0"><div className="text-sm font-medium group-hover:text-primary">{link.label}</div><div className="text-[11px] text-muted-foreground line-clamp-1">{link.desc}</div></div>
                      </button>
                    ))}
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Ещё — информационные страницы */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center gap-0.5 whitespace-nowrap ${isInfoActive ? "text-primary bg-primary/10" : "text-foreground/80 hover:text-primary hover:bg-accent/50"}`}>
                    Ещё<ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-72 p-0">
                  <div className="p-2">
                    {NAV_INFO.map((link) => (
                      <button key={link.view} onClick={() => navigate(link.view)} className="w-full flex items-start gap-3 p-2 rounded-md hover:bg-accent text-left group">
                        <link.icon className="h-4 w-4 text-muted-foreground group-hover:text-primary mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0"><div className="text-sm font-medium group-hover:text-primary">{link.label}</div><div className="text-[11px] text-muted-foreground line-clamp-1">{link.desc}</div></div>
                      </button>
                    ))}
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Быстрые ссылки справа */}
              <div className="ml-auto flex items-center gap-1">
                <button onClick={() => navigate("ready-made")} className="px-3 py-1.5 text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1 whitespace-nowrap">
                  <Zap className="h-3.5 w-3.5" />Готовые
                </button>
                <button onClick={() => navigate("gift-certificates")} className="px-3 py-1.5 text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1 whitespace-nowrap">
                  <Gift className="h-3.5 w-3.5" />Сертификаты
                </button>
                <button onClick={() => navigate("contacts")} className="px-3 py-1.5 text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1 whitespace-nowrap">
                  <Phone className="h-3.5 w-3.5" />Контакты
                </button>
              </div>
            </nav>
          </div>
        </div>
      </header>

      {/* Мобильный поиск — полноэкранный оверлей */}
      {mobileSearchOpen && (
        <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur md:hidden">
          <div className="container mx-auto px-4 pt-4">
            <div className="flex items-center gap-2 mb-4">
              <form onSubmit={handleSearch} className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input type="text" placeholder="Поиск тортов, капкейков, кондитеров..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10 h-12" autoFocus />
              </form>
              <Button variant="ghost" size="icon" onClick={() => setMobileSearchOpen(false)} className="h-12 w-12"><X className="h-5 w-5" /></Button>
            </div>
            <div className="text-xs text-muted-foreground mb-2">Популярные запросы:</div>
            <div className="flex flex-wrap gap-2">
              {["Торт на день рождения", "Красный бархат", "Капкейки", "Чизкейк", "Макаронс", "Веганский торт"].map((q) => (
                <button key={q} onClick={() => { navigate("catalog", { q }); setMobileSearchOpen(false); }} className="px-3 py-1.5 text-sm rounded-full border border-border bg-card hover:border-primary/40">{q}</button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
