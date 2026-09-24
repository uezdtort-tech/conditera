"use client";

/**
 * _shared.tsx — общие компоненты для всех дашбордов (v2.0, strict typed).
 *
 * Содержит:
 *   - DashboardShell — общий layout (header + tabs + content)
 *   - StatCard — карточка статистики (горизонтальная)
 *   - EmptyState — пустое состояние с иконкой и CTA
 *   - SidebarTab — кнопка таба в sidebar layout
 *   - SidebarStat — карточка статистики (для sidebar layout)
 *   - DashboardSidebarLayout — sidebar layout (слева навигация, справа контент)
 *   - LoadingState — skeleton для TanStack Query loading
 *   - ErrorState — error card для TanStack Query errors
 */

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { LucideIcon } from "lucide-react";
import { LogOut, ChevronLeft } from "lucide-react";

// ==================== Types ====================
export interface UserLike {
  name: string;
  email: string;
  avatar?: string;
  roles?: string[];
}

export interface TabItem {
  id: string;
  label: string;
  icon: LucideIcon;
  badge?: string;
}

export interface NavigateFn {
  (view: string): void;
}

// ==================== DashboardShell (для таб-стиля) ====================
export function DashboardShell({
  user,
  logout,
  title,
  role,
  icon: Icon,
  gradient,
  tabs,
  activeTab,
  onTab,
  children,
}: {
  user: UserLike;
  logout: () => void;
  title: string;
  role: string;
  icon: LucideIcon;
  gradient: string;
  tabs: TabItem[];
  activeTab: string;
  onTab: (t: string) => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      {/* Шапка */}
      <Card className="p-5 mb-6 flex flex-col md:flex-row gap-4 items-start md:items-center border-border/60">
        <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${gradient} flex items-center justify-center text-white shadow-lg`}>
          <Icon className="w-8 h-8" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{title}</h1>
          <div className="text-sm text-muted-foreground mt-1 flex flex-wrap gap-3">
            <span>{user.name}</span>
            <span>•</span>
            <span>{user.email}</span>
            <Badge variant="outline">{role}</Badge>
          </div>
        </div>
        <Button variant="outline" onClick={logout}>
          <LogOut className="w-4 h-4 mr-2" />Выйти
        </Button>
      </Card>

      {/* Табы */}
      <div className="flex flex-wrap gap-1 mb-6 p-1 bg-card rounded-xl border border-border/60">
        {tabs.map((t) => {
          const TabIcon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => onTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition ${
                activeTab === t.id ? "bg-primary text-primary-foreground" : "hover:bg-accent"
              }`}
            >
              <TabIcon className="w-4 h-4" />
              <span className="hidden sm:inline">{t.label}</span>
              {t.badge && (
                <Badge variant="secondary" className="text-[10px] ml-1">
                  {t.badge}
                </Badge>
              )}
            </button>
          );
        })}
      </div>

      {children}
    </div>
  );
}

// ==================== StatCard (горизонтальная) ====================
export function StatCard({
  icon: Icon,
  label,
  value,
  change,
  color,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  change?: string;
  color: string;
}): React.JSX.Element {
  return (
    <Card className="p-4 border-border/60">
      <div className="flex items-center justify-between mb-1">
        <Icon className={`w-5 h-5 ${color}`} />
        {change && (
          <Badge variant="secondary" className="text-[10px] bg-emerald-100 text-emerald-700">
            {change}
          </Badge>
        )}
      </div>
      <div className="text-xl font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </Card>
  );
}

// ==================== EmptyState ====================
export function EmptyState({
  icon: Icon,
  title,
  text,
  action,
  onAction,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
  action?: string;
  onAction?: () => void;
}): React.JSX.Element {
  return (
    <Card className="p-12 text-center border-border/60">
      <Icon className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
      <h3 className="font-semibold mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground mb-4">{text}</p>
      {action && (
        <Button size="sm" onClick={onAction}>
          {action}
        </Button>
      )}
    </Card>
  );
}

