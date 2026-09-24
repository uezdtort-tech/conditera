"use client";

/**
 * MarketplaceCtaCard — универсальная карточка-«зазывалка» для разделов маркетплейса.
 *
 * Приглашает продавцов (кондитеров, поставщиков, декораторов, организаторов услуг,
 * владельцев площадок) присоединиться к платформе и разместить своё предложение.
 *
 * Используется в: decor-shop-page, services-shop-page, supplier-shop-page,
 * ReadyMadePage (extra-pages). Паттерн: gradient Card (recipes-page.tsx) с
 * опциональными статами (home-page.tsx:848).
 */

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAppStore } from "@/lib/store";
import { Sparkles, type LucideIcon } from "lucide-react";

export interface MarketplaceCtaCardProps {
  /** Бейдж-аудитория, например «Для поставщиков декора» */
  badge: string;
  /** Заголовок-призыв, например «Вы производите декор и упаковку?» */
  title: string;
  /** Описание предложения */
  description: string;
  /** Текст основной кнопки (открывает модалку регистрации) */
  primaryLabel?: string;
  /** Текст вторичной кнопки — переход на лендинг (navigate target) */
  secondaryLabel?: string;
  /** View для navigate вторичной кнопки, например "for-suppliers" */
  secondaryView?: string;
  /** Иконка (lucide), по умолчанию Sparkles */
  icon?: LucideIcon;
  /** Градиентные классы карточки, по умолчанию amber/accent */
  className?: string;
  /** Компактный режим (без крупного заголовка) */
  compact?: boolean;
  /** До 6 статов { val, label } — как на главной */
  stats?: { val: string; label: string }[];
}

export function MarketplaceCtaCard({
  badge,
  title,
  description,
  primaryLabel = "Разместить предложение",
  secondaryLabel = "Условия и тарифы",
  secondaryView = "for-suppliers",
  icon: Icon = Sparkles,
  className = "from-amber-50 via-accent/30 to-amber-100 border-amber-200",
  compact = false,
  stats,
}: MarketplaceCtaCardProps) {
  const navigate = useAppStore((s) => s.navigate);
  const setAuthModalOpen = useAppStore((s) => s.setAuthModalOpen);

  return (
    <Card
      className={`mt-8 overflow-hidden border bg-gradient-to-br ${className}`}
      data-testid="marketplace-cta-card"
    >
      <div className={`p-6 ${compact ? "" : "lg:p-8"} grid ${stats?.length ? "lg:grid-cols-2" : ""} gap-6 items-center`}>
        <div className="space-y-3">
          <Badge className="bg-primary text-primary-foreground">
            <Icon className="h-3 w-3 mr-1" />
            {badge}
          </Badge>
          <h3 className={`font-display font-bold ${compact ? "text-lg" : "text-xl lg:text-2xl"}`}>
            {title}
          </h3>
          <p className="text-sm text-muted-foreground max-w-xl">{description}</p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size={compact ? "sm" : "default"} onClick={() => setAuthModalOpen(true)}>
              {primaryLabel}
            </Button>
            {secondaryLabel && (
              <Button
                size={compact ? "sm" : "default"}
                variant="outline"
                onClick={() => navigate(secondaryView as never)}
              >
                {secondaryLabel}
              </Button>
            )}
          </div>
        </div>
        {stats && stats.length > 0 && (
          <div className="grid grid-cols-3 gap-3 text-center">
            {stats.map((s, i) => (
              <div
                key={i}
                className="bg-background/80 backdrop-blur rounded-xl p-3 border border-border"
              >
                <div className="font-display text-xl font-bold text-primary">{s.val}</div>
                <div className="text-[11px] text-muted-foreground">{s.label}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
