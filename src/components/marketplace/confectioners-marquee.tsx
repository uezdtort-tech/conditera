"use client";

import * as React from "react";
import { useAppStore } from "@/lib/store";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Star, ShieldCheck, ArrowRight, MapPin } from "lucide-react";
import type { Confectioner } from "@/lib/types";
import { TRUST_LEVELS } from "@/lib/finance";
import { useConfectioners, type ConfectionerPublic } from "@/lib/supabase/use-marketplace";

/**
 * Бегущая строка реальных зарегистрированных кондитеров.
 *
 * Источник данных:
 *   1. Сначала идём в Supabase через useConfectioners() (GET /api/confectioners).
 *      Если в БД есть верифицированные кондитеры — показываем их.
 *   2. Если запрос ещё в процессе / упал / вернул 0 строк — fallback на
 *      store.confectioners (которые изначально = MOCK_CONFECTIONERS).
 *      Это гарантирует что UI всегда отрисован, даже без БД.
 *
 * Каждый элемент — кликабельная ссылка на профиль кондитера:
 *   navigate("confectioner-profile", { id })
 *
 * Пауза при наведении мыши. Бесшовная прокрутка за счёт дубля списка.
 */

interface MarqueeItemProps {
  confectioner: Confectioner;
}

function MarqueeItem({ confectioner }: MarqueeItemProps) {
  const navigate = useAppStore((s) => s.navigate);
  const trust = TRUST_LEVELS[confectioner.trustLevel];
  const workImage = confectioner.portfolioImages?.[0];

  const handleClick = () => {
    navigate("confectioner-profile", { id: confectioner.id });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="group relative shrink-0 w-[300px] sm:w-[340px] text-left"
      aria-label={`Профиль кондитера: ${confectioner.businessName}`}
    >
      <div className="flex gap-3 items-center p-3 rounded-2xl border border-border bg-card/80 backdrop-blur-sm transition-all hover:border-primary/40 hover:shadow-md hover:bg-card">
        {/* Аватар */}
        <div className="relative shrink-0">
          <Avatar className="h-12 w-12 border border-border">
            <AvatarImage
              src={confectioner.avatar}
              alt={confectioner.businessName}
            />
            <AvatarFallback className="bg-primary/10 text-primary text-xs">
              {confectioner.businessName.slice(0, 2)}
            </AvatarFallback>
          </Avatar>
          {confectioner.verified && (
            <span className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-emerald-500 text-white flex items-center justify-center border-2 border-card">
              <ShieldCheck className="h-3 w-3" />
            </span>
          )}
        </div>

        {/* Имя + специализация */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <h4 className="font-medium text-sm truncate group-hover:text-primary transition-colors">
              {confectioner.businessName}
            </h4>
          </div>
          <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-muted-foreground">
            <MapPin className="h-2.5 w-2.5 shrink-0" />
            <span className="truncate">{confectioner.city}</span>
            <span className="text-muted-foreground/40">•</span>
            <span className="truncate">{confectioner.specialization?.[0]}</span>
          </div>
          <div className="flex items-center justify-between mt-1">
            <div className="flex items-center gap-0.5 text-[11px]">
              <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />
              <span className="font-semibold">{confectioner.rating.toFixed(1)}</span>
              <span className="text-muted-foreground">({confectioner.reviewsCount})</span>
            </div>
            <Badge
              variant="outline"
              className={`text-[9px] px-1 py-0 ${trust.color}`}
            >
              {trust.label}
            </Badge>
          </div>
        </div>

        {/* Миниатюра работы */}
        {workImage && (
          <div className="relative shrink-0 h-12 w-12 rounded-lg overflow-hidden border border-border bg-muted">
            <img
              src={workImage}
              alt={`Работа: ${confectioner.businessName}`}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        )}
      </div>
    </button>
  );
}

/** Конвертация: ConfectionerPublic (из БД) → Confectioner (store type). */
function toConfectioner(c: ConfectionerPublic): Confectioner {
  return {
    id: c.id,
    userId: c.userId,
    businessName: c.businessName,
    slug: c.slug,
    description: c.description,
    avatar: c.avatar,
    cover: c.cover || undefined,
    location:
      (c.location as Confectioner["location"]) || {
        country: "Россия",
        region: "",
        city: c.city,
        district: "",
        street: "",
        house: "",
        apartment: "",
        postalCode: "",
        lat: 0,
        lng: 0,
      },
    city: c.city,
    rating: c.rating,
    reviewsCount: c.reviewsCount,
    ordersCount: c.ordersCount,
    verified: c.verified,
    trustLevel: (c.trustLevel as Confectioner["trustLevel"]) || "NEW",
    tariff: (c.tariff as Confectioner["tariff"]) || "START",
    legalInfo: {
      status: "NPD",
      npdRegisteredAt: c.joinedAt,
      documentsVerified: c.verified,
      verifiedAt: c.verified ? c.joinedAt : undefined,
    },
    taxMode: "NPD",
    specialization: c.specialization || [],
    portfolioImages: c.portfolioImages || [],
    followersCount: c.followersCount,
    responseTime: c.responseTime,
    joinedAt: c.joinedAt,
    selfPickup: c.selfPickup,
    deliveryOptions: (c.deliveryOptions as Confectioner["deliveryOptions"]) || ["own"],
  };
}

export function ConfectionersMarquee() {
  const storeConfectioners = useAppStore((s) => s.confectioners);
  const navigate = useAppStore((s) => s.navigate);
  const setConfectioners = useAppStore((s) => s.setConfectioners);

  // Живой запрос в Supabase. Если упал / пусто — fallback на store.
  const { data: liveData, isSuccess, isError } = useConfectioners({
    sort: "rating",
    limit: 30,
  });

  // Если получили реальные данные — синхронизируем store (чтобы ConfectionerProfilePage
  // и ConfectionersPage тоже видели живые данные, а не mock).
  React.useEffect(() => {
    if (isSuccess && liveData && liveData.length > 0) {
      const mapped = liveData.map(toConfectioner);
      // Пушим в store только если данные реально отличаются (избегаем лишних ререндеров).
      const storeIds = storeConfectioners.map((c) => c.id).join(",");
      const liveIds = mapped.map((c) => c.id).join(",");
      if (storeIds !== liveIds) {
        setConfectioners(mapped);
      }
    }
  }, [liveData, isSuccess, storeConfectioners, setConfectioners]);

  // Источник: живые данные если они есть, иначе store (mock).
  const confectioners =
    liveData && liveData.length > 0
      ? liveData.map(toConfectioner)
      : storeConfectioners;

  // Показываем только verified — это гарантирует что в строке только реальные
  // зарегистрированные и проверенные кондитеры.
  const verifiedConfectioners = confectioners.filter((c) => c.verified);

  if (verifiedConfectioners.length === 0) return null;

  // Дублируем список для бесшовной прокрутки (анимация translateX(-50%))
  const marqueeItems = [...verifiedConfectioners, ...verifiedConfectioners];

  // Длительность анимации зависит от количества элементов (~12 сек на карточку)
  const duration = `${Math.max(40, verifiedConfectioners.length * 12)}s`;

  // Индикатор источника данных (для разработчиков / аудита)
  const sourceLabel = isError
    ? "mock (БД недоступна)"
    : liveData && liveData.length > 0
    ? "Supabase (live)"
    : "mock (пусто в БД)";

  return (
    <section className="container mx-auto px-4">
      <div className="marquee-group relative overflow-hidden py-2">
        {/* Заголовок */}
        <div className="flex items-center justify-between mb-3 px-1">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75 animate-ping" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Сейчас на платформе — реальные кондитеры
            </h2>
            <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-700">
              {verifiedConfectioners.length} проверены
            </Badge>
            {/* dev-only badge: источник данных. Скрыт в production по значению env. */}
            {process.env.NODE_ENV !== "production" && (
              <Badge variant="outline" className="text-[9px] text-muted-foreground/60">
                src: {sourceLabel}
              </Badge>
            )}
          </div>
          <button
            type="button"
            onClick={() => navigate("confectioners")}
            className="text-xs text-primary hover:underline hidden sm:flex items-center gap-1"
          >
            Все кондитеры
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>

        {/* Бегущая строка с маской по краям */}
        <div className="marquee-mask">
          <div
            className="flex gap-3 animate-marquee"
            style={{ "--marquee-duration": duration } as React.CSSProperties}
          >
            {marqueeItems.map((conf, idx) => (
              <MarqueeItem
                key={`${conf.id}-${idx}`}
                confectioner={conf}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