// ==================== SidebarTab (кнопка таба в sidebar) ====================
export function SidebarTab({
  icon: Icon,
  label,
  active,
  badge,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  badge?: string;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
        active ? "bg-primary/10 text-primary font-medium" : "hover:bg-accent text-foreground/80"
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="flex-1 text-left">{label}</span>
      {badge && <Badge variant="secondary" className="text-[10px]">{badge}</Badge>}
    </button>
  );
}

// ==================== SidebarStat (вертикальная) ====================
export function SidebarStat({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  color: string;
}): React.JSX.Element {
  return (
    <Card className="p-4">
      <div className={`h-9 w-9 rounded-lg flex items-center justify-center mb-2 ${color}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="font-display font-bold text-lg">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </Card>
  );
}

// ==================== DashboardSidebarLayout ====================
export function DashboardSidebarLayout({
  user,
  logout,
  role,
  avatar,
  businessName,
  navigate,
  tabs,
  activeTab,
  onTab,
  children,
}: {
  user: UserLike;
  logout: () => void;
  role: string;
  avatar?: string;
  businessName?: string;
  navigate: NavigateFn;
  tabs: TabItem[];
  activeTab: string;
  onTab: (t: string) => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="min-h-screen bg-muted/30">
      <div className="container mx-auto px-4 py-6">
        <button
          onClick={() => navigate("home")}
          className="text-sm text-muted-foreground hover:text-primary flex items-center gap-1 mb-4"
        >
          <ChevronLeft className="h-4 w-4" /> На главную
        </button>

        <div className="grid lg:grid-cols-[260px_1fr] gap-4 lg:gap-6">
          {/* Sidebar */}
          <aside>
            <Card className="p-3 lg:p-4 lg:sticky lg:top-20 lg:self-start">
              <div className="flex items-center gap-3 mb-3 lg:mb-4">
                <Avatar className="h-10 w-10 lg:h-12 lg:w-12 shrink-0">
                  {avatar && <AvatarImage src={avatar} alt={businessName || user.name} />}
                  <AvatarFallback>{(businessName || user.name).slice(0, 2)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <div className="font-semibold truncate">{businessName || user.name}</div>
                  <div className="text-xs text-muted-foreground">{role}</div>
                </div>
              </div>
              <div className="space-y-1">
                {tabs.map((t) => (
                  <SidebarTab
                    key={t.id}
                    icon={t.icon}
                    label={t.label}
                    badge={t.badge}
                    active={activeTab === t.id}
                    onClick={() => onTab(t.id)}
                  />
                ))}
              </div>
              <div className="pt-4 mt-4 border-t">
                <Button variant="ghost" size="sm" onClick={logout} className="w-full justify-start text-destructive">
                  <LogOut className="h-4 w-4 mr-2" /> Выйти
                </Button>
              </div>
            </Card>
          </aside>

          {/* Content */}
          <div>{children}</div>
        </div>
      </div>
    </div>
  );
}

// ==================== LoadingState (для TanStack Query) ====================
export function LoadingState({ message = "Загрузка..." }: { message?: string }): React.JSX.Element {
  return (
    <div className="space-y-4">
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-64 bg-muted rounded" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-muted/50 rounded-lg" />
          ))}
        </div>
        <div className="h-48 bg-muted/50 rounded-lg" />
      </div>
      <p className="text-sm text-muted-foreground text-center">{message}</p>
    </div>
  );
}

// ==================== ErrorState (для TanStack Query) ====================
export function ErrorState({
  error,
  onRetry,
}: {
  error: Error;
  onRetry?: () => void;
}): React.JSX.Element {
  return (
    <Card className="p-8 text-center border-destructive/30 bg-destructive/5">
      <div className="text-destructive text-4xl mb-3">⚠</div>
      <h3 className="font-semibold text-destructive mb-2">Ошибка загрузки данных</h3>
      <p className="text-sm text-muted-foreground mb-4">
        {error.message || "Не удалось получить данные с сервера"}
      </p>
      {onRetry && (
        <Button onClick={onRetry} variant="outline">
          Повторить
        </Button>
      )}
    </Card>
  );
}
