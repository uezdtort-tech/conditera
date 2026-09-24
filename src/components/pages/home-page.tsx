"use client";

import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { StoriesFeed } from "@/components/stories/stories-feed";
import { AICakeFinderButton } from "@/components/ai-cake-finder/ai-cake-finder";
import { VideoFeed } from "@/components/video-feed/video-feed";
import { HolidayCalendar } from "@/components/holidays/holiday-calendar";
import { ProductCard } from "@/components/marketplace/product-card";
import { ConfectionerCard } from "@/components/marketplace/confectioner-card";
import { ConfectionersMarquee } from "@/components/marketplace/confectioners-marquee";
import { RecentlyViewed } from "@/components/ui/enhanced-components";
import { AnimatedCounter, GlassCard, FloatWrapper, GradientBorderCard, TiltCard } from "@/components/ui/modern-effects";
import { CATEGORIES } from "@/lib/mock-data";
import { formatCurrency } from "@/lib/finance";
import Image from "next/image";
import { OrnamentDivider, Eyebrow } from "@/components/ui/ornaments";
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
} from "lucide-react";
import { motion } from "framer-motion";
import { useState } from "react";

export function HomePage() {
  const navigate = useAppStore((s) => s.navigate);
  const setCakeBuilderOpen = useAppStore((s) => s.setCakeBuilderOpen);
  const products = useAppStore((s) => s.products);
  const confectioners = useAppStore((s) => s.confectioners);

  const [searchValue, setSearchValue] = useState("");

  const popularProducts = products.filter((p) => p.isPopular || p.isHit).slice(0, 8);
  const newProducts = products.filter((p) => p.isNew).slice(0, 4);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchValue.trim()) {
      navigate("catalog", { q: searchValue.trim() });
    } else {
      navigate("catalog");
    }
  };

  return (
    <div className="space-y-20 pb-12">
      {/* ===== HERO ===== */}
      <section
        className="relative overflow-hidden"
      >
        {/* LCP-оптимизация: hero-фон через next/image с priority.
            next/image автоматически отдаёт AVIF/WebP, проставляет preload
            и не даёт браузеру тормозить на декоде PNG.
            fetchPriority="high" — явное указание приоритета для браузеров
            с поддержкой Fetch Priority API (Chrome 101+, Safari 17+). */}
        <Image
          src="/hero-bg.png"
          alt=""
          fill
          priority
          fetchPriority="high"
          sizes="100vw"
          quality={80}
          className="object-cover -z-10"
        />
        {/* Затемнение для читаемости текста */}
        <div className="absolute inset-0 bg-gradient-to-r from-background/90 via-background/70 to-background/40" />
        <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-transparent to-transparent" />
        <div className="container mx-auto px-4 py-12 sm:py-16 lg:py-24 relative">
          <div className="grid lg:grid-cols-2 gap-8 lg:gap-12 items-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="space-y-6 text-center lg:text-left"
            >
              <Badge className="bg-primary/10 text-primary border-primary/20 hover:bg-primary/15">
                <Sparkles className="h-3 w-3 mr-1" />
                Маркетплейс от частных кондитеров России
              </Badge>

              <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-tight">
                Торты и десерты
                <br />
                <span className="text-gradient">от уездных кондитеров</span>
              </h1>

              <p className="text-lg text-muted-foreground max-w-xl mx-auto lg:mx-0">
                Заказывайте домашние торты напрямую у проверенных кондитеров
                со всей России. Конструктор тортов, безопасные платежи с
                эскроу, доставка в ваш город.
              </p>

              {/* Search */}
              <form
                onSubmit={handleSearch}
                className="flex gap-2 max-w-xl mx-auto lg:mx-0"
              >
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    type="text"
                    value={searchValue}
                    onChange={(e) => setSearchValue(e.target.value)}
                    placeholder="Торт на день рождения, медовик, макаронс..."
                    className="w-full pl-10 pr-4 py-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  />
                </div>
                <Button type="submit" size="lg" className="px-6">
                  Найти
                </Button>
              </form>

              <div className="flex flex-wrap gap-3 justify-center lg:justify-start">
                <Button
                  size="lg"
                  onClick={() => setCakeBuilderOpen(true)}
                  className="bg-primary glow-primary"
                >
                  <Cake className="h-4 w-4 mr-2" />
                  Собрать торт в конструкторе
                </Button>
                <AICakeFinderButton />
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => navigate("catalog")}
                  className="btn-3d-light"
                >
                  Смотреть каталог
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </div>

              {/* Trust stats */}
              <div className="flex flex-wrap gap-6 justify-center lg:justify-start pt-4 text-sm">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary" />
                  <span>
                    <strong className="font-semibold">2 400+</strong> кондитеров, все проверены
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Store className="h-4 w-4 text-primary" />
                  <span>
                    <strong className="font-semibold">18 000+</strong> товаров
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  <span>
                    <strong className="font-semibold">Эскроу</strong> 24 часа
                  </span>
                </div>
              </div>
            </motion.div>

            {/* Hero visual */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="relative hidden lg:block"
            >
              <div className="relative aspect-square max-w-md mx-auto">
                <div className="absolute inset-0 rounded-full bg-gradient-to-br from-primary/20 to-amber-300/30 blur-3xl" />
                <Image
                  src="https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=800"
                  alt="Домашний торт"
                  width={800}
                  height={800}
                  loading="lazy"
                  sizes="(max-width: 768px) 100vw, 28rem"
                  className="relative rounded-3xl shadow-2xl w-full h-full object-cover"
                />
                {/* Floating cards */}
                <div className="absolute -top-4 -right-4 glass-card rounded-xl shadow-lg p-3 animate-float-3d">
                  <div className="flex items-center gap-2">
                    <div className="h-10 w-10 rounded-full bg-amber-100 flex items-center justify-center">
                      <Star className="h-5 w-5 fill-amber-500 text-amber-500" />
                    </div>
                    <div>
                      <div className="text-sm font-bold">4.9 / 5.0</div>
                      <div className="text-xs text-muted-foreground">
                        средний рейтинг
                      </div>
                    </div>
                  </div>
                </div>
                <div
                  className="absolute -bottom-4 -left-4 glass-card rounded-xl shadow-lg p-3 animate-float-3d"
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
              color: "text-blue-600 bg-blue-100",
            },
            {
              icon: CreditCard,
              title: "Оплата картой и СБП",
              text: "YooKassa, Visa, Mastercard, Мир",
              color: "text-amber-600 bg-amber-100",
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
                <Card className="p-4 h-full hover:shadow-md transition-shadow">
                  <div
                    className={`h-10 w-10 rounded-lg flex items-center justify-center mb-3 ${item.color}`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="font-semibold text-sm mb-1">{item.title}</div>
                  <div className="text-xs text-muted-foreground">{item.text}</div>
                </Card>
              </motion.div>
            );
          })}
        </div>
      </section>

      <OrnamentDivider />

      {/* ===== CATEGORIES ===== */}
      <section className="container mx-auto px-4">
        <div className="flex items-end justify-between mb-6">
          <div>
            <Eyebrow>Каталог</Eyebrow>
            <h2 className="font-display text-2xl sm:text-3xl font-bold mt-1">
              Категории
            </h2>
            <p className="text-muted-foreground mt-1">
              Выберите, что вас интересует
            </p>
          </div>
          <Button
            variant="ghost"
            onClick={() => navigate("catalog")}
            className="hidden sm:flex"
          >
            Весь каталог
            <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-8 gap-3">
          {CATEGORIES.map((cat, i) => (
            <motion.div
              key={cat.slug}
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.05 }}
            >
              <TiltCard maxTilt={10} className="h-full">
                <button
                  onClick={() => navigate("catalog", { category: cat.slug })}
                  className="group w-full flex flex-col items-center gap-2 p-4 rounded-xl border border-border bg-card hover:border-primary/40 hover:shadow-xl transition-all h-full"
                >
                  <div className="h-12 w-12 rounded-full bg-gradient-to-br from-accent to-primary/10 flex items-center justify-center text-2xl group-hover:scale-110 transition-transform shadow-sm">
                    {cat.icon}
                  </div>
                  <div className="text-sm font-medium text-center">{cat.name}</div>
                  <div className="text-xs text-muted-foreground">{cat.count} тов.</div>
                </button>
              </TiltCard>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ===== POPULAR PRODUCTS ===== */}
      <section className="container mx-auto px-4">
        <div className="flex items-end justify-between mb-6">
          <div>
            <Eyebrow>Хиты продаж</Eyebrow>
            <h2 className="font-display text-2xl sm:text-3xl font-bold mt-1">
              Популярные товары
            </h2>
            <p className="text-muted-foreground mt-1">
              То, что чаще всего заказывают наши покупатели
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => navigate("catalog")}
            className="hidden sm:flex"
          >
            Все товары
            <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {popularProducts.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      </section>

      {/* ===== CAKE BUILDER CTA ===== */}
      <section className="container mx-auto px-4">
        <Card className="relative overflow-hidden border-primary/20 bg-gradient-to-br from-primary/5 via-accent/40 to-amber-200/20">
          <div className="absolute inset-0 bg-pattern opacity-30" />
          <div className="relative p-8 lg:p-12 grid lg:grid-cols-2 gap-6 items-center">
            <div className="space-y-4">
              <Badge className="bg-primary text-primary-foreground">
                <Cake className="h-3 w-3 mr-1" />
                Конструктор тортов
              </Badge>
              <h2 className="font-display text-3xl lg:text-4xl font-bold">
                Соберите свой идеальный торт
                <br />
                <span className="text-gradient">за 8 простых шагов</span>
              </h2>
              <p className="text-muted-foreground max-w-lg">
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
                  <Badge
                    key={step}
                    variant="outline"
                    className="bg-background/80"
                  >
                    <Check className="h-3 w-3 mr-1 text-primary" />
                    {step}
                  </Badge>
                ))}
              </div>
              <Button
                size="lg"
                onClick={() => setCakeBuilderOpen(true)}
                className="bg-primary"
              >
                <Cake className="h-4 w-4 mr-2" />
                Начать конструирование
              </Button>
            </div>
            <div className="relative">
              <Image
                src="https://images.unsplash.com/photo-1535141192574-5d4897c12636?w=600"
                alt="Конструктор тортов"
                width={600}
                height={450}
                loading="lazy"
                sizes="(max-width: 768px) 100vw, 28rem"
                className="rounded-2xl shadow-xl w-full max-w-md mx-auto"
              />
            </div>
          </div>
        </Card>
      </section>

      {/* ===== CONFECTIONERS ===== */}
      <section className="container mx-auto px-4">
        <div className="flex items-end justify-between mb-6">
          <div>
            <Eyebrow>Топ кондитеров</Eyebrow>
            <h2 className="font-display text-2xl sm:text-3xl font-bold mt-1">
              Лучшие кондитеры платформы
            </h2>
            <p className="text-muted-foreground mt-1">
              Проверенные мастера с высоким рейтингом и доверием покупателей
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => navigate("confectioners")}
            className="hidden sm:flex"
          >
            Все кондитеры
            <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
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
            className="group relative overflow-hidden rounded-xl border-2 border-dashed border-primary/30 bg-gradient-to-br from-primary/5 via-accent/10 to-primary/5 hover:border-primary/50 hover:shadow-lg transition-all cursor-pointer min-h-[280px] flex flex-col items-center justify-center p-6 text-center"
          >
            <div className="absolute inset-0 opacity-10 group-hover:opacity-20 transition-opacity">
              <div className="absolute top-4 right-4 text-6xl">🎂</div>
              <div className="absolute bottom-4 left-4 text-5xl">🧁</div>
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-7xl">🍰</div>
            </div>
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
            className="group relative overflow-hidden rounded-xl border-2 border-dashed border-emerald-400/30 bg-gradient-to-br from-emerald-50/50 via-accent/5 to-emerald-50/50 hover:border-emerald-400/50 hover:shadow-lg transition-all cursor-pointer min-h-[280px] flex flex-col items-center justify-center p-6 text-center"
          >
            <div className="absolute inset-0 opacity-10 group-hover:opacity-20 transition-opacity">
              <div className="absolute top-4 right-4 text-6xl">🏆</div>
              <div className="absolute bottom-4 left-4 text-5xl">⭐</div>
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-7xl">🌟</div>
            </div>
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
        <section
          className="relative overflow-hidden py-12"
        >
          {/* LCP-оптимизация: фон новинок через next/image (lazy по умолчанию) */}
          <Image
            src="/section-bg.png"
            alt=""
            fill
            sizes="100vw"
            quality={75}
            className="object-cover -z-10"
          />
          <div className="absolute inset-0 bg-background/80" />
          <div className="container mx-auto px-4 relative">
            <div className="flex items-end justify-between mb-6">
              <div>
                <Badge className="mb-2 bg-emerald-100 text-emerald-800 border-emerald-200">
                  <Sparkles className="h-3 w-3 mr-1" />
                  Свежее поступление
                </Badge>
                <h2 className="font-display text-2xl sm:text-3xl font-bold">
                  Новинки
                </h2>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {newProducts.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ===== ADVANTAGES ===== */}
      <section className="relative overflow-hidden py-12">
        <Image
          src="/section-bg.png"
          alt=""
          fill
          sizes="100vw"
          quality={60}
          className="object-cover -z-10"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/95 via-background/80 to-background/95" />
        <div className="container mx-auto px-4 relative">
        <div className="text-center mb-10">
          <h2 className="font-display text-2xl sm:text-3xl font-bold">
            Почему выбирают нас
          </h2>
          <p className="text-muted-foreground mt-2 max-w-2xl mx-auto">
            Уездный кондитер — это не просто маркетплейс. Это экосистема для
            домашних кондитеров и любителей сладкого по всей России.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
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
              color: "text-purple-600 bg-purple-100",
            },
            {
              icon: MessageCircle,
              title: "Чат в реальном времени",
              text: "Прямые диалоги с кондитерами, чаты привязанные к заказам, поддержка. Все общение — в одной платформе.",
              color: "text-blue-600 bg-blue-100",
            },
            {
              icon: Users,
              title: "Социальный канал",
              text: "Каждый кондитер имеет свой канал: посты с работами, сторис, подписчики, комментарии. Стройте сообщество вокруг бренда.",
              color: "text-rose-600 bg-rose-100",
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
                <Card className="p-6 h-full hover:shadow-xl transition-all duration-300 card-3d border-border/60">
                  <div
                    className={`h-12 w-12 rounded-xl flex items-center justify-center mb-4 ${adv.color} shadow-sm`}
                  >
                    <Icon className="h-6 w-6" />
                  </div>
                  <h3 className="font-display font-semibold text-lg mb-2">
                    {adv.title}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {adv.text}
                  </p>
                </Card>
              </motion.div>
            );
          })}
        </div>
        </div>
      </section>

      {/* ===== STEPS ===== */}
      <section className="relative overflow-hidden py-12">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/10" />
        <div className="container mx-auto px-4 relative">
        <div className="text-center mb-10">
          <h2 className="font-display text-2xl sm:text-3xl font-bold">
            Как сделать заказ
          </h2>
          <p className="text-muted-foreground mt-2">
            Четыре простых шага от выбора до получения
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[
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
                <Card className="p-6 h-full relative overflow-hidden">
                  <div className="absolute top-2 right-3 font-display text-5xl font-bold text-primary/10">
                    {step.num}
                  </div>
                  <div className="relative">
                    <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                      <Icon className="h-6 w-6 text-primary" />
                    </div>
                    <h3 className="font-display font-semibold mb-2">
                      {step.title}
                    </h3>
                    <p className="text-sm text-muted-foreground">{step.text}</p>
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </div>
        </div>
      </section>

      {/* ===== STATS ===== */}
      <section className="container mx-auto px-4">
        <div className="rounded-2xl bg-primary text-primary-foreground border-0 overflow-hidden relative mesh-gradient" style={{ background: "none", backgroundColor: "oklch(0.42 0.18 25)" }}>
          <div className="absolute inset-0 bg-pattern opacity-10" />
          <div className="relative p-8 lg:p-12 grid grid-cols-2 lg:grid-cols-4 gap-6 text-center">
            {[
              { value: 2400, suffix: "+", label: "Активных кондитеров", icon: Users },
              { value: 18000, suffix: "+", label: "Товаров в каталоге", icon: Cake },
              { value: 120000, suffix: "+", label: "Доставленных заказов", icon: Truck },
              { value: 4.9, suffix: " / 5", label: "Средний рейтинг", icon: Star, isFloat: true },
            ].map((stat, i) => {
              const Icon = stat.icon;
              return (
                <div key={i} className="space-y-2">
                  <Icon className="h-6 w-6 mx-auto opacity-80" />
                  <div className="font-display text-3xl lg:text-4xl font-bold">
                    {stat.isFloat ? (
                      <span>4.9 / 5</span>
                    ) : (
                      <AnimatedCounter value={stat.value} suffix={stat.suffix} />
                    )}
                  </div>
                  <div className="text-sm opacity-80">{stat.label}</div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ===== TESTIMONIALS ===== */}
      <section className="container mx-auto px-4">
        <div className="text-center mb-10">
          <h2 className="font-display text-2xl sm:text-3xl font-bold">
            Отзывы покупателей
          </h2>
          <p className="text-muted-foreground mt-2">
            Более 50 000 довольных клиентов по всей России
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            {
              name: "Екатерина",
              city: "Москва",
              avatar: "https://i.pravatar.cc/150?img=49",
              rating: 5,
              text: "Заказывала торт на день рождения дочери через конструктор. Мария из Тулы предложила лучшую цену и невероятно красивый торт. Дети были в восторге!",
            },
            {
              name: "Дмитрий",
              city: "Санкт-Петербург",
              avatar: "https://i.pravatar.cc/150?img=51",
              rating: 5,
              text: "Заказывал свадебный торт на 80 человек. Понравилось, что деньги на эскроу — это гарантия. Торт «Сахарный Лебедь» превзошёл все ожидания.",
            },
            {
              name: "Ольга",
              city: "Тула",
              avatar: "https://i.pravatar.cc/150?img=44",
              rating: 5,
              text: "Купила набор капкейков на корпоратив. Все остались довольны, оформили повторный заказ. Удобно, что можно напрямую общаться с кондитером.",
            },
          ].map((review, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
            >
              <Card className="p-6 h-full">
                <div className="flex items-center gap-3 mb-4">
                  <Avatar>
                    <AvatarImage src={review.avatar} alt={review.name} />
                    <AvatarFallback>{review.name[0]}</AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="font-semibold text-sm">{review.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {review.city}
                    </div>
                  </div>
                </div>
                <div className="flex gap-0.5 mb-3">
                  {Array.from({ length: review.rating }).map((_, i) => (
                    <Star
                      key={i}
                      className="h-4 w-4 fill-amber-400 text-amber-400"
                    />
                  ))}
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  &laquo;{review.text}&raquo;
                </p>
              </Card>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ===== RECENTLY VIEWED ===== */}
      <section className="container mx-auto px-4">
        <RecentlyViewed />
      </section>

      {/* ===== CTA BECOME CONFECTIONER ===== */}
      <section className="relative overflow-hidden py-12">
        <Image
          src="/section-bg.png"
          alt=""
          fill
          sizes="100vw"
          quality={60}
          className="object-cover -z-10"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-background/95 via-background/85 to-background/95" />
        <div className="container mx-auto px-4 relative">
        <Card className="overflow-hidden border-0 bg-gradient-to-br from-amber-100/80 via-accent/60 to-primary/10 glow-primary backdrop-blur-sm">
          <div className="p-8 lg:p-12 grid lg:grid-cols-2 gap-6 items-center">
            <div className="space-y-4">
              <Badge className="bg-primary text-primary-foreground">
                <Sparkles className="h-3 w-3 mr-1" />
                Для кондитеров
              </Badge>
              <h2 className="font-display text-3xl lg:text-4xl font-bold">
                Продавайте свои торты
                <br />
                по всей России
              </h2>
              <p className="text-muted-foreground max-w-lg">
                Присоединяйтесь к 2 400+ кондитерам на платформе. Витрина,
                CRM, финансовая аналитика, социальный канал, помощь с налогами
                (НПД). Тарифы от 5% комиссии.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button
                  size="lg"
                  onClick={() => useAppStore.getState().setAuthModalOpen(true)}
                  className="bg-primary"
                >
                  Стать кондитером
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => navigate("for-confectioners")}
                >
                  Узнать о тарифах
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              {[
                { val: "5%", label: "Старт комиссии" },
                { val: "24ч", label: "Эскроу-холд" },
                { val: "4%", label: "НПД с физлиц" },
                { val: "190+", label: "Городов России" },
                { val: "120K", label: "Заказов в год" },
                { val: "4.9", label: "Рейтинг платформы" },
              ].map((s, i) => (
                <div
                  key={i}
                  className="bg-background/80 backdrop-blur rounded-xl p-3 border border-border"
                >
                  <div className="font-display text-2xl font-bold text-primary">
                    {s.val}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {s.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>
        </div>
      </section>
    </div>
  );
}
