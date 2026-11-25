"use client";

import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { StoriesFeed } from "@/components/stories/stories-feed";
import { AICakeFinderButton } from "@/components/ai-cake-finder/ai-cake-finder";
import { AiSmartSearch } from "@/components/ai/ai-smart-search";
import { HelpChooseDialog } from "@/components/marketplace/help-choose-dialog";
import { ForYouBlock } from "@/components/marketplace/for-you-block";
import type { HelpChooseAnswers } from "@/lib/product-search";
import { VideoFeed } from "@/components/video-feed/video-feed";
import { HolidayCalendar } from "@/components/holidays/holiday-calendar";
import { ProductCard } from "@/components/marketplace/product-card";
import { ConfectionerCard } from "@/components/marketplace/confectioner-card";
import { ConfectionersMarquee } from "@/components/marketplace/confectioners-marquee";
import { RecentlyViewed } from "@/components/ui/enhanced-components";
import { AnimatedCounter, GlassCard, FloatWrapper, GradientBorderCard } from "@/components/ui/modern-effects";
import { Skeleton } from "@/components/ui/skeleton";
import { CATEGORIES } from "@/lib/mock-data";
import { useLiveProducts } from "@/lib/supabase/use-marketplace";
import { isDemoVitrineMode, selectVitrineProducts } from "@/lib/vitrine-products";
import { formatCurrency } from "@/lib/finance";
import Image from "next/image";
import { OrnamentDivider } from "@/components/ui/ornaments";
import {
  Cake,
  Sparkles,
  Search,
  ShieldCheck,
  Truck,
  CreditCard,
  Award,
  Heart,
  MessageCircle,
  ArrowRight,
  Star,
  Users,
  Store,
  TrendingUp,
  Clock,
  Check,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { motion } from "framer-motion";
import { Fragment, useState, useEffect, useMemo } from "react";
import { useConfectioners } from "@/lib/supabase/use-marketplace";
import {
  usePublishedHomeCms,
  isExternalCmsHref,
  cmsInternalView,
} from "@/hooks/use-published-cms";
import { usePublishedHomeBlocks } from "@/hooks/use-published-home-blocks";
import type { PublishedHomeBlock } from "@/hooks/use-published-home-blocks";
import type { ViewKey } from "@/lib/types";

type PublicCmsHomeBlock = {
  id: string;
  section: string;
  title: string;
  subtitle: string;
  content: string;
  image_url: string | null;
  link_url: string | null;
  link_text: string;
  sort_order: number;
};

type PublicCmsHomeSection = {
  section: string;
  title: string;
  sort_order: number;
  is_enabled: boolean;
};

const DEFAULT_CMS_HOME_SECTIONS: PublicCmsHomeSection[] = [
  { section: "hero", title: "От редакции", sort_order: 10, is_enabled: true },
  { section: "advantages", title: "Наши преимущества", sort_order: 20, is_enabled: true },
  { section: "steps", title: "Как это работает", sort_order: 30, is_enabled: true },
  { section: "stats", title: "О платформе", sort_order: 40, is_enabled: true },
  { section: "testimonials", title: "Истории клиентов", sort_order: 50, is_enabled: true },
  { section: "cta_confectioner", title: "Для кондитеров", sort_order: 60, is_enabled: true },
];

function useCmsHomepageSections() {
  const [sections, setSections] = useState<PublicCmsHomeSection[]>(DEFAULT_CMS_HOME_SECTIONS);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/cms/sections?public=true", { signal: controller.signal, cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("CMS sections unavailable")))
      .then((payload: { sections?: PublicCmsHomeSection[] }) => {
        if (!controller.signal.aborted && Array.isArray(payload.sections) && payload.sections.length === DEFAULT_CMS_HOME_SECTIONS.length) setSections(payload.sections);
      })
      .catch(() => { /* Keep safe built-in defaults while CMS is unavailable. */ });
    return () => controller.abort();
  }, []);
  return sections;
}

function useCmsHomepageBlocks() {
  const [blocks, setBlocks] = useState<PublicCmsHomeBlock[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/cms/home-blocks?public=true", { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("CMS blocks unavailable")))
      .then((payload: { blocks?: PublicCmsHomeBlock[] }) => {
        if (!controller.signal.aborted) setBlocks(Array.isArray(payload.blocks) ? payload.blocks : []);
      })
      .catch(() => { if (!controller.signal.aborted) setBlocks([]); });
    return () => controller.abort();
  }, []);
  return blocks;
}

function CmsHomepageSectionBlocks({ section, title, blocks }: {
  section: string;
  title: string;
  blocks: PublicCmsHomeBlock[];
}) {
  const items = blocks
    .filter((block) => block.section === section)
    .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
  if (items.length === 0) return null;
  return (
    <section className="container mx-auto px-4">
      <div className="mb-6 text-center"><h2 className="font-display text-2xl font-bold sm:text-3xl">{title}</h2></div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((block) => (
          <Card key={block.id} className="overflow-hidden p-0">
            {block.image_url && <img src={block.image_url} alt={block.title} className="aspect-[16/9] w-full object-cover" loading="lazy" />}
            <div className="space-y-2 p-5">
              {block.title && <h3 className="text-lg font-semibold">{block.title}</h3>}
              {block.subtitle && <p className="text-sm text-muted-foreground">{block.subtitle}</p>}
              {block.content && <p className="whitespace-pre-wrap text-sm leading-relaxed">{block.content}</p>}
              {block.link_url && block.link_text && <a href={block.link_url} className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline">{block.link_text}<ArrowRight className="h-4 w-4" /></a>}
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}

/** Публичные отзывы из БД (GET /api/reviews) — витрина «Отзывы покупателей». */
interface ApiReview {
  id: string;
  rating: number;
  text: string;
  pros?: string;
  cons?: string;
  helpfulCount: number;
  createdAt: string;
  author: { name: string; avatarUrl?: string };
  product?: { title: string; slug: string };
}

function useRealReviews(limit = 6) {
  const [reviews, setReviews] = useState<ApiReview[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/reviews?limit=${limit}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { reviews?: ApiReview[] }) => {
        if (alive) setReviews(j.reviews || []);
      })
      .catch(() => {
        if (alive) setReviews([]);
      });
    return () => {
      alive = false;
    };
  }, [limit]);
  return reviews;
}

/** next/image оптимизирует только домены из images.remotePatterns (+ локальные /path);
 *  произвольные URL из CMS рендерим обычным <img>, чтобы next/image не падал. */
function isOptimizableImage(src: string): boolean {
  return src.startsWith("/") || src.startsWith("https://images.unsplash.com/");
}

export function HomePage() {
  const navigate = useAppStore((s) => s.navigate);
  const setCakeBuilderOpen = useAppStore((s) => s.setCakeBuilderOpen);
  const storeProducts = useAppStore((s) => s.products);
  const confectioners = useAppStore((s) => s.confectioners);

  // ZV31-017: продуктовые секции главной рендерят только live-данные
  // /api/products. Mock-товары из store не показываются (demo-escape-hatch —
  // NEXT_PUBLIC_DEMO_MODE='1'); ошибка API — честная ошибка + «Повторить»,
  // пустой каталог — честное «Каталог пока пуст». Hero-фолбэк CMS не тронут.
  const demoMode = isDemoVitrineMode();
  const {
    data: liveProducts,
    isPending: livePending,
    isError: liveError,
    refetch: refetchLive,
  } = useLiveProducts();
  const products = useMemo(
    () =>
      selectVitrineProducts({
        demoMode,
        isError: liveError,
        live: liveProducts,
        storeProducts,
      }),
    [demoMode, liveError, liveProducts, storeProducts]
  );
  const isProductsLoading = livePending && products.length === 0;
  const hasProductsError = liveError && products.length === 0;
  const isCatalogEmpty = !livePending && !liveError && products.length === 0;

  // ZV31-001: опубликованный CMS-контент главной (публичный API:
  // /api/cms/settings + /api/cms/banners). Пока данных нет (загрузка/ошибка/
  // пусто в CMS) → hero null, banners [] → хардкод-фолбэк без изменений.
  const cms = usePublishedHomeCms();
  const cmsSections = useCmsHomepageSections();
  const cmsHomeBlocks = useCmsHomepageBlocks();
  const cmsSectionEnabled = (key: string) => cmsSections.find((section) => section.section === key)?.is_enabled ?? true;
  const cmsSectionTitle = (key: string, fallback: string) => cmsSections.find((section) => section.section === key)?.title || fallback;
  const cmsHero = cms.hero;
  // Z-brand: опубликованные CMS-блоки секций (cms_section_blocks). Пусто →
  // хардкод-фолбэк без изменений (advantages/steps/cta_confectioner).
  const cmsBlocksMap = usePublishedHomeBlocks();
  const cmsAdvantages: PublishedHomeBlock[] = cmsBlocksMap.advantages ?? [];
  const cmsSteps: PublishedHomeBlock[] = cmsBlocksMap.steps ?? [];
  const cmsCtaPanel: PublishedHomeBlock | undefined = cmsBlocksMap.cta_confectioner?.[0];
  const cmsCta =
    cmsHero && cmsHero.ctaLabel && cmsHero.ctaHref
      ? { label: cmsHero.ctaLabel, href: cmsHero.ctaHref }
      : null;

  // CMS-ссылки: внешние — в новой вкладке, внутренние — SPA-navigate по view-имени
  const openCmsHref = (href: string) => {
    if (isExternalCmsHref(href)) {
      window.open(href, "_blank", "noopener,noreferrer");
      return;
    }
    navigate(cmsInternalView(href) as ViewKey);
  };

  // Реальные данные платформы для честных счётчиков (не выдуманные цифры):
  // кондитеры — из публичного API, товары — hydrated store (live-источник).
  const { data: liveConfectioners, isSuccess: confectionersLoaded } = useConfectioners({ limit: 50 });
  const realReviews = useRealReviews(6);

  const verifiedCount = confectionersLoaded
    ? (liveConfectioners || []).filter((c) => c.verified).length
    : 0;
  const productCount = products.length;
  const avgRating =
    productCount > 0
      ? Number(
          (
            products.reduce((acc, p) => acc + (p.rating || 0), 0) / productCount
          ).toFixed(1)
        )
      : 0;
  const cityCount = confectionersLoaded
    ? new Set((liveConfectioners || []).map((c) => c.city).filter(Boolean)).size
    : 0;

  const popularProducts = products.filter((p) => p.isPopular || p.isHit).slice(0, 8);
  const newProducts = products.filter((p) => p.isNew).slice(0, 4);

  // Z-v20 (UX D4): счётчики категорий — из реального hydrated-стора,
  // а не из статического mock-значения CATEGORIES[].count
  const categoryCounts = useMemo(() => {
    const counts = {} as Record<string, number>;
    for (const cat of CATEGORIES) {
      counts[cat.slug] = products.filter((p) => p.category === cat.slug).length;
    }
    return counts;
  }, [products]);

  // P2.2: анкета «Помочь выбрать» на главной (ТЗ §5) — результат можно
  // перенести в каталог («Показать в каталоге»)
  const [helpOpen, setHelpOpen] = useState(false);
  const showHelpResultsInCatalog = (answers: HelpChooseAnswers) => {
    navigate("catalog", { help: JSON.stringify(answers) });
  };

  const cmsSectionNodes = {
    stats: (
      <section className="container mx-auto px-4">
        <div className="mb-5 text-center">
          <h2 className="font-display text-2xl font-bold sm:text-3xl">{cmsSectionTitle("stats", "О платформе")}</h2>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              { icon: Users, value: verifiedCount, label: "Проверенных кондитеров" },
              { icon: Store, value: productCount, label: "Товаров в каталоге" },
              { icon: Truck, value: cityCount, label: "Городов с кондитерами" },
              { icon: Star, value: avgRating, label: "Средний рейтинг товаров", isFloat: true },
            ].map((s, i) => {
              const Icon = s.icon;
              return (
                <div key={i} className="glass-pill rounded-2xl p-4 text-center">
                  <Icon className="h-4 w-4 mx-auto text-primary mb-1.5" aria-hidden="true" />
                  <div className="font-display text-2xl tnum">
                    {s.isFloat ? (
                      <span>{s.value > 0 ? `${s.value} / 5` : "—"}</span>
                    ) : (
                      <AnimatedCounter value={s.value} />
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
                </div>
              );
            })}
          </div>
      </section>
    ),
    advantages: (
      {/* ===== ADVANTAGES ===== */}
      <section className="relative overflow-hidden py-14">
        <div className="absolute inset-0 bg-secondary/40" aria-hidden="true" />
        <div className="absolute inset-0 grain-overlay" aria-hidden="true" />
        <div className="container mx-auto px-4 relative">
        <div className="text-center mb-12">
          <span className="small-caps inline-block text-xs font-semibold tracking-[0.2em] text-primary bg-primary/10 rounded-full px-4 py-1.5 mb-3">
            Экосистема платформы
          </span>
          <h2 className="font-display text-3xl sm:text-4xl">
             {cmsSectionTitle("advantages", "Почему выбирают нас")} 
          </h2>
          <p className="text-muted-foreground mt-3 max-w-2xl mx-auto">
            Уездный кондитер — это не просто маркетплейс. Это экосистема для
            домашних кондитеров и любителей сладкого по всей России.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {cmsAdvantages.length > 0
            ? cmsAdvantages.map((adv, i) => (
                <motion.div
                  key={adv.id}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                >
                  <div className="card-tint rounded-2xl p-6 h-full hover:shadow-[var(--shadow-lift)] transition-all duration-300 card-3d">
                    <div className="h-12 w-12 rounded-xl flex items-center justify-center mb-4 text-primary bg-primary/10 shadow-sm overflow-hidden">
                      {adv.image ? (
                        <img src={adv.image} alt="" className="h-12 w-12 object-cover" loading="lazy" decoding="async" />
                      ) : (
                        <Sparkles className="h-6 w-6" aria-hidden="true" />
                      )}
                    </div>
                    <h3 className="font-semibold text-lg mb-2">{adv.title ?? "Блок"}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{adv.subtitle ?? adv.text ?? ""}</p>
                    {adv.link && adv.linkText && (
                      <button
                        onClick={() => openCmsHref(adv.link!)}
                        className="text-primary text-sm font-medium mt-3 inline-flex items-center gap-1 hover:opacity-80 transition-opacity"
                      >
                        {adv.linkText} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </motion.div>
              ))
            : [
            {
              icon: ShieldCheck,
              title: "Эскроу-система расчётов",
              text: "Средства холдируются 24 часа после доставки. Если что-то не так — возвращаем деньги. Безопасно для обеих сторон.",
              color: "text-emerald-600 bg-emerald-100",
            },
            {
              icon: Award,
              title: "Верификация кондитеров",
              text: "Каждый кондитер проходит проверку документов. Системы доверия: NEW → TRUSTED → EXPERT → MASTER по результатам работы.",
              color: "text-primary bg-primary/10",
            },
            {
              icon: Cake,
              title: "Конструктор тортов",
              text: "8-шаговый конструктор: тип мероприятия, основа, начинка, покрытие, декор, диетические предпочтения, доставка и резюме.",
              color: "text-amber-600 bg-amber-100",
            },
            {
              icon: CreditCard,
              title: "Поддержка самозанятости",
              text: "Автоматический расчёт НПД: 4% с физлиц, 6% с юрлиц, вычет 10 000 ₽ при регистрации. Полная налоговая отчётность.",
              color: "text-orange-700 bg-orange-100",
            },
            {
              icon: MessageCircle,
              title: "Чат в реальном времени",
              text: "Прямые диалоги с кондитерами, чаты привязанные к заказам, поддержка. Все общение — в одной платформе.",
              color: "text-rose-600 bg-rose-100",
            },
            {
              icon: Users,
              title: "Социальный канал",
              text: "Каждый кондитер имеет свой канал: посты с работами, сторис, подписчики, комментарии. Стройте сообщество вокруг бренда.",
              color: "text-fuchsia-600 bg-fuchsia-100",
            },
          ].map((adv, i) => {
            const Icon = adv.icon;
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
              >
                <div className="card-tint rounded-2xl p-6 h-full hover:shadow-[var(--shadow-lift)] transition-all duration-300 card-3d">
                  <div
                    className={`h-12 w-12 rounded-xl flex items-center justify-center mb-4 ${adv.color} shadow-sm`}
                  >
                    <Icon className="h-6 w-6" aria-hidden="true" />
                  </div>
                  <h3 className="font-semibold text-lg mb-2">
                    {adv.title}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {adv.text}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </div>
        </div>
      </section>
    ),
    steps: (
      {/* ===== STEPS ===== */}
      <section className="relative overflow-hidden py-14">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/10" />
        <div className="container mx-auto px-4 relative">
        <div className="text-center mb-12">
          <span className="small-caps inline-block text-xs font-semibold tracking-[0.2em] text-primary bg-primary/10 rounded-full px-4 py-1.5 mb-3">
            Как это работает
          </span>
          <h2 className="font-display text-3xl sm:text-4xl">
             {cmsSectionTitle("steps", "Как сделать заказ")} 
          </h2>
          <p className="text-muted-foreground mt-3">
            Четыре простых шага от выбора до получения
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 steps-rail">
          {cmsSteps.length > 0
            ? cmsSteps.map((step, i) => (
                <motion.div
                  key={step.id}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  className="relative"
                >
                  <div className="card-tint rounded-2xl p-6 h-full relative overflow-hidden shadow-[var(--shadow-soft)]">
                    <div className="absolute top-3 right-4 font-display text-6xl text-primary/15" aria-hidden="true">
                      {String(i + 1).padStart(2, "0")}
                    </div>
                    <div className="relative">
                      <div className="h-12 w-12 rounded-full bg-primary/10 ring-4 ring-background flex items-center justify-center mb-4">
                        <Sparkles className="h-6 w-6 text-primary" aria-hidden="true" />
                      </div>
                      <h3 className="font-display font-semibold mb-2">{step.title ?? `Шаг ${i + 1}`}</h3>
                      <p className="text-sm text-muted-foreground">{step.subtitle ?? step.text ?? ""}</p>
                    </div>
                  </div>
                </motion.div>
              ))
            : [
            {
              num: "01",
              title: "Выберите торт",
              text: "Из каталога или соберите свой в конструкторе за 8 шагов",
              icon: Search,
            },
            {
              num: "02",
              title: "Свяжитесь с кондитером",
              text: "Уточните детали, согласуйте сроки и цену через чат",
              icon: MessageCircle,
            },
            {
              num: "03",
              title: "Оплатите безопасно",
              text: "Деньги на эскроу-счёте 24 часа — гарантия получения заказа",
              icon: CreditCard,
            },
            {
              num: "04",
              title: "Получите заказ",
              text: "Доставка курьером или самовывоз. Оцените кондитера и оставьте отзыв",
              icon: Truck,
            },
          ].map((step, i) => {
            const Icon = step.icon;
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="relative"
              >
                <div className="card-tint rounded-2xl p-6 h-full relative overflow-hidden shadow-[var(--shadow-soft)]">
                  <div className="absolute top-3 right-4 font-display text-6xl text-primary/15" aria-hidden="true">
                    {step.num}
                  </div>
                  <div className="relative">
                    <div className="h-12 w-12 rounded-full bg-primary/10 ring-4 ring-background flex items-center justify-center mb-4">
                      <Icon className="h-6 w-6 text-primary" aria-hidden="true" />
                    </div>
                    <h3 className="font-display font-semibold mb-2">
                      {step.title}
                    </h3>
                    <p className="text-sm text-muted-foreground">{step.text}</p>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
        </div>
      </section>

      {/* V2: отдельная лента статистики больше не нужна — счётчики
          переехали в стеклянную ленту внутри hero (см. HERO) */}
    ),
    testimonials: (
      {/* ===== TESTIMONIALS — реальные отзывы из БД (GET /api/reviews) ===== */}
      <section className="container mx-auto px-4">
        <div className="text-center mb-12">
          <span className="small-caps inline-block text-xs font-semibold tracking-[0.2em] text-primary bg-primary/10 rounded-full px-4 py-1.5 mb-3">
            Проверенные отзывы
          </span>
          <h2 className="font-display text-3xl sm:text-4xl">
             {cmsSectionTitle("testimonials", "Отзывы покупателей")} 
          </h2>
          <p className="text-muted-foreground mt-3">
            Проверенные отзывы о заказах на платформе
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {realReviews === null
            ? // Загрузка: скелетоны в той же сетке
              [0, 1, 2].map((i) => (
                <div key={`sk-${i}`} className="card-tint rounded-2xl p-6 h-full animate-pulse">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="h-10 w-10 rounded-full bg-muted" />
                    <div className="space-y-2">
                      <div className="h-3 w-28 bg-muted rounded" />
                      <div className="h-2 w-16 bg-muted rounded" />
                    </div>
                  </div>
                  <div className="h-3 w-full bg-muted rounded mb-2" />
                  <div className="h-3 w-4/5 bg-muted rounded" />
                </div>
              ))
            : (realReviews.length > 0
                ? realReviews.slice(0, 6)
                : [
                    // Фолбэк при пустой БД — честная заглушка без выдуманных
                    // цифр (в БД ещё нет отзывов)
                    {
                      id: "fallback-1",
                      rating: 5,
                      text: "Здесь появятся отзывы покупателей о заказах на платформе.",
                      author: { name: "Команда Уездного кондитера" },
                      helpfulCount: 0,
                      createdAt: "",
                    },
                  ]
              ).map((review, i) => (
                <motion.div
                  key={review.id}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.05 }}
                >
                  <div className="card-tint quote-card rounded-2xl p-6 h-full shadow-[var(--shadow-soft)]">
                    <div className="flex items-center gap-3 mb-4">
                      <Avatar>
                        <AvatarImage
                          src={review.author?.avatarUrl}
                          alt={review.author?.name || "Покупатель"}
                        />
                        <AvatarFallback>
                          {(review.author?.name || "П")[0]}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="font-semibold text-sm">
                          {review.author?.name || "Покупатель"}
                        </div>
                        {review.product?.title && (
                          <div className="text-xs text-muted-foreground">
                            {review.product.title}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-0.5 mb-3">
                      {Array.from({ length: review.rating }).map((_, si) => (
                        <Star
                          key={si}
                          className="h-4 w-4 fill-amber-400 text-amber-400"
                        />
                      ))}
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      &laquo;{review.text}&raquo;
                    </p>
                  </div>
                </motion.div>
              ))}
        </div>
      </section>
    ),
    cta_confectioner: (
      {/* ===== CTA BECOME CONFECTIONER (V2: вишнёвая панель) ===== */}
      <section className="container mx-auto px-4">
        <div className="panel-dark relative overflow-hidden rounded-3xl shadow-[var(--shadow-pop)]">
          <div className="absolute inset-0 bg-pattern opacity-40" aria-hidden="true" />
          <div className="absolute -top-20 left-1/3 h-72 w-72 rounded-full border border-white/10" aria-hidden="true" />
          <div className="relative p-8 lg:p-12 grid lg:grid-cols-2 gap-8 items-center">
            <div className="space-y-5">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 border border-white/20 px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wider">
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                 {cmsSectionTitle("cta_confectioner", "Для кондитеров")} 
              </span>
              <h2 className="font-display text-3xl lg:text-4xl">
                {cmsCtaPanel?.title ?? (
                  <>
                    Продавайте свои торты
                    <br />
                    <span className="text-accent">по всей России</span>
                  </>
                )}
              </h2>
              <p className="text-white/85 max-w-lg">
                {cmsCtaPanel?.subtitle ?? cmsCtaPanel?.text ?? (
                  "Присоединяйтесь к кондитерам платформы. Витрина, CRM, финансовая аналитика, социальный канал, помощь с налогами (НПД). Тарифы от 5% комиссии."
                )}
              </p>
              <div className="flex flex-wrap gap-3">
                <Button
                  size="lg"
                  onClick={() =>
                    cmsCtaPanel?.link && cmsCtaPanel?.linkText
                      ? openCmsHref(cmsCtaPanel.link)
                      : useAppStore.getState().setAuthModalOpen(true)
                  }
                  className="bg-accent text-accent-foreground hover:bg-accent/85 shadow-lg"
                >
                  {cmsCtaPanel?.linkText ?? "Стать кондитером"}
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => navigate("for-confectioners")}
                  className="border-white/30 bg-white/5 text-white hover:bg-white/15 hover:text-white"
                >
                  Узнать о тарифах
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              {[
                // Z-v20 (UX D3): бизнес-модель — факты (5% / 24ч / 4%),
                // метрики платформы — реальные счётчики вместо выдуманных
                // «190+ городов» и «120K заказов в год»
                { val: "5%", label: "Старт комиссии" },
                { val: "24ч", label: "Эскроу-холд" },
                { val: "4%", label: "НПД с физлиц" },
                { val: verifiedCount > 0 ? String(verifiedCount) : "—", label: "Проверенных кондитеров" },
                { val: productCount > 0 ? String(productCount) : "—", label: "Товаров в каталоге" },
                { val: cityCount > 0 ? String(cityCount) : "—", label: "Городов с кондитерами" },
              ].map((s, i) => (
                <div
                  key={i}
                  className="stat-glass p-3"
                >
                  <div className="font-display text-2xl tnum">
                    {s.val}
                  </div>
                  <div className="text-[11px] text-white/75">
                    {s.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    ),
  };

  return (
    <div className="space-y-20 pb-12">
      {/* ===== HERO (Design Revamp V2: пастильная редакционная сцена) ===== */}
      {cmsSectionEnabled("hero") && (
      <section className="relative overflow-hidden hero-scene">
        {/* Лёгкое бумажное зерно поверх сцены */}
        <div className="absolute inset-0 grain-overlay" aria-hidden="true" />
        {/* Декоративные кольца-«печатки» */}
        <div className="absolute -top-28 -right-24 h-[26rem] w-[26rem] decor-ring hidden lg:block" aria-hidden="true" />
        <div className="absolute bottom-10 -left-36 h-80 w-80 decor-ring opacity-60 hidden lg:block" aria-hidden="true" />
        <div className="container mx-auto px-4 pt-10 pb-14 sm:pt-14 sm:pb-20 lg:pt-20 lg:pb-24 relative">
          <div className="grid lg:grid-cols-2 gap-8 lg:gap-12 items-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="space-y-6 text-center lg:text-left"
            >
              <span className="inline-flex items-center gap-2 glass-pill rounded-full px-4 py-1.5 text-xs font-semibold text-foreground">
                <span className="relative flex h-2 w-2" aria-hidden="true">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-60" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                </span>
                Маркетплейс от частных кондитеров России
              </span>

              {/* ZV31-001: заголовок из CMS (site_settings: hero_title), иначе хардкод */}
              {cmsHero ? (
                <h1 className="font-display text-4xl sm:text-5xl lg:text-[4rem] leading-[1.1] tracking-tight">
                  {cmsHero.title}
                </h1>
              ) : (
                <h1 className="font-display text-4xl sm:text-5xl lg:text-[4rem] leading-[1.1] tracking-tight">
                  Торты и десерты
                  <br />
                  <span className="marker-highlight">от уездных</span>{" "}
                  <span className="text-gradient">кондитеров</span>
                </h1>
              )}

              {/* ZV31-001: подзаголовок из CMS (hero_subtitle); нет ключа — хардкод */}
              {!cmsHero || !cmsHero.subtitle ? (
                <p className="text-lg text-muted-foreground max-w-xl mx-auto lg:mx-0">
                  Заказывайте домашние торты напрямую у проверенных кондитеров
                  со всей России. Конструктор тортов, безопасные платежи с
                  эскроу, доставка в ваш город.
                </p>
              ) : (
                <p className="text-lg text-muted-foreground max-w-xl mx-auto lg:mx-0">
                  {cmsHero.subtitle}
                </p>
              )}

              {/* Smart search — ИИ разбирает запрос на фильтры каталога.
                  Обычный путь без ИИ остаётся: каталог + фильтры и кнопка ниже. */}
              <AiSmartSearch variant="hero" />

              <div className="flex flex-wrap gap-3 justify-center lg:justify-start">
                {/* Design Revamp V1: главный CTA — переход в каталог */}
                <Button
                  size="lg"
                  onClick={() => navigate("catalog")}
                  className="btn-primary-gradient"
                >
                  Смотреть каталог
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
                {/* ZV31-001: CTA из CMS (hero_cta_label + hero_cta_href) */}
                {cmsCta && (
                  <Button
                    size="lg"
                    onClick={() => openCmsHref(cmsCta.href)}
                    className="btn-primary-gradient"
                  >
                    <Sparkles className="h-4 w-4 mr-2" />
                    {cmsCta.label}
                  </Button>
                )}
                <Button
                  size="lg"
                  onClick={() => setCakeBuilderOpen(true)}
                  className="btn-3d-light"
                >
                  <Cake className="h-4 w-4 mr-2" />
                  Собрать торт в конструкторе
                </Button>
                <AICakeFinderButton />
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => setHelpOpen(true)}
                  className="btn-3d-light"
                >
                  <Sparkles className="h-4 w-4 mr-2" />
                  Помочь выбрать
                </Button>
              </div>

              {/* Trust-чипы — стеклянные пилюли (качественные гарантии;
                  числовые счётчики — в ленте ниже) */}
              <div className="flex flex-wrap gap-2.5 justify-center lg:justify-start pt-2 text-sm">
                <div className="glass-pill rounded-full px-3.5 py-2 flex items-center gap-2 text-xs sm:text-sm">
                  <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
                  <span><strong className="font-semibold">Эскроу-защита</strong> 24 часа</span>
                </div>
                <div className="glass-pill rounded-full px-3.5 py-2 flex items-center gap-2 text-xs sm:text-sm">
                  <Truck className="h-4 w-4 text-primary" aria-hidden="true" />
                  <span>Доставка <strong className="font-semibold">от 300 ₽</strong></span>
                </div>
                <div className="glass-pill rounded-full px-3.5 py-2 flex items-center gap-2 text-xs sm:text-sm">
                  <CreditCard className="h-4 w-4 text-primary" aria-hidden="true" />
                  <span>Оплата <strong className="font-semibold">картой и СБП</strong></span>
                </div>
              </div>
            </motion.div>

            {/* Hero visual — V2: виден и на мобильных, рамка-подложка */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="relative mt-2 lg:mt-0"
            >
              <div className="relative aspect-square max-w-md mx-auto lg:max-w-none lg:aspect-[4/3.2]">
                <div className="absolute inset-0 rounded-full bg-gradient-to-br from-primary/25 to-accent/70 blur-3xl" />
                <Image
                  src="https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=800"
                  alt="Домашний торт"
                  width={800}
                  height={800}
                  priority
                  fetchPriority="high"
                  sizes="(max-width: 1024px) 100vw, 36rem"
                  className="relative rounded-[2rem] shadow-2xl w-full h-full object-cover hero-photo-frame"
                />
                {/* Floating cards */}
                <div className="absolute -top-4 -right-4 hidden sm:flex glass-card rounded-2xl shadow-lg p-3 animate-float-3d">
                  <div className="flex items-center gap-2">
                    <div className="h-10 w-10 rounded-full bg-accent flex items-center justify-center">
                      <Star className="h-5 w-5 fill-primary text-primary" />
                    </div>
                    <div>
                    <div className="text-sm font-bold">
                      {avgRating > 0 ? `${avgRating} / 5.0` : "—"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      средний рейтинг
                      {avgRating === 0 ? " (нет оценённых товаров)" : ""}
                    </div>
                    </div>
                  </div>
                </div>
                <div
                  className="absolute -bottom-4 -left-4 hidden sm:flex glass-card rounded-2xl shadow-lg p-3 animate-float-3d"
                  style={{ animationDelay: "2s" }}
                >
                  <div className="flex items-center gap-2">
                    <div className="h-10 w-10 rounded-full bg-emerald-100 flex items-center justify-center">
                      <ShieldCheck className="h-5 w-5 text-emerald-600" />
                    </div>
                    <div>
                      <div className="text-sm font-bold">Эскроу-счёт</div>
                      <div className="text-xs text-muted-foreground">
                        холдирование 24 часа
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>


        </div>
      </section>
      )}

      {/* ===== CMS BANNERS (ZV31-001): опубликованные админом баннеры
           (cms_banners: is_active=true, позиции top/hero/home_hero, sort_order asc).
           Пустой массив/ошибка → секция не рендерится: ноль визуальных изменений. ===== */}
      {cms.banners.length > 0 && (
        <section className="container mx-auto px-4" aria-label="Акции и события">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {cms.banners.map((banner) => {
              const cardClass =
                "group relative block h-36 w-full overflow-hidden rounded-xl border border-border bg-card text-left hover:border-primary/40 hover:shadow-lg transition-all";
              const body = (
                <>
                  {banner.imageUrl ? (
                    isOptimizableImage(banner.imageUrl) ? (
                      <Image
                        src={banner.imageUrl}
                        alt={banner.title ?? "Баннер"}
                        fill
                        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                        className="object-cover"
                      />
                    ) : (
                      /* Домен не в images.remotePatterns → обычный img, чтобы
                         next/image не падал на произвольном URL из CMS */
                      <img
                        src={banner.imageUrl}
                        alt={banner.title ?? "Баннер"}
                        className="absolute inset-0 h-full w-full object-cover"
                        loading="lazy"
                        decoding="async"
                      />
                    )
                  ) : (
                    <div className="absolute inset-0 mesh-gradient opacity-70" />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-4">
                    {banner.title && (
                      <div className="font-display font-semibold text-white text-base line-clamp-1">
                        {banner.title}
                      </div>
                    )}
                    {banner.subtitle && (
                      <div className="text-xs text-white/85 line-clamp-2 mt-0.5">
                        {banner.subtitle}
                      </div>
                    )}
                  </div>
                </>
              );
              if (banner.href && isExternalCmsHref(banner.href)) {
                return (
                  <a
                    key={banner.id}
                    href={banner.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cardClass}
                  >
                    {body}
                  </a>
                );
              }
              if (banner.href) {
                return (
                  <button
                    key={banner.id}
                    type="button"
                    onClick={() => {
                      if (banner.href) openCmsHref(banner.href);
                    }}
                    className={cardClass}
                  >
                    {body}
                  </button>
                );
              }
              return (
                <div key={banner.id} className={cardClass}>
                  {body}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ===== БЕГУЩАЯ СТРОКА РЕАЛЬНЫХ КОНДИТЕРОВ ===== */}
      <ConfectionersMarquee />

      {/* ===== ВИДЕО-ЛЕНТА (TikTok-style) + КАЛЕНДАРЬ ===== */}
      <section className="container mx-auto px-4 py-6">
        <div className="grid lg:grid-cols-[1fr_320px] gap-4">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Видео кондитеров
              </span>
              <Badge variant="outline" className="text-[10px]">NEW</Badge>
            </div>
            <VideoFeed />
          </div>
          <div>
            <HolidayCalendar />
          </div>
        </div>
      </section>

      {/* ===== STORIES (Instagram-style) ===== */}
      <section className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Истории кондитеров
          </h2>
          <Badge variant="outline" className="text-[10px]">24ч</Badge>
        </div>
        <StoriesFeed />
      </section>

      {/* ===== TRUST BANNER ===== */}
      <section className="container mx-auto px-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            {
              icon: ShieldCheck,
              title: "Безопасные платежи",
              text: "Эскроу 24 часа, возврат средств",
              color: "text-emerald-600 bg-emerald-100",
            },
            {
              icon: Award,
              title: "Проверенные кондитеры",
              text: "Верификация и рейтинги",
              color: "text-primary bg-primary/10",
            },
            {
              icon: Truck,
              title: "Доставка по России",
              text: "От 300 ₽, бесплатно от 3000 ₽",
              color: "text-amber-700 bg-amber-100",
            },
            {
              icon: CreditCard,
              title: "Оплата картой и СБП",
              text: "YooKassa, Visa, Mastercard, Мир",
              color: "text-orange-700 bg-orange-100",
            },
          ].map((item, i) => {
            const Icon = item.icon;
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
              >
                <div className="card-tint rounded-2xl p-4 h-full shadow-[var(--shadow-soft)]">
                  <div
                    className={`h-10 w-10 rounded-xl flex items-center justify-center mb-3 ${item.color}`}
                  >
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="font-semibold text-sm mb-1">{item.title}</div>
                  <div className="text-xs text-muted-foreground">{item.text}</div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </section>

      <OrnamentDivider />

      {/* ===== CATEGORIES ===== */}
      <section className="container mx-auto px-4">
        <div className="flex items-end justify-between mb-8">
          <div className="space-y-2">
            <span className="eyebrow-rule">Каталог</span>
            <h2 className="font-display text-3xl sm:text-4xl">
              Категории
            </h2>
            <p className="text-muted-foreground">
              Выберите, что вас интересует
            </p>
          </div>
          <button
            onClick={() => navigate("catalog")}
            className="link-more hidden sm:inline-flex"
          >
            Весь каталог
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-8 gap-3 sm:gap-4">
          {CATEGORIES.map((cat, i) => (
            <motion.div
              key={cat.slug}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.04 }}
            >
              <button
                onClick={() => navigate("catalog", { category: cat.slug })}
                className={`group w-full flex flex-col items-center gap-2.5 p-4 pt-5 rounded-2xl border border-border/60 hover:border-primary/40 hover:shadow-[var(--shadow-lift)] hover:-translate-y-1 transition-all h-full tile-tint-${(i % 8) + 1}`}
              >
                <div className="h-14 w-14 rounded-2xl bg-white/70 dark:bg-white/10 shadow-sm flex items-center justify-center text-3xl group-hover:scale-110 group-hover:-rotate-6 transition-transform">
                  {cat.icon}
                </div>
                <div className="text-sm font-semibold text-center leading-snug">{cat.name}</div>
                {categoryCounts[cat.slug] > 0 && (
                  <div className="text-[11px] font-medium text-muted-foreground bg-white/60 dark:bg-white/10 rounded-full px-2 py-0.5 tnum">
                    {categoryCounts[cat.slug]} товаров
                  </div>
                )}
              </button>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ===== POPULAR PRODUCTS ===== */}
      <section className="container mx-auto px-4">
        <div className="flex items-end justify-between mb-8">
          <div className="space-y-2">
            <span className="eyebrow-rule">Хиты продаж</span>
            <h2 className="font-display text-3xl sm:text-4xl">
              Популярные товары
            </h2>
            <p className="text-muted-foreground">
              То, что чаще всего заказывают наши покупатели
            </p>
          </div>
          <button
            onClick={() => navigate("catalog")}
            className="link-more hidden sm:inline-flex"
          >
            Все товары
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* ZV31-017: честные состояния секции — skeleton / ошибка+retry /
            пустой каталог / данные (как в каталоге) */}
        {isProductsLoading ? (
          <div
            className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4"
            role="status"
            aria-label="Загрузка популярных товаров"
            aria-busy="true"
          >
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} className="overflow-hidden p-0">
                <Skeleton className="aspect-[4/3] w-full rounded-none" />
                <div className="p-3 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </Card>
            ))}
          </div>
        ) : hasProductsError ? (
          <Card className="p-10 text-center" role="alert">
            <AlertTriangle className="h-10 w-10 mx-auto mb-3 text-destructive" />
            <h3 className="font-semibold mb-1">Не удалось загрузить товары</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Сервис каталога недоступен. Попробуйте ещё раз.
            </p>
            <Button onClick={() => refetchLive()} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Повторить
            </Button>
          </Card>
        ) : isCatalogEmpty ? (
          <Card className="p-12 text-center">
            <div className="h-16 w-16 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
              <Cake className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="font-semibold mb-1">Каталог пока пуст</h3>
            <p className="text-sm text-muted-foreground">
              Кондитеры ещё не опубликовали товары — загляните позже.
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {popularProducts.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </section>

      {/* P2.3: персональные рекомендации (только при якорях избранное/
          история заказов; аноним видит «Популярные товары» выше) */}
      <ForYouBlock />

      {/* ===== CAKE BUILDER CTA (V2: глубокая вишнёвая панель) ===== */}
      <section className="container mx-auto px-4">
        <div className="panel-dark relative overflow-hidden rounded-3xl shadow-[var(--shadow-pop)]">
          <div className="absolute inset-0 bg-pattern opacity-40" aria-hidden="true" />
          <div className="absolute -top-16 -right-16 h-64 w-64 rounded-full border border-white/15" aria-hidden="true" />
          <div className="absolute -bottom-20 -left-10 h-72 w-72 rounded-full border border-white/10" aria-hidden="true" />
          <div className="relative p-8 lg:p-12 grid lg:grid-cols-2 gap-8 items-center">
            <div className="space-y-5">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 border border-white/20 px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wider">
                <Cake className="h-3.5 w-3.5" aria-hidden="true" />
                Конструктор тортов
              </span>
              <h2 className="font-display text-3xl lg:text-4xl">
                Соберите свой идеальный торт
                <br />
                <span className="text-accent">за 8 простых шагов</span>
              </h2>
              <p className="text-white/85 max-w-lg">
                Выберите основу, начинку, покрытие и декор. Запрос отправится
                ближайшим кондитерам, которые предложат цену. Сравните
                предложения и выберите лучшее.
              </p>
              <div className="flex flex-wrap gap-2">
                {[
                  "Выбор основы",
                  "Начинка",
                  "Покрытие",
                  "Декор",
                  "Доставка",
                  "Цена",
                ].map((step) => (
                  <span
                    key={step}
                    className="inline-flex items-center rounded-full bg-white/10 border border-white/15 px-3 py-1 text-xs font-medium"
                  >
                    <Check className="h-3 w-3 mr-1.5 text-accent" aria-hidden="true" />
                    {step}
                  </span>
                ))}
              </div>
              <Button
                size="lg"
                onClick={() => setCakeBuilderOpen(true)}
                className="bg-accent text-accent-foreground hover:bg-accent/85 shadow-lg"
              >
                <Cake className="h-4 w-4 mr-2" />
                Начать конструирование
              </Button>
            </div>
            <div className="relative">
              <div className="absolute inset-6 rounded-[1.75rem] border border-white/20 rotate-3" aria-hidden="true" />
              <Image
                src="https://images.unsplash.com/photo-1535141192574-5d4897c12636?w=600"
                alt="Конструктор тортов"
                width={600}
                height={450}
                loading="lazy"
                sizes="(max-width: 768px) 100vw, 28rem"
                className="rounded-[1.5rem] shadow-2xl w-full max-w-md mx-auto border-4 border-white/25"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ===== CONFECTIONERS ===== */}
      <section className="container mx-auto px-4">
        <div className="flex items-end justify-between mb-8">
          <div className="space-y-2">
            <span className="eyebrow-rule">Топ кондитеров</span>
            <h2 className="font-display text-3xl sm:text-4xl">
              Лучшие кондитеры платформы
            </h2>
            <p className="text-muted-foreground">
              Проверенные мастера с высоким рейтингом и доверием покупателей
            </p>
          </div>
          <button
            onClick={() => navigate("confectioners")}
            className="link-more hidden sm:inline-flex"
          >
            Все кондитеры
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Реальные кондитеры — 2 карточки */}
          {confectioners.slice(0, 2).map((conf) => (
            <ConfectionerCard key={conf.id} confectioner={conf} />
          ))}

          {/* === Карточка-приглашение: "Стать кондитером" === */}
          <div
            onClick={() => {
              useAppStore.getState().setAuthModalOpen(true);
            }}
            className="group relative overflow-hidden rounded-2xl border-2 border-dashed border-primary/35 bg-primary/[0.04] hover:border-primary/55 hover:shadow-[var(--shadow-lift)] hover:-translate-y-1 transition-all cursor-pointer min-h-[280px] flex flex-col items-center justify-center p-6 text-center"
          >
            <div className="absolute inset-0 bg-pattern opacity-40 group-hover:opacity-70 transition-opacity" aria-hidden="true" />
            <div className="absolute -top-8 -right-8 h-28 w-28 decor-ring opacity-50" aria-hidden="true" />
            <div className="relative z-10 space-y-3">
              <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                <Sparkles className="h-7 w-7 text-primary" />
              </div>
              <h3 className="font-display text-lg font-bold">Ваше место здесь!</h3>
              <p className="text-xs text-muted-foreground max-w-[200px] mx-auto leading-relaxed">
                Вы умеете печь торты? Создайте витрину, получайте заказы
                и зарабатывайте на любимом деле
              </p>
              <div className="inline-flex items-center gap-1 text-primary text-sm font-medium group-hover:gap-2 transition-all">
                Стать кондитером
                <ArrowRight className="h-3.5 w-3.5" />
              </div>
            </div>
          </div>

          {/* === Карточка-приглашение: "Успешный кондитер" === */}
          <div
            onClick={() => {
              navigate("for-confectioners");
            }}
            className="group relative overflow-hidden rounded-2xl border-2 border-dashed border-emerald-400/35 bg-emerald-50/40 dark:bg-emerald-950/20 hover:border-emerald-400/55 hover:shadow-[var(--shadow-lift)] hover:-translate-y-1 transition-all cursor-pointer min-h-[280px] flex flex-col items-center justify-center p-6 text-center"
          >
            <div className="absolute inset-0 bg-pattern opacity-40 group-hover:opacity-70 transition-opacity" aria-hidden="true" />
            <div className="absolute -bottom-8 -left-8 h-28 w-28 decor-ring opacity-50" aria-hidden="true" />
            <div className="relative z-10 space-y-3">
              <div className="h-14 w-14 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
                <Award className="h-7 w-7 text-emerald-600" />
              </div>
              <h3 className="font-display text-lg font-bold">Растём вместе!</h3>
              <p className="text-xs text-muted-foreground max-w-[200px] mx-auto leading-relaxed">
                Успешный кондитер? Расширьте возможности: больше
                заказов, CRM, аналитика, франшиза
              </p>
              <div className="inline-flex items-center gap-1 text-emerald-600 text-sm font-medium group-hover:gap-2 transition-all">
                Присоединиться
                <ArrowRight className="h-3.5 w-3.5" />
              </div>
            </div>
          </div>
        </div>
      </section>

      <OrnamentDivider />

      {/* ===== NEW PRODUCTS ===== */}
      {newProducts.length > 0 && (
        <section className="relative overflow-hidden py-12 bg-secondary/40">
          <div className="container mx-auto px-4 relative">
            <div className="flex items-end justify-between mb-8">
              <div className="space-y-2">
                <span className="eyebrow-rule">Свежее поступление</span>
                <h2 className="font-display text-3xl sm:text-4xl">
                  Новинки
                </h2>
              </div>
              <button
                onClick={() => navigate("catalog")}
                className="link-more hidden sm:inline-flex"
              >
                В каталог
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {newProducts.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          </div>
        </section>
      )}

      {cmsSections
        .filter((section) => section.section !== "hero" && section.is_enabled && section.section in cmsSectionNodes)
        .sort((a, b) => a.sort_order - b.sort_order || a.section.localeCompare(b.section))
        .map((section) => (
          <Fragment key={section.section}>
            {cmsSectionNodes[section.section as keyof typeof cmsSectionNodes]}
            <CmsHomepageSectionBlocks section={section.section} title={section.title} blocks={cmsHomeBlocks} />
          </Fragment>
        ))}

      {/* ===== RECENTLY VIEWED ===== */}
      <section className="container mx-auto px-4">
        <RecentlyViewed />
      </section>

      {/* P2.2: анкета «Помочь выбрать» — короткий вопросник, подбор детерминированный */}
      <HelpChooseDialog
        open={helpOpen}
        onOpenChange={setHelpOpen}
        onShowInCatalog={showHelpResultsInCatalog}
      />
    </div>
  );
}
