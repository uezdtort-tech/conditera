"use client";

import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ProductCard } from "@/components/marketplace/product-card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Cake,
  Clock,
  Truck,
  Zap,
  TrendingUp,
  Users,
  Mail,
  Phone,
  MapPin,
  Sparkles,
  Award,
  ShieldCheck,
  CreditCard,
  MessageCircle,
  ArrowRight,
  Search,
  FileText,
  Receipt,
  Calendar,
  Star,
  Store,
} from "lucide-react";
import {
  TARIFFS,
  formatCurrency,
  getProductPaymentOptions,
  calculateInstallmentPayment,
  INSTALLMENT_PROVIDERS,
} from "@/lib/finance";
import { useState } from "react";
import { toast } from "sonner";

export function ReadyMadePage() {
  const products = useAppStore((s) => s.products);
  const navigate = useAppStore((s) => s.navigate);
  const readyProducts = products.filter((p) => p.prepTime === "1 день" || p.isHit);

  return (
    <div className="container mx-auto px-4 py-6 lg:py-10 max-w-6xl">
      {/* ===== HERO ===== */}
      <div className="mb-8">
        <Badge className="mb-3 bg-emerald-100 text-emerald-800 border-emerald-200">
          <Zap className="h-3 w-3 mr-1" />
          Готовые изделия
        </Badge>
        <h1 className="font-display text-3xl lg:text-5xl font-bold mb-3">
          Готовые торты с быстрой доставкой
        </h1>
        <p className="text-muted-foreground text-lg max-w-2xl">
          Изделия, которые можно получить уже завтра. Готовятся заранее и
          доступны к немедленной отправке. Доставка по Москве — день в день,
          по России — 1–2 дня через СДЭК с термопакетом.
        </p>
      </div>

      {/* ===== FEATURES ===== */}
      <div className="grid sm:grid-cols-3 gap-4 mb-8">
        {[
          {
            icon: Zap,
            title: "Доставка день в день",
            text: "Заказ до 14:00 — доставка сегодня по Москве. По России — 1–2 дня через СДЭК.",
          },
          {
            icon: ShieldCheck,
            title: "Гарантия свежести",
            text: "Все торты приготовлены не более 24 часов назад. Срок годности — 3–5 дней в холодильнике.",
          },
          {
            icon: CreditCard,
            title: "Без предзаказа",
            text: "Не нужно ждать 2–5 дней. Выбирайте из готовых, оплачивайте — и торт уже в пути.",
          },
        ].map((f, i) => {
          const Icon = f.icon;
          return (
            <Card key={i} className="p-5">
              <div className="h-10 w-10 rounded-full bg-emerald-100 flex items-center justify-center mb-3">
                <Icon className="h-5 w-5 text-emerald-700" />
              </div>
              <h3 className="font-semibold mb-2">{f.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{f.text}</p>
            </Card>
          );
        })}
      </div>

      {/* ===== PRODUCTS ===== */}
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="font-display text-xl lg:text-2xl font-bold">
          Доступно сейчас
          <span className="text-muted-foreground text-sm font-normal ml-2">
            ({readyProducts.length} {readyProducts.length === 1 ? "товар" : "товаров"})
          </span>
        </h2>
        <button
          onClick={() => navigate("catalog")}
          className="text-sm text-primary hover:underline"
        >
          Смотреть весь каталог →
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {readyProducts.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>

      {readyProducts.length === 0 && (
        <Card className="p-12 text-center">
          <Cake className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
          <h3 className="font-semibold mb-2">Пока нет готовых изделий</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Все торты готовятся под заказ. Загляните позже или закажите торт
            через конструктор — срок изготовления 2–5 дней.
          </p>
          <Button onClick={() => navigate("catalog")}>Перейти в каталог</Button>
        </Card>
      )}

      {/* ===== HOW IT WORKS ===== */}
      <Card className="p-6 lg:p-8 mt-8 bg-emerald-50/50 border-emerald-200">
        <h2 className="font-display text-xl lg:text-2xl font-bold mb-4">Как это работает</h2>
        <div className="grid sm:grid-cols-4 gap-4">
          {[
            { num: "1", title: "Выберите торт", text: "Из каталога готовых изделий. Все торты уже приготовлены и ждут." },
            { num: "2", title: "Оплатите онлайн", text: "Картой, СБП или наличными при получении. Деньги на эскроу 24 часа." },
            { num: "3", title: "Доставка сегодня", text: "По Москве — курьер в день заказа. По России — СДЭК 1–2 дня." },
            { num: "4", title: "Подтвердите получение", text: "Чек и эскроу-период 24 часа. Если что-то не так — откройте спор." },
          ].map((step) => (
            <div key={step.num} className="relative">
              <div className="h-10 w-10 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-lg mb-3">
                {step.num}
              </div>
              <h3 className="font-semibold text-sm mb-1">{step.title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">{step.text}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

export function TendersPage() {
  const navigate = useAppStore((s) => s.navigate);
  const [showForm, setShowForm] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>("all");

  const categories = [
    { id: "all", label: "Все тендеры" },
    { id: "wedding", label: "Свадьбы" },
    { id: "corporate", label: "Корпоративы" },
    { id: "event", label: "Ивенты" },
    { id: "private", label: "Частные" },
    { id: "holiday", label: "Праздники" },
  ];

  const tenders = [
    {
      id: "t1",
      title: "Свадебный торт на 100 человек",
      company: "Семья Ивановых",
      city: "Москва",
      budget: "30 000 — 50 000 ₽",
      deadline: "2026-07-20",
      responses: 8,
      category: "wedding",
      description: "Ищем кондитера для свадебного торта на 100 человек. 3 яруса, белый с золотом, свежие цветы. Нужна дегустация 2-3 начинок. Доставка в центр Москвы 20 июля, установка с 14:00.",
      postedAt: "2 часа назад",
      isHot: true,
    },
    {
      id: "t2",
      title: "Корпоративные капкейки на 200 шт",
      company: "ООО «Технополис»",
      city: "Москва",
      budget: "20 000 — 35 000 ₽",
      deadline: "2026-07-15",
      responses: 12,
      category: "corporate",
      description: "Корпоративный заказ на 200 капкейков с логотипом компании (печать на вафельной бумаге). Доставка в офис на Кутузовском 20 июля к 10:00. Оплата по счёту с НДС.",
      postedAt: "5 часов назад",
      isHot: true,
    },
    {
      id: "t3",
      title: "Торты для ивента 5 шт",
      company: "Event-агентство «Праздник»",
      city: "Санкт-Петербург",
      budget: "40 000 — 60 000 ₽",
      deadline: "2026-08-01",
      responses: 5,
      category: "event",
      description: "5 разных тортов для гастрономического фестиваля «Вкус России». Тематика — русская кухня: медовик, наполеон, прага, птичье молоко, киевский. Каждый торт на 30-40 порций.",
      postedAt: "1 день назад",
      isHot: false,
    },
    {
      id: "t4",
      title: "Торт на день рождения ребёнка (Дракон)",
      company: "Семья Петровых",
      city: "Казань",
      budget: "8 000 — 15 000 ₽",
      deadline: "2026-07-10",
      responses: 4,
      category: "private",
      description: "Торт на 6 лет сыну в тематике драконов. 2 кг, фото-референт прилагается. Начинка — шоколад + вишня. Самовывоз или доставка в Советский район Казани.",
      postedAt: "1 день назад",
      isHot: false,
    },
    {
      id: "t5",
      title: "Праздничные наборы к 8 марта (50 боксов)",
      company: "ООО «Женский клуб»",
      city: "Екатеринбург",
      budget: "50 000 — 80 000 ₽",
      deadline: "2026-03-05",
      responses: 7,
      category: "holiday",
      description: "50 подарочных боксов к 8 марта: макаронс (3 шт), шоколадные конфеты (5 шт), мини-торт (300г). Фирменная упаковка с лентой. Доставка 5 марта до 18:00.",
      postedAt: "2 дня назад",
      isHot: false,
    },
    {
      id: "t6",
      title: "Бенто-торты на корпоратив (30 шт)",
      company: "IT-компания «Код»",
      city: "Новосибирск",
      budget: "25 000 — 40 000 ₽",
      deadline: "2026-07-25",
      responses: 6,
      category: "corporate",
      description: "30 бенто-тортов с поздравительными надписями для сотрудников. Дизайн — минимализм, пастельные тона. 4 разных начинки. Доставка в офис 25 июля к 12:00.",
      postedAt: "3 дня назад",
      isHot: false,
    },
    {
      id: "t7",
      title: "Торт-цифра на юбилей (60 лет)",
      company: "Семья Сидоровых",
      city: "Краснодар",
      budget: "12 000 — 20 000 ₽",
      deadline: "2026-07-18",
      responses: 3,
      category: "private",
      description: "Торт в форме цифр «60», 4 кг. Зеркальная глазурь, золотистый декор. Начинка — сникерс (арахис + карамель). Доставка в центр Краснодара 18 июля к 19:00.",
      postedAt: "3 дня назад",
      isHot: false,
    },
    {
      id: "t8",
      title: "Десерт-бар на конференцию 300 человек",
      company: "Конференция «Цифровой маркетинг 2026»",
      city: "Москва",
      budget: "80 000 — 150 000 ₽",
      deadline: "2026-09-15",
      responses: 9,
      category: "event",
      description: "Десерт-бар на 300 гостей: мини-пирожные (5 видов), макаронс (4 вкуса), шоколадные трюфели, фруктовые тарталетки. Брендирование под спонсора. Установка 15 сентября с 8:00.",
      postedAt: "4 дня назад",
      isHot: true,
    },
  ];

  const filteredTenders = activeCategory === "all"
    ? tenders
    : tenders.filter(t => t.category === activeCategory);

  return (
    <div className="container mx-auto px-4 py-6 lg:py-10 max-w-6xl">
      {/* ===== HERO ===== */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6">
        <div>
          <Badge className="mb-3 bg-purple-100 text-purple-800 border-purple-200">
            <TrendingUp className="h-3 w-3 mr-1" />
            Тендеры
          </Badge>
          <h1 className="font-display text-2xl lg:text-4xl font-bold mb-2">
            Тендеры на кондитерские изделия
          </h1>
          <p className="text-muted-foreground text-lg max-w-2xl">
            Корпоративные и частные заказы большого объёма. Откликайтесь на
            тендеры и получайте крупные заказы от проверенных заказчиков.
          </p>
        </div>
        <Button onClick={() => setShowForm(!showForm)} size="lg">
          {showForm ? "Скрыть форму" : "+ Создать тендер"}
        </Button>
      </div>

      {/* ===== STATS ===== */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {[
          { label: "Активных тендеров", value: tenders.length, icon: TrendingUp },
          { label: "Откликов сегодня", value: 47, icon: Users },
          { label: "Средний бюджет", value: "35 000 ₽", icon: CreditCard },
          { label: "Конверсия в заказ", value: "32%", icon: Award },
        ].map((s, i) => {
          const Icon = s.icon;
          return (
            <Card key={i} className="p-4 text-center">
              <Icon className="h-5 w-5 mx-auto mb-2 text-primary" />
              <div className="font-display text-xl lg:text-2xl font-bold">{s.value}</div>
              <div className="text-xs text-muted-foreground">{s.label}</div>
            </Card>
          );
        })}
      </div>

      {/* ===== CREATE FORM ===== */}
      {showForm && (
        <Card className="p-6 mb-6 border-primary/30">
          <h3 className="font-display font-semibold mb-4 text-lg">Новый тендер</h3>
          <div className="grid sm:grid-cols-2 gap-3 mb-3">
            <div>
              <Label className="text-sm">Название тендера *</Label>
              <Input placeholder="Торт на свадьбу 100 чел." className="mt-1" />
            </div>
            <div>
              <Label className="text-sm">Город *</Label>
              <Input placeholder="Москва" className="mt-1" />
            </div>
            <div>
              <Label className="text-sm">Бюджет</Label>
              <Input placeholder="30 000 — 50 000 ₽" className="mt-1" />
            </div>
            <div>
              <Label className="text-sm">Срок исполнения *</Label>
              <Input type="date" className="mt-1" />
            </div>
            <div>
              <Label className="text-sm">Категория</Label>
              <select className="mt-1 w-full px-3 py-2 rounded-md border border-input bg-background text-sm">
                <option value="wedding">Свадьба</option>
                <option value="corporate">Корпоратив</option>
                <option value="event">Ивент</option>
                <option value="private">Частный заказ</option>
                <option value="holiday">Праздник</option>
              </select>
            </div>
            <div>
              <Label className="text-sm">Количество персон / штук</Label>
              <Input placeholder="100 человек / 200 шт" className="mt-1" />
            </div>
          </div>
          <div className="mb-3">
            <Label className="text-sm">Описание *</Label>
            <Textarea
              rows={4}
              placeholder="Подробно опишите, что нужно: тематика, дизайн, начинки, особенности доставки, бюджет..."
              className="mt-1"
            />
          </div>
          <div className="mb-4">
            <Label className="text-sm">Фото-референс (необязательно)</Label>
            <Input type="file" accept="image/*" multiple className="mt-1" />
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => {
                toast.success("Тендер создан!", {
                  description: "Кондитеры получат уведомление о новом тендере в течение 5 минут",
                });
                setShowForm(false);
              }}
            >
              Опубликовать тендер
            </Button>
            <Button variant="outline" onClick={() => setShowForm(false)}>
              Отмена
            </Button>
          </div>
        </Card>
      )}

      {/* ===== CATEGORY FILTERS ===== */}
      <div className="flex flex-wrap gap-2 mb-6">
        {categories.map(cat => {
          const isActive = activeCategory === cat.id;
          const count = cat.id === "all"
            ? tenders.length
            : tenders.filter(t => t.category === cat.id).length;
          return (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted hover:bg-muted/70 text-muted-foreground"
              }`}
            >
              {cat.label}
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                isActive ? "bg-primary-foreground/20" : "bg-background/70"
              }`}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* ===== TENDERS LIST ===== */}
      <div className="space-y-4">
        {filteredTenders.map((t) => (
          <Card key={t.id} className={`p-5 hover:shadow-lg transition-shadow ${t.isHot ? "border-purple-200 bg-purple-50/30" : ""}`}>
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  {t.isHot && (
                    <Badge className="bg-red-500/10 text-red-600 border-red-500/20">
                      🔥 Горячий
                    </Badge>
                  )}
                  <h3 className="font-display font-semibold text-lg">{t.title}</h3>
                  <Badge variant="secondary">{t.responses} откликов</Badge>
                </div>
                <p className="text-sm text-muted-foreground mb-3 leading-relaxed">{t.description}</p>
                <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Users className="h-4 w-4" />
                    {t.company}
                  </span>
                  <span className="flex items-center gap-1">
                    <MapPin className="h-4 w-4" />
                    {t.city}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-4 w-4" />
                    до {t.deadline}
                  </span>
                  <span className="flex items-center gap-1 text-xs">
                    опубликован {t.postedAt}
                  </span>
                </div>
              </div>
              <div className="text-right shrink-0 sm:min-w-[140px]">
                <div className="text-xs text-muted-foreground">Бюджет</div>
                <div className="font-display font-bold text-lg mb-2">{t.budget}</div>
                <Button size="sm" className="w-full">
                  Откликнуться
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* ===== INFO ===== */}
      <Card className="p-6 mt-8 bg-primary/5 border-primary/20">
        <h2 className="font-display text-xl font-bold mb-3">Как работают тендеры</h2>
        <div className="grid sm:grid-cols-3 gap-4">
          {[
            { num: "1", title: "Опубликуйте тендер", text: "Опишите подробно, что нужно. Приложите фото-референс, укажите бюджет и сроки. Это бесплатно." },
            { num: "2", title: "Получайте отклики", text: "Кондитеры присылают предложения с ценой, портфолио и условиями. Обычно 5–15 откликов в течение 24 часов." },
            { num: "3", title: "Выберите исполнителя", text: "Сравните отклики, посмотрите портфолио, пообщайтесь в чате. Выберите лучшего и заключите сделку через эскроу." },
          ].map((step) => (
            <div key={step.num} className="flex items-start gap-3">
              <div className="h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm shrink-0">
                {step.num}
              </div>
              <div>
                <div className="font-semibold text-sm mb-1">{step.title}</div>
                <div className="text-xs text-muted-foreground leading-relaxed">{step.text}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

export function BlogPage() {
  const [activeCategory, setActiveCategory] = useState<string>("all");

  const categories = [
    { id: "all", label: "Все" },
    { id: "Советы", label: "Советы" },
    { id: "Тренды", label: "Тренды" },
    { id: "Бизнес", label: "Бизнес" },
    { id: "Рецепты", label: "Рецепты" },
    { id: "Кейсы", label: "Кейсы" },
  ];

  const posts = [
    {
      id: "b1",
      title: "Как выбрать идеальный торт на свадьбу: 7 главных советов",
      excerpt:
        "Разбираемся в трендах свадебных тортов 2026 года: от классики до минимализма. Что учитывать при заказе, как рассчитать вес, какие начинки выбрать и как сохранить торт до подачи.",
      image: "https://images.unsplash.com/photo-1464349095431-e9a21285b5f3?w=800",
      author: "Мария Уездная",
      authorAvatar: "МУ",
      date: "2026-06-25",
      readTime: "5 мин",
      category: "Советы",
      featured: true,
    },
    {
      id: "b2",
      title: "5 трендов кондитерского искусства в 2026 году",
      excerpt:
        "Зеркальная глазурь, бенто-торты, живые цветы на тортах, гиперреализм и минимализм — что в моде, а что уже ушло. Обзор по итогам выставки Sweets & Bakers Expo 2026.",
      image: "https://images.unsplash.com/photo-1535141192574-5d4897c12636?w=800",
      author: "Татьяна Сахарова",
      authorAvatar: "ТС",
      date: "2026-06-20",
      readTime: "7 мин",
      category: "Тренды",
      featured: true,
    },
    {
      id: "b3",
      title: "Как стать самозанятым кондитером: пошаговая инструкция",
      excerpt:
        "Регистрация НПД через приложение «Мой налог», налоговые ставки 4% и 6%, отчётность, лимиты. Полное руководство для начинающих кондитеров с примерами расчётов и типичными ошибками.",
      image: "https://images.unsplash.com/photo-1565958011703-44f9829ba187?w=800",
      author: "Команда Уездного",
      authorAvatar: "УК",
      date: "2026-06-15",
      readTime: "10 мин",
      category: "Бизнес",
      featured: false,
    },
    {
      id: "b4",
      title: "Бисквит: секреты идеальной выпечки",
      excerpt:
        "Температура ингредиентов, время взбивания, режим выпекания, влажность. Раскрываем секреты кондитеров-мастеров, чтобы ваш бисквит всегда получался воздушным и равномерным.",
      image: "https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=800",
      author: "Мария Уездная",
      authorAvatar: "МУ",
      date: "2026-06-10",
      readTime: "8 мин",
      category: "Рецепты",
      featured: false,
    },
    {
      id: "b5",
      title: "Кейс: как Анна из Казани выросла с 2 до 25 заказов в неделю",
      excerpt:
        "История кондитера Анны Сладковой, которая за 8 месяцев на платформе увеличила доход в 12 раз. Разбор стратегии: фотоконтент, конструктор тортов, отзывы и работа с постоянными клиентами.",
      image: "https://images.unsplash.com/photo-1486427944299-d1955d23e34d?w=800",
      author: "Команда Уездного",
      authorAvatar: "УК",
      date: "2026-06-05",
      readTime: "12 мин",
      category: "Кейсы",
      featured: false,
    },
    {
      id: "b6",
      title: "Чем заменить сахар в ПП-десертах: 7 натуральных подсластителей",
      excerpt:
        "Стевия, эритрит, сироп топинамбура, финиковый сахар — разбираем плюсы и минусы каждого. Как сохранить вкус и текстуру десерта без сахара. Рецепты и расчёт калорийности.",
      image: "https://images.unsplash.com/photo-1551024506-0bccd828d307?w=800",
      author: "Дарья Тортова",
      authorAvatar: "ДТ",
      date: "2026-05-30",
      readTime: "9 мин",
      category: "Рецепты",
      featured: false,
    },
    {
      id: "b7",
      title: "Корпоративные заказы: как оформить договор и получить оплату",
      excerpt:
        "Юридическое сопровождение B2B-заказов на платформе: договор, счёт, акт, УПД. Как работать с НДС и без. Сроки оплаты, отсрочка, типичные проблемы с бухгалтерией заказчика.",
      image: "https://images.unsplash.com/photo-1556742049-0cfbed4d5fc7?w=800",
      author: "Игорь Печкин",
      authorAvatar: "ИП",
      date: "2026-05-25",
      readTime: "11 мин",
      category: "Бизнес",
      featured: false,
    },
    {
      id: "b8",
      title: "Доставка тортов по России: упаковка, хладоэлементы, страхование",
      excerpt:
        "Как упаковывают торты для отправки СДЭК и Boxberry. Термопакеты, хладоэлементы, ложементы. Зимой — подогрев, летом — охлаждение. Страхование и что делать при повреждении.",
      image: "https://images.unsplash.com/photo-1565958011703-44f9829ba187?w=800",
      author: "Сергей Глазуров",
      authorAvatar: "СГ",
      date: "2026-05-20",
      readTime: "6 мин",
      category: "Советы",
      featured: false,
    },
    {
      id: "b9",
      title: "AI-конструктор тортов: как мы обучали LLM на 10 000 заказов",
      excerpt:
        "Технический кейс: как команда «Уездного кондитера» обучала GLM-4 подбирать начинки и декор по описанию. Датасет, промпт-инжиниринг, метрики качества, A/B-тестирование.",
      image: "https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=800",
      author: "Артем Бисквитов",
      authorAvatar: "АБ",
      date: "2026-05-15",
      readTime: "15 мин",
      category: "Кейсы",
      featured: false,
    },
  ];

  const featuredPosts = posts.filter(p => p.featured);
  const filteredPosts = activeCategory === "all"
    ? posts
    : posts.filter(p => p.category === activeCategory);

  return (
    <div className="container mx-auto px-4 py-6 lg:py-10 max-w-6xl">
      {/* ===== HERO ===== */}
      <div className="mb-8">
        <Badge className="mb-3 bg-primary/10 text-primary border-primary/20">
          <Sparkles className="h-3 w-3 mr-1" />
          Блог
        </Badge>
        <h1 className="font-display text-3xl lg:text-5xl font-bold mb-3">
          Блог «Уездного кондитера»
        </h1>
        <p className="text-muted-foreground text-lg max-w-2xl">
          Статьи о кондитерском искусстве, советы мастерам, рецепты, тренды и
          бизнес-кейсы. Обновляем еженедельно — подпишитесь на рассылку, чтобы
          не пропустить новые публикации.
        </p>
      </div>

      {/* ===== FEATURED POSTS ===== */}
      {activeCategory === "all" && featuredPosts.length > 0 && (
        <div className="mb-10">
          <h2 className="font-display text-xl font-bold mb-4 flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            Рекомендуем
          </h2>
          <div className="grid lg:grid-cols-2 gap-6">
            {featuredPosts.map((post) => (
              <Card key={post.id} className="overflow-hidden p-0 hover:shadow-xl transition-all cursor-pointer group">
                <div className="aspect-[16/9] bg-muted overflow-hidden">
                  <img
                    src={post.image}
                    alt={post.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    loading="lazy"
                    decoding="async"
                  />
                </div>
                <div className="p-6">
                  <div className="flex items-center gap-2 mb-3">
                    <Badge className="bg-primary text-primary-foreground">Рекомендуем</Badge>
                    <Badge variant="secondary">{post.category}</Badge>
                  </div>
                  <h3 className="font-display text-xl lg:text-2xl font-bold mb-3 leading-snug group-hover:text-primary transition-colors">
                    {post.title}
                  </h3>
                  <p className="text-muted-foreground leading-relaxed mb-4 line-clamp-2">
                    {post.excerpt}
                  </p>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                          {post.authorAvatar}
                        </AvatarFallback>
                      </Avatar>
                      <div className="text-xs">
                        <div className="font-medium">{post.author}</div>
                        <div className="text-muted-foreground">{post.date} • {post.readTime}</div>
                      </div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* ===== CATEGORY FILTERS ===== */}
      <div className="flex flex-wrap gap-2 mb-6">
        {categories.map(cat => {
          const isActive = activeCategory === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted hover:bg-muted/70 text-muted-foreground"
              }`}
            >
              {cat.label}
            </button>
          );
        })}
      </div>

      {/* ===== ALL POSTS GRID ===== */}
      <h2 className="font-display text-xl font-bold mb-4">
        {activeCategory === "all" ? "Все статьи" : categories.find(c => c.id === activeCategory)?.label}
        <span className="text-muted-foreground text-sm font-normal ml-2">({filteredPosts.length})</span>
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-10">
        {filteredPosts.map((post) => (
          <Card key={post.id} className="overflow-hidden p-0 hover:shadow-lg transition-all cursor-pointer group flex flex-col">
            <div className="aspect-video bg-muted overflow-hidden">
              <img
                src={post.image}
                alt={post.title}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                loading="lazy"
                decoding="async"
              />
            </div>
            <div className="p-5 flex-1 flex flex-col">
              <Badge variant="secondary" className="mb-3 self-start">
                {post.category}
              </Badge>
              <h3 className="font-display font-semibold mb-2 line-clamp-2 group-hover:text-primary transition-colors">
                {post.title}
              </h3>
              <p className="text-sm text-muted-foreground line-clamp-3 mb-4 flex-1">
                {post.excerpt}
              </p>
              <div className="flex items-center justify-between text-xs text-muted-foreground pt-3 border-t border-border">
                <span className="font-medium text-foreground/80">{post.author}</span>
                <span>{post.date} • {post.readTime}</span>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* ===== NEWSLETTER ===== */}
      <Card className="p-6 lg:p-8 bg-gradient-to-br from-primary/5 to-transparent border-primary/20 text-center">
        <h2 className="font-display text-xl lg:text-2xl font-bold mb-2">Подпишитесь на рассылку</h2>
        <p className="text-muted-foreground mb-6 max-w-xl mx-auto">
          Раз в неделю — лучшие статьи, новые рецепты, тренды и кейсы кондитеров.
          Никакого спама, только полезный контент. Отписка в один клик.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            toast.success("Подписка оформлена!", { description: "Письмо с подтверждением отправлено на ваш email" });
          }}
          className="flex flex-col sm:flex-row gap-2 max-w-md mx-auto"
        >
          <Input
            type="email"
            placeholder="your@email.com"
            required
            className="flex-1"
          />
          <Button type="submit">
            Подписаться
          </Button>
        </form>
        <p className="text-xs text-muted-foreground mt-3">
          Нажимая «Подписаться», вы соглашаетесь с политикой конфиденциальности (152-ФЗ).
        </p>
      </Card>
    </div>
  );
}

export function AboutPage() {
  return (
    <div className="container mx-auto px-4 py-6 lg:py-10 max-w-5xl">
      {/* ===== HERO ===== */}
      <div className="text-center mb-12">
        <Badge className="mb-3 bg-primary/10 text-primary border-primary/20">
          <Sparkles className="h-3 w-3 mr-1" />
          О платформе
        </Badge>
        <h1 className="font-display text-3xl lg:text-5xl font-bold mb-3">
          Уездный кондитер
        </h1>
        <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
          Маркетплейс кондитерских изделий от домашних кондитеров и
          кондитерских ателье по всей России. Соединяем талант с покупателями,
          ценящими ручную работу и натуральные ингредиенты.
        </p>
      </div>

      {/* ===== МИSSION ===== */}
      <Card className="p-6 lg:p-8 mb-8 bg-gradient-to-br from-primary/5 to-transparent border-primary/20">
        <div className="flex items-start gap-4 mb-4">
          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Sparkles className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h2 className="font-display text-xl lg:text-2xl font-bold mb-2">Наша миссия</h2>
            <p className="text-muted-foreground leading-relaxed">
              Мы создали платформу, которая объединяет талантливых кондитеров из
              разных уголков России с покупателями, ценящими ручную работу и
              натуральные ингредиенты. Уездный кондитер — это не просто
              маркетплейс, это экосистема, где каждый может найти своего
              кондитера, заказать уникальный торт и наслаждаться качеством
              домашней выпечки. Мы верим, что за каждым тортом стоит история, и
              помогаем этим историям случаться.
            </p>
            <p className="text-muted-foreground leading-relaxed mt-3">
              Каждая кондитерская — это маленькое ателье со своим почерком,
              фирменными рецептами и авторским стилем. Большая индустрия
              не видит этих мастеров, а мы делаем их видимыми. Покупатели
              получают доступ к уникальным изделиям, которые не найти в
              супермаркете, а кондитеры — инструмент для развития своего
              малого дела без посредников и бюрократии.
            </p>
          </div>
        </div>
      </Card>

      {/* ===== STATS ===== */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { val: "2 400+", label: "Активных кондитеров", icon: Users, hint: "из 190 городов России" },
          { val: "18 000+", label: "Товаров в каталоге", icon: Cake, hint: "торты, десерты, ПП-изделия" },
          { val: "120 000+", label: "Выполненных заказов", icon: Truck, hint: "за 2024 год" },
          { val: "4.8 ★", label: "Средний рейтинг", icon: Award, hint: "по 89 000+ отзывам" },
        ].map((s, i) => {
          const Icon = s.icon;
          return (
            <Card key={i} className="p-5 text-center hover:shadow-lg transition-shadow">
              <Icon className="h-7 w-7 mx-auto mb-3 text-primary" />
              <div className="font-display text-2xl lg:text-3xl font-bold">{s.val}</div>
              <div className="text-sm font-medium mt-1">{s.label}</div>
              <div className="text-xs text-muted-foreground mt-1">{s.hint}</div>
            </Card>
          );
        })}
      </div>

      {/* ===== HISTORY TIMELINE ===== */}
      <Card className="p-6 lg:p-8 mb-8">
        <h2 className="font-display text-xl lg:text-2xl font-bold mb-2">История проекта</h2>
        <p className="text-muted-foreground mb-6">
          От идеи в telegram-чате до маркетплейса национального масштаба —
          ключевые вехи за три года работы.
        </p>
        <div className="relative border-l-2 border-primary/20 pl-6 space-y-6 ml-2">
          {[
            {
              date: "Январь 2023",
              title: "Идея и первые 50 кондитеров",
              text: "Основательница Анна Уездная запустила telegram-канал с подборкой домашних кондитеров Москвы. Через месяц — 50 мастеров, 200 заказов, осознание: нужен маркетплейс.",
            },
            {
              date: "Июнь 2023",
              title: "MVP и первые 1 000 заказов",
              text: "Запустили первую версию платформы на Next.js + Supabase. Эскроу-счета, конструктор тортов, верификация кондитеров через DaData. За лето — 1 000 заказов и первый раунд инвестиций.",
            },
            {
              date: "Декабрь 2023",
              title: "Федеральная экспансия",
              text: "Открылись в 60 городах России. Запустили доставку через СДЭК и Boxberry, интеграцию с «Мой налог» для самозанятых, программу лояльности с 4 уровнями.",
            },
            {
              date: "Май 2024",
              title: "AI-консультант и видеолента",
              text: "Запустили AI-подбор торта по описанию, VLM-визуальный поиск по фото, видеоленту в стиле Reels с работами кондитеров. Конверсия в заказ выросла на 34%.",
            },
            {
              date: "Сентябрь 2024",
              title: "B2B-направление и тендеры",
              text: "Корпоративные заказы, тендеры на банкеты, подарочные сертификаты для юрлиц. Оборот платформы превысил 280 млн ₽ за квартал.",
            },
            {
              date: "Февраль 2025",
              title: "2 400+ кондитеров и 190 городов",
              text: "Стали крупнейшим в России маркетплейсом домашних кондитеров. Запустили франчайзинговую сеть пунктов выдачи в 40 городах, пилот экосистемы «кондитер-поставщик-логистика».",
            },
          ].map((m, i) => (
            <div key={i} className="relative">
              <div className="absolute -left-[31px] top-1 h-4 w-4 rounded-full bg-primary border-4 border-background" />
              <div className="text-xs text-primary font-medium uppercase tracking-wide">{m.date}</div>
              <h3 className="font-semibold mt-1 mb-1">{m.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{m.text}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* ===== TARIFFS ===== */}
      <Card className="p-6 lg:p-8 mb-8">
        <h2 className="font-display text-xl lg:text-2xl font-bold mb-2">Тарифы для кондитеров</h2>
        <p className="text-muted-foreground mb-6">
          Выберите подходящий тариф. Комиссия включает все платежи и услуги
          платформы — эквайринг, эскроу, налоговую отчётность, поддержку.
          Смена тарифа — в любой момент в личном кабинете.
        </p>
        <div className="grid sm:grid-cols-3 gap-4">
          {Object.entries(TARIFFS).map(([key, t]) => (
            <Card key={key} className="p-5 border-2 hover:border-primary/40 hover:shadow-lg transition-all">
              <div className="font-display font-bold text-lg mb-1">{t.name}</div>
              <div className="text-3xl font-bold text-primary mb-1">
                {Math.round(t.commission * 100)}%
              </div>
              <div className="text-xs text-muted-foreground mb-3">
                комиссия + {Math.round(t.yookassa * 100)}% YooKassa
              </div>
              {t.monthly > 0 && (
                <div className="text-sm font-medium mb-3">
                  + {formatCurrency(t.monthly)} / мес
                </div>
              )}
              <ul className="space-y-1.5 text-xs">
                {t.benefits.map((b) => (
                  <li key={b} className="flex items-start gap-1.5">
                    <Award className="h-3 w-3 text-primary shrink-0 mt-0.5" />
                    {b}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      </Card>

      {/* ===== VALUES ===== */}
      <Card className="p-6 lg:p-8 mb-8">
        <h2 className="font-display text-xl lg:text-2xl font-bold mb-2">Наши ценности</h2>
        <p className="text-muted-foreground mb-6">
          Шесть принципов, на которых построена платформа — от эскроу до
          социальной миссии поддержки малых производителей.
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            {
              icon: ShieldCheck,
              title: "Безопасность сделок",
              text: "Эскроу-счета с холдированием 24 часа после доставки, верификация кондитеров через DaData, защита персональных данных по 152-ФЗ. Спор разрешается в течение 24 часов.",
            },
            {
              icon: Award,
              title: "Качество и репутация",
              text: "Только проверенные кондитеры с рейтингом 4.5+ и рецензируемым портфолио. Системы доверия: NEW → VERIFIED → MASTER → EXPERT. Ежемесячная переаттестация.",
            },
            {
              icon: CreditCard,
              title: "Прозрачность финансов",
              text: "Честное ценообразование, понятные комиссии (15–25% всё включено), полная налоговая отчётность для самозанятых и ИП через интеграцию с «Мой налог».",
            },
            {
              icon: Users,
              title: "Сообщество ценителей",
              text: "Социальный канал с работами кондитеров, отзывы с фото, подписки на мастеров, видеолента в стиле Reels — строим живое сообщество ценителей ремесла.",
            },
            {
              icon: Truck,
              title: "Доступность по всей России",
              text: "Доставка по всей России (СДЭК, Boxberry, Яндекс Доставка), самовывоз, ПВЗ в 40 городах. Региональное ценообразование с учётом местных зарплат.",
            },
            {
              icon: Sparkles,
              title: "Инновации и автоматизация",
              text: "AI-конструктор тортов, VLM визуальный поиск, n8n-автоматизация (брошенная корзина, дайджест), аналитика продаж — постоянное развитие продукта.",
            },
          ].map((v, i) => {
            const Icon = v.icon;
            return (
              <div key={i} className="p-5 border border-border rounded-lg hover:border-primary/30 hover:bg-accent/30 transition-all">
                <Icon className="h-8 w-8 text-primary mb-3" />
                <div className="font-semibold mb-2">{v.title}</div>
                <div className="text-sm text-muted-foreground leading-relaxed">{v.text}</div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* ===== TEAM ===== */}
      <Card className="p-6 lg:p-8 mb-8">
        <h2 className="font-display text-xl lg:text-2xl font-bold mb-2">Команда</h2>
        <p className="text-muted-foreground mb-6">
          18 человек, которые каждый день делают так, чтобы торты доходили
          до покупателей, а кондитеры — до своей аудитории.
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { name: "Анна Уездная", role: "CEO и основатель", bio: "Кондитер с 8-летним стажем, ex-маркетинг SberMarket" },
            { name: "Дмитрий Карамов", role: "CTO", bio: "ex-Tech Lead Авито, 12 лет в e-commerce" },
            { name: "Мария Захарова", role: "Head of Product", bio: "ex-Yandex.Eda, эксперт по foodtech" },
            { name: "Игорь Печкин", role: "Lead Backend", bio: "Supabase & PostgreSQL, архитектор эскроу" },
            { name: "Елена Сладкая", role: "Head of Support", bio: "24/7 поддержка, разрешение споров" },
            { name: "Артем Бисквитов", role: "ML Engineer", bio: "AI-консультант, VLM визуальный поиск" },
            { name: "Ольга Тортова", role: "Куратор кондитеров", bio: "Верификация, онбординг, обучение" },
            { name: "Сергей Глазуров", role: "DevOps", bio: "Docker, CI/CD, наблюдаемость" },
          ].map((m, i) => (
            <div key={i} className="text-center">
              <Avatar className="h-20 w-20 mx-auto mb-3">
                <AvatarImage src={`/team/avatar-${i + 1}.jpg`} />
                <AvatarFallback className="bg-primary/10 text-primary text-lg font-semibold">
                  {m.name.split(" ").map(n => n[0]).join("")}
                </AvatarFallback>
              </Avatar>
              <div className="font-semibold text-sm">{m.name}</div>
              <div className="text-xs text-primary font-medium mt-0.5">{m.role}</div>
              <div className="text-xs text-muted-foreground mt-1 leading-relaxed">{m.bio}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* ===== PRESS ===== */}
      <Card className="p-6 lg:p-8 mb-8">
        <h2 className="font-display text-xl lg:text-2xl font-bold mb-2">О нас пишут</h2>
        <p className="text-muted-foreground mb-6">
          Платформа получила признание в деловых и профильных СМИ.
          Вот несколько публикаций о нас.
        </p>
        <div className="grid sm:grid-cols-2 gap-4">
          {[
            {
              source: "Forbes Russia",
              date: "Октябрь 2024",
              title: "«Уездный кондитер»: как домохозяйки построили маркетплейс на 280 млн ₽",
              text: "Анна Уездная за два года превратила telegram-чат в федеральную платформу с 2 400 кондитерами в 190 городах. Секрет роста — эскроу и AI-подбор торта.",
            },
            {
              source: "РБК Daily",
              date: "Сентябрь 2024",
              title: "Foodtech после маркетплейсов: кто зарабатывает на домашних кондитерах",
              text: "Российский рынок домашних кондитеров оценивается в 12 млрд ₽. «Уездный кондитер» — лидер сегмента с долей 23% по данным аналитиков.",
            },
            {
              source: "Ведомости",
              date: "Август 2024",
              title: "AI в e-commerce: как «Уездный кондитер» увеличил конверсию на 34%",
              text: "Внедрение LLM-консультанта по подбору торта и VLM-поиска по фотографии дало +34% к конверсии в заказ и снизило возвраты на 18%.",
            },
            {
              source: "Habr",
              date: "Июль 2024",
              title: "Supabase в продакшене: 27 SQL RPC, 188 таблиц, 700+ тестов",
              text: "Технический разбор архитектуры «Уездного кондитера»: атомарные счётчики, идемпотентные вебхуки, RLS, индексы для 120k+ заказов.",
            },
          ].map((p, i) => (
            <div key={i} className="p-5 border border-border rounded-lg hover:border-primary/30 transition-colors">
              <div className="flex items-center justify-between mb-2">
                <Badge variant="secondary" className="text-xs">{p.source}</Badge>
                <span className="text-xs text-muted-foreground">{p.date}</span>
              </div>
              <h3 className="font-semibold text-sm mb-2 leading-snug">{p.title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">{p.text}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* ===== TECH STACK ===== */}
      <Card className="p-6 lg:p-8 mb-8">
        <h2 className="font-display text-xl lg:text-2xl font-bold mb-2">Технологический стек</h2>
        <p className="text-muted-foreground mb-6">
          Мы используем современный open-source стек: 100% TypeScript, PostgreSQL,
          Supabase. Никаких проприетарных CMS — только our own code.
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { layer: "Frontend", tech: "Next.js 16, React 19, TypeScript 5.7, Tailwind CSS 4, shadcn/ui" },
            { layer: "Backend", tech: "Next.js API Routes (216 endpoints), Node.js 24, Edge Functions" },
            { layer: "Database", tech: "PostgreSQL 18, Supabase, 188 таблиц, 27 SQL RPC функций" },
            { layer: "Auth & RLS", tech: "Supabase Auth, JWT, 2FA TOTP, Row-Level Security на 80+ таблиц" },
            { layer: "Search", tech: "Meilisearch, триграммный поиск (pg_trgm), GIN-индексы" },
            { layer: "Payments", tech: "YooKassa, СБП, 3-D Secure, идемпотентные вебхуки" },
            { layer: "AI", tech: "GLM-4 (LLM), VLM визуальный поиск, sentiment analysis, dialogue engine" },
            { layer: "Automation", tech: "n8n (брошенная корзина, дайджест, бонусы), Supabase Edge Functions" },
            { layer: "Infrastructure", tech: "Docker, Docker Compose, standalone Next.js build, Caddy reverse proxy" },
            { layer: "Observability", tech: "Sentry (errors), structured logging, health checks, audit log" },
            { layer: "Testing", tech: "Vitest (731 unit tests), Playwright (E2E), 26 test files" },
            { layer: "CI/CD", tech: "GitHub Actions, typecheck + lint + tests on every PR" },
          ].map((t, i) => (
            <div key={i} className="p-4 border border-border rounded-lg">
              <div className="text-xs text-primary font-medium uppercase tracking-wide mb-1">{t.layer}</div>
              <div className="text-sm leading-relaxed">{t.tech}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* ===== ROADMAP ===== */}
      <Card className="p-6 lg:p-8 mb-8">
        <h2 className="font-display text-xl lg:text-2xl font-bold mb-2">Дорожная карта 2025–2026</h2>
        <p className="text-muted-foreground mb-6">
          Что мы уже делаем и что планируем запустить в ближайшие 6–12 месяцев.
        </p>
        <div className="space-y-3">
          {[
            { quarter: "Q1 2025", title: "Мобильное приложение (iOS + Android)", status: "В разработке", text: "React Native + Expo, push-уведомления, PWA-режим, offline-корзина. Бета-тест с 200 кондитерами и 1 000 покупателей." },
            { quarter: "Q2 2025", title: "Маркетплейс ингредиентов «Уездный склад»", status: "Запланировано", text: "B2B-площадка для кондитеров: мука, шоколад, декор, ингредиенты с доставкой от 5 000 ₽. Эксклюзивные цены от поставщиков." },
            { quarter: "Q2 2025", title: "Telegram-бот с полным циклом заказа", status: "MVP готов", text: "Заказ торта, оплата, отслеживание доставки — всё внутри Telegram. Интеграция с SimpleX для приватных чатов с кондитером." },
            { quarter: "Q3 2025", title: "Обучающая платформа «Уездная школа»", status: "Запланировано", text: "Видеоуроки от мастеров, сертификация, программа наставничества. Роялти 5% авторам курсов через recipe_marketplace." },
            { quarter: "Q3 2025", title: "Франшиза пунктов выдачи в 100 городах", status: "Активно", text: "Сейчас 40 ПВЗ в 28 городах. К концу 2025 — 100 ПВЗ. Франчайзи получает 8% с заказов в своём городе." },
            { quarter: "Q4 2025", title: "Экспорт в страны СНГ", status: "Исследование", text: "Казахстан, Беларусь, Армения. Локализация на казахский, интеграция с местными платёжными системами." },
            { quarter: "Q1 2026", title: "AI-генератор дизайна торта", status: "В планах", text: "По описанию «торт для девочки-подростка в стиле киберпанк» — генерация изображения и подбор кондитера, способного воплотить." },
          ].map((r, i) => (
            <div key={i} className="flex items-start gap-4 p-4 border border-border rounded-lg hover:border-primary/30 transition-colors">
              <div className="shrink-0 w-24">
                <Badge variant="outline" className="text-xs">{r.quarter}</Badge>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-sm">{r.title}</h3>
                  <Badge className={
                    r.status === "В разработке" ? "bg-blue-500/10 text-blue-600 border-blue-500/20 text-xs" :
                    r.status === "MVP готов" ? "bg-green-500/10 text-green-600 border-green-500/20 text-xs" :
                    r.status === "Активно" ? "bg-purple-500/10 text-purple-600 border-purple-500/20 text-xs" :
                    r.status === "В планах" ? "bg-muted text-muted-foreground text-xs" :
                    "bg-amber-500/10 text-amber-600 border-amber-500/20 text-xs"
                  }>{r.status}</Badge>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed mt-1">{r.text}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* ===== CONTACT CTA ===== */}
      <Card className="p-6 lg:p-8 text-center bg-primary/5 border-primary/20">
        <h2 className="font-display text-xl lg:text-2xl font-bold mb-2">Хотите работать с нами?</h2>
        <p className="text-muted-foreground mb-6 max-w-xl mx-auto">
          Кондитер, поставщик, инвестор или журналист — напишите нам,
          и мы ответим в течение 24 часов.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <a href="mailto:hello@conditera.ru" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-sm font-medium">
            <Mail className="h-4 w-4" />
            hello@conditera.ru
          </a>
          <a href="tel:+78001234567" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border hover:bg-accent transition-colors text-sm font-medium">
            <Phone className="h-4 w-4" />
            8 (800) 123-45-67
          </a>
          <a href="/contacts" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border hover:bg-accent transition-colors text-sm font-medium">
            <MessageCircle className="h-4 w-4" />
            Все контакты
          </a>
        </div>
      </Card>
    </div>
  );
}


export function FaqPage() {
  const [activeCategory, setActiveCategory] = useState<string>("all");

  const categories = [
    { id: "all", label: "Все вопросы", icon: Sparkles },
    { id: "orders", label: "Заказы и оплата", icon: CreditCard },
    { id: "delivery", label: "Доставка", icon: Truck },
    { id: "confectioner", label: "Для кондитеров", icon: Cake },
    { id: "loyalty", label: "Лояльность и возвраты", icon: Award },
    { id: "tech", label: "Технологии и AI", icon: Zap },
  ];

  const faqs: { cat: string; q: string; a: string }[] = [
    // ── Заказы и оплата ──
    {
      cat: "orders",
      q: "Как сделать заказ на платформе?",
      a: "Выберите торт в каталоге или соберите свой через конструктор. Свяжитесь с кондитером через чат для уточнения деталей. Оплатите заказ — средства попадут на эскроу-счёт. После получения заказа и подтверждения средства перечислятся кондитеру. Весь процесс обычно занимает 5–10 минут от выбора до оплаты.",
    },
    {
      cat: "orders",
      q: "Что такое эскроу-счёт и как он работает?",
      a: "Эскроу — это промежуточный счёт, на котором средства холдируются 24 часа после доставки. Если что-то не так с заказом, вы можете открыть спор, и мы вернём деньги. Если всё в порядке, средства автоматически переводятся кондитеру. Эскроу защищает обе стороны: покупатель не рискует деньгами, а кондитер уверен в оплате.",
    },
    {
      cat: "orders",
      q: "Поддерживается ли оплата картой?",
      a: "Да, мы принимаем Visa, Mastercard, Мир, а также оплату через СБП. Платёжный шлюз — YooKassa. Все операции защищены по стандарту 3-D Secure. Для заказов от 5 000 ₽ доступна оплата частями (сплит) и рассрочка через Долями или Сбербанк.",
    },
    {
      cat: "orders",
      q: "Можно ли отменить заказ?",
      a: "Да, заказ можно отменить в статусе PENDING или CONFIRMED без объяснения причин. Если кондитер уже начал готовку (PREPARING), отмена возможна с удержанием части суммы за понесённые расходы — обычно 30% от стоимости. После доставки используйте эскроу-период (24 часа) для разрешения споров.",
    },
    {
      cat: "orders",
      q: "Какие способы оплаты доступны для юридических лиц?",
      a: "Для юрлиц доступна оплата по счёту-фактуре (с НДС или без НДС) с отсрочкой до 14 дней, а также корпоративные подарочные сертификаты. Минимальная сумма заказа для B2B — 15 000 ₽. Документы: договор, акт, счёт, УПД. Все документы формируются автоматически в личном кабинете.",
    },
    // ── Доставка ──
    {
      cat: "delivery",
      q: "Сколько стоит доставка?",
      a: "По Москве — от 300 рублей (бесплатно при заказе от 3 000 ₽). По России — СДЭК или Boxberry, стоимость рассчитывается при оформлении по тарифам перевозчика. Самовывоз от кондитера — бесплатно. В 28 городах есть пункты выдачи «Уездного кондитера» — от 150 ₽.",
    },
    {
      cat: "delivery",
      q: "Как быстро привозят торты?",
      a: "Срок изготовления зависит от кондитера и сложности торта — обычно 2–5 дней. Срочные заказы (за 24 часа) возможны у некоторых кондитеров с доплатой 20–30%. Доставка по Москве в день готовки — 2–4 часа. По России — 1–3 дня через СДЭК с термопакетом и хладоэлементами.",
    },
    {
      cat: "delivery",
      q: "Как упаковываются торты при доставке по России?",
      a: "Торты упаковываются в индивидуальные коробки из плотного картона с ложементом. Для доставки по России добавляется термопакет с хладоэлементами (зимой — подогрев). На коробке — маркировка «хрупкое» и «верх». Страхование включено в стоимость доставки. В случае повреждения — 100% возврат.",
    },
    {
      cat: "delivery",
      q: "Можно ли заказать доставку в определённое время?",
      a: "Да, при оформлении заказа можно выбрать интервал доставки (например, 14:00–16:00). Точное время согласуется с кондитером или логистом. По Москве доступна доставка с интервалом 1 час. Доставка в праздники (Новый год, 8 марта) — с наценкой 15%.",
    },
    // ── Для кондитеров ──
    {
      cat: "confectioner",
      q: "Как стать кондитером на платформе?",
      a: "Зарегистрируйтесь как кондитер, пройдите верификацию (паспорт, ИНН, для самозанятых — регистрация НПД). Заполните профиль, добавьте работы в портфолио (минимум 3 фото). После модерации (1–3 рабочих дня) вы сможете принимать заказы. Верификация ИП и ООО через DaData происходит автоматически за 5 минут.",
    },
    {
      cat: "confectioner",
      q: "Какие налоги платят кондитеры-самозанятые?",
      a: "НПД (налог на профессиональный доход): 4% с доходов от физических лиц, 6% с доходов от юридических лиц. При регистрации предоставляется вычет 10 000 рублей, снижающий ставки до 3% и 4% соответственно. Лимит дохода — 2.4 млн рублей в год. Платформа автоматически передаёт данные в «Мой налог» и формирует чеки.",
    },
    {
      cat: "confectioner",
      q: "Какие комиссии берёт платформа?",
      a: "Комиссия зависит от тарифа: START — 25%, BASIC — 20%, PREMIUM — 17%, BUSINESS — 15%. В комиссию включены: эквайринг YooKassa (2.8%), эскроу-сервис, поддержка, использование конструктора тортов. Дополнительно: PREMIUM — 990 ₽/мес, BUSINESS — 2 990 ₽/мес (расширенная аналитика, приоритет в выдаче).",
    },
    {
      cat: "confectioner",
      q: "Как часто происходят выплаты?",
      a: "Выплаты происходят автоматически 1–3 раза в неделю на банковскую карту, привязанную к профилю. Минимальная сумма выплаты — 1 000 ₽. После доставки заказа и истечения эскроу-периода (24 часа) средства попадают в баланс кондитера и выплачиваются в следующем цикле. История выплат доступна в личном кабинете.",
    },
    {
      cat: "confectioner",
      q: "Что такое уровни доверия NEW/VERIFIED/MASTER/EXPERT?",
      a: "Это система градации кондитеров. NEW — новый кондитер (после модерации). VERIFIED — подтвердил портфолио (10+ заказов, рейтинг 4.5+). MASTER — 100+ заказов, рейтинг 4.7+, ежегодная переаттестация. EXPERT — топ-50 в регионе, участие в тендерах, эксклюзивные кейсы. Выше уровень — выше приоритет в каталоге и доступ к VIP-заказам.",
    },
    // ── Лояльность и возвраты ──
    {
      cat: "loyalty",
      q: "Как работает программа лояльности?",
      a: "За каждые 100 рублей покупки начисляется 1 балл. Уровни: Бронзовый (базовый), Серебряный (от 5 000 ₽, скидка 3%), Золотой (от 15 000 ₽, скидка 5%), Платиновый (от 50 000 ₽, скидка 10%). Баллы можно тратить на оплату до 50% стоимости заказа. Дополнительно: приветственный бонус 500 баллов, бонус на день рождения 1 000 баллов.",
    },
    {
      cat: "loyalty",
      q: "Что делать, если заказ не устроил?",
      a: "В течение 24 часов после доставки откройте спор в личном кабинете. Опишите проблему, приложите фото (минимум 3 ракурса). Мы рассмотрим обращение в течение 24 часов и примем решение: полный возврат, частичная компенсация или переделка заказа. При подтверждении вины кондитера — возврат 100% + 500 баллов извинений.",
    },
    {
      cat: "loyalty",
      q: "Можно ли вернуть торт после доставки?",
      a: "Торты — скоропортящийся продукт питания, поэтому возврат в традиционном смысле невозможен. Однако в течение 24 часов вы можете открыть спор с фото/видео доказательствами. При подтверждении проблемы (несоответствие заказу, порча, нарушение сроков) — полный возврат через эскроу. Кондитер забирает торт курьером бесплатно.",
    },
    {
      cat: "loyalty",
      q: "Как работает реферальная программа?",
      a: "Пригласите друга по персональной ссылке — друг получит 500 ₽ на первый заказ, а вы — 300 баллов после его первого заказа от 2 000 ₽. Без ограничений на количество приглашений. Топ-рефералы (10+ активных друзей) получают статус Амбассадора с вечной скидкой 7% и эксклюзивными предложениями.",
    },
    // ── Технологии и AI ──
    {
      cat: "tech",
      q: "Как работает AI-конструктор тортов?",
      a: "Опишите желаемый торт словами («торт для девочки 5 лет в стиле принцессы Диснея, розовый, с бенто-декором»). LLM анализирует описание, подбирает подходящие начинки, покрытие, декор и рассчитывает стоимость. Конструктор предлагает 3 варианта — от бюджетного до премиум. Можно загрузить фото-референс и AI подберёт похожие работы кондитеров.",
    },
    {
      cat: "tech",
      q: "Что такое VLM визуальный поиск?",
      a: "Vision-Language Model анализирует загруженное изображение торта и находит похожие работы в каталоге. Полезно когда вы увидели торт в соцсетях и хотите заказать такой же. AI определяет стиль, цветовую гамму, технику декора и подбирает кондитеров, способных воспроизвести. Точность подбора — 87%.",
    },
    {
      cat: "tech",
      q: "Какие данные вы собираете и как защищаете?",
      a: "Мы собираем: email, телефон, адрес доставки, историю заказков. Данные хранятся в PostgreSQL с шифрованием на диске. Персональные данные — по 152-ФЗ. Платёжные данные обрабатываются YooKassa (PCI DSS Level 1). 2FA доступна для всех пользователей. Вы можете запросить экспорт/удаление данных через профиль.",
    },
    {
      cat: "tech",
      q: "Что такое эскроу с технической точки зрения?",
      a: "Эскроу реализован через 27 SQL RPC функций с SELECT FOR UPDATE блокировками. При оплате создаётся escrow_transaction с холдированием средств на 24 часа. После подтверждения доставки — автоматический релиз средств кондитеру. При споре — status='disputed', funds замораживаются до решения модератора. Все операции идемпотентны — двойные вебхуки YooKassa не приводят к двойным начислениям.",
    },
  ];

  const filteredFaqs = activeCategory === "all"
    ? faqs
    : faqs.filter(f => f.cat === activeCategory);

  return (
    <div className="container mx-auto px-4 py-6 lg:py-10 max-w-3xl">
      {/* ===== HERO ===== */}
      <div className="text-center mb-8">
        <Badge className="mb-3 bg-primary/10 text-primary border-primary/20">
          <MessageCircle className="h-3 w-3 mr-1" />
          Помощь
        </Badge>
        <h1 className="font-display text-2xl lg:text-4xl font-bold mb-3">
          Часто задаваемые вопросы
        </h1>
        <p className="text-muted-foreground text-lg max-w-xl mx-auto">
          20+ ответов на популярные вопросы покупателей и кондитеров.
          Не нашли ответ — напишите в чат поддержки.
        </p>
      </div>

      {/* ===== CATEGORY FILTERS ===== */}
      <div className="flex flex-wrap gap-2 mb-6 justify-center">
        {categories.map(cat => {
          const Icon = cat.icon;
          const isActive = activeCategory === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted hover:bg-muted/70 text-muted-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {cat.label}
            </button>
          );
        })}
      </div>

      {/* ===== FAQ LIST ===== */}
      <Card className="p-2">
        <Accordion type="single" collapsible className="w-full">
          {filteredFaqs.map((faq, i) => (
            <AccordionItem key={`${activeCategory}-${i}`} value={`item-${i}`} className="px-4">
              <AccordionTrigger className="text-left font-medium hover:no-underline">
                {faq.q}
              </AccordionTrigger>
              <AccordionContent className="text-muted-foreground leading-relaxed">
                {faq.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </Card>

      {/* ===== HELP CATEGORIES ===== */}
      <div className="grid sm:grid-cols-3 gap-3 mt-6">
        <a href="/contacts" className="block p-4 border border-border rounded-lg hover:border-primary/30 hover:bg-accent/30 transition-all">
          <Phone className="h-5 w-5 text-primary mb-2" />
          <div className="font-semibold text-sm mb-1">Звонок</div>
          <div className="text-xs text-muted-foreground">8 (800) 123-45-67, ежедневно 10–22</div>
        </a>
        <a href="mailto:hello@conditera.ru" className="block p-4 border border-border rounded-lg hover:border-primary/30 hover:bg-accent/30 transition-all">
          <Mail className="h-5 w-5 text-primary mb-2" />
          <div className="font-semibold text-sm mb-1">Email</div>
          <div className="text-xs text-muted-foreground">hello@conditera.ru, ответ за 24 часа</div>
        </a>
        <a href="/help" className="block p-4 border border-border rounded-lg hover:border-primary/30 hover:bg-accent/30 transition-all">
          <MessageCircle className="h-5 w-5 text-primary mb-2" />
          <div className="font-semibold text-sm mb-1">Чат на сайте</div>
          <div className="text-xs text-muted-foreground">Виджет в правом нижнем углу, 24/7</div>
        </a>
      </div>

      {/* ===== CTA ===== */}
      <Card className="p-6 mt-6 text-center bg-primary/5 border-primary/20">
        <MessageCircle className="h-10 w-10 text-primary mx-auto mb-2" />
        <h3 className="font-display font-semibold mb-1">Остались вопросы?</h3>
        <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
          Наша команда поддержки поможет вам. Среднее время ответа — 5 минут в чате,
          до 24 часов по email.
        </p>
        <div className="flex flex-wrap justify-center gap-4 text-sm">
          <a href="tel:+78001234567" className="flex items-center gap-1.5 text-primary hover:underline">
            <Phone className="h-4 w-4" />
            8 (800) 123-45-67
          </a>
          <a href="mailto:hello@conditera.ru" className="flex items-center gap-1.5 text-primary hover:underline">
            <Mail className="h-4 w-4" />
            hello@conditera.ru
          </a>
          <a href="/contacts" className="flex items-center gap-1.5 text-primary hover:underline">
            <ArrowRight className="h-4 w-4" />
            Все контакты
          </a>
        </div>
      </Card>
    </div>
  );
}

export function CheckoutPage() {
  const navigate = useAppStore((s) => s.navigate);
  const cart = useAppStore((s) => s.cart);
  const clearCart = useAppStore((s) => s.clearCart);
  const promoDiscount = useAppStore((s) => s.promoDiscount);
  const user = useAppStore((s) => s.user);
  const [step, setStep] = useState(1);
  const [paymentMethod, setPaymentMethod] = useState<"card" | "cash" | "split" | "installment">("card");
  const [selectedInstallmentPlan, setSelectedInstallmentPlan] = useState<string | null>(null);

  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const discount = Math.round(subtotal * promoDiscount);
  const deliveryCost = subtotal >= 3000 ? 0 : 300;
  const total = subtotal - discount + deliveryCost;

  if (cart.length === 0) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <h2 className="font-display text-2xl font-bold mb-2">Корзина пуста</h2>
        <p className="text-muted-foreground mb-4">
          Добавьте товары, чтобы оформить заказ
        </p>
        <Button onClick={() => navigate("catalog")}>В каталог</Button>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6 lg:py-10 max-w-5xl">
      <h1 className="font-display text-2xl lg:text-3xl font-bold mb-6">
        Оформление заказа
      </h1>

      {/* Steps */}
      <div className="flex items-center gap-2 mb-8">
        {["Доставка", "Оплата", "Готово"].map((s, i) => (
          <div key={s} className="flex items-center gap-2 flex-1">
            <div
              className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-medium ${
                step > i + 1
                  ? "bg-emerald-500 text-white"
                  : step === i + 1
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {step > i + 1 ? "✓" : i + 1}
            </div>
            <div className={`text-sm font-medium ${step >= i + 1 ? "text-foreground" : "text-muted-foreground"}`}>
              {s}
            </div>
            {i < 2 && <div className="flex-1 h-0.5 bg-border" />}
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-[1fr_360px] gap-6">
        {/* Main */}
        <div>
          {step === 1 && (
            <Card className="p-6 space-y-4">
              <h3 className="font-display font-semibold">Доставка</h3>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <Label>Имя</Label>
                  <Input defaultValue={user?.name} placeholder="Ваше имя" />
                </div>
                <div>
                  <Label>Телефон</Label>
                  <Input defaultValue={user?.phone} placeholder="+7 (___) ___-__-__" />
                </div>
              </div>
              <div>
                <Label>Адрес доставки</Label>
                <Input placeholder="Город, улица, дом, квартира" />
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <Label>Дата доставки</Label>
                  <Input type="date" />
                </div>
                <div>
                  <Label>Время</Label>
                  <Input placeholder="10:00-14:00" />
                </div>
              </div>
              <div>
                <Label>Комментарий курьеру</Label>
                <Textarea rows={2} placeholder="Позвонить за час, код домофона..." />
              </div>
              <Button onClick={() => setStep(2)} className="w-full">
                Продолжить
              </Button>
            </Card>
          )}

          {step === 2 && (
            <Card className="p-6 space-y-4">
              <h3 className="font-display font-semibold">Способ оплаты</h3>
              <div className="space-y-2">
                {[
                  { id: "card", label: "Банковской картой", desc: "Visa, Mastercard, Мир" },
                  { id: "cash", label: "Наличными при получении", desc: "Доступно при доставке курьером" },
                  { id: "split", label: "СБП — Система быстрых платежей", desc: "Перевод по QR-коду" },
                ].map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setPaymentMethod(m.id as any)}
                    className={`w-full text-left p-3 rounded-lg border-2 transition-colors ${
                      paymentMethod === m.id
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/40"
                    }`}
                  >
                    <div className="font-medium text-sm">{m.label}</div>
                    <div className="text-xs text-muted-foreground">{m.desc}</div>
                  </button>
                ))}

                {/* Опция рассрочки — показывается только если доступна */}
                {(() => {
                  // Проверяем, есть ли товары с рассрочкой
                  const confectioners = useAppStore.getState().confectioners;
                  const hasInstallment = cart.some((item) => {
                    const product = useAppStore.getState().products.find((p) => p.id === item.productId);
                    if (!product) return false;
                    const confectioner = confectioners.find((c) => c.id === product.confectionerId);
                    const opts = getProductPaymentOptions(product, confectioner);
                    return opts.installment;
                  });
                  if (!hasInstallment) return null;
                  return (
                    <button
                      onClick={() => setPaymentMethod("installment")}
                      className={`w-full text-left p-3 rounded-lg border-2 transition-colors ${
                        paymentMethod === "installment"
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/40"
                      }`}
                    >
                      <div className="font-medium text-sm flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-rose-600" />
                        Рассрочка
                        <Badge className="bg-rose-100 text-rose-800 text-[10px]">
                          0% или с переплатой
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Оплата частями: Сплит, Тинькофф, СберРассрочка
                      </div>
                    </button>
                  );
                })()}
              </div>

              {/* Carte details */}
              {paymentMethod === "card" && (
                <div className="space-y-3 pt-2">
                  <div>
                    <Label>Номер карты</Label>
                    <Input placeholder="0000 0000 0000 0000" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Срок</Label>
                      <Input placeholder="MM/YY" />
                    </div>
                    <div>
                      <Label>CVC</Label>
                      <Input placeholder="123" type="password" />
                    </div>
                  </div>
                </div>
              )}

              {/* Installment plan selection */}
              {paymentMethod === "installment" && (
                <div className="space-y-3 pt-2">
                  <Label>Выберите вариант рассрочки</Label>
                  <div className="space-y-2 max-h-72 overflow-y-auto">
                    {cart.flatMap((item) => {
                      const product = useAppStore.getState().products.find((p) => p.id === item.productId);
                      if (!product) return [];
                      const confectioner = useAppStore.getState().confectioners.find((c) => c.id === product.confectionerId);
                      const opts = getProductPaymentOptions(product, confectioner);
                      return opts.installments.map((plan) => {
                        const calc = calculateInstallmentPayment(item.price * item.quantity, plan);
                        const provider = INSTALLMENT_PROVIDERS[plan.provider];
                        return (
                          <button
                            key={`${item.productId}-${plan.id}`}
                            onClick={() => setSelectedInstallmentPlan(plan.id)}
                            className={`w-full text-left p-3 rounded-lg border-2 transition-colors ${
                              selectedInstallmentPlan === plan.id
                                ? "border-primary bg-primary/5"
                                : "border-border hover:border-primary/40"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2 mb-1">
                              <div className="flex items-center gap-1.5">
                                <span className="text-base">{provider?.icon || "📅"}</span>
                                <div>
                                  <div className="font-medium text-sm">{plan.name}</div>
                                  <div className="text-[10px] text-muted-foreground">{provider?.label}</div>
                                </div>
                              </div>
                              {plan.interestRate === 0 ? (
                                <Badge className="bg-emerald-500 text-white text-[10px]">0%</Badge>
                              ) : (
                                <Badge variant="outline" className="text-[10px]">+{plan.interestRate}%</Badge>
                              )}
                            </div>
                            <div className="grid grid-cols-3 gap-1 text-[10px]">
                              {calc.downPayment > 0 && (
                                <div>
                                  <div className="text-muted-foreground">Первый взнос</div>
                                  <div className="font-semibold">{formatCurrency(calc.downPayment)}</div>
                                </div>
                              )}
                              <div>
                                <div className="text-muted-foreground">В месяц</div>
                                <div className="font-semibold text-primary">{formatCurrency(calc.monthlyPayment)}</div>
                              </div>
                              <div>
                                <div className="text-muted-foreground">Всего</div>
                                <div className="font-semibold">{formatCurrency(calc.totalToPay)}</div>
                              </div>
                            </div>
                          </button>
                        );
                      });
                    })}
                  </div>
                  {selectedInstallmentPlan && (
                    <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs">
                      <div className="font-medium text-rose-800 mb-1">График платежей</div>
                      <div className="text-rose-700">
                        Сегодня спишется первый взнос, далее — ежемесячно равными долями.
                        Эскроу 24ч на всю сумму.
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep(1)} className="flex-1">
                  Назад
                </Button>
                <Button
                  onClick={() => {
                    if (paymentMethod === "installment" && !selectedInstallmentPlan) {
                      toast.error("Выберите вариант рассрочки");
                      return;
                    }
                    setStep(3);
                    toast.success("Заказ оформлен!", {
                      description:
                        paymentMethod === "installment"
                          ? "Рассрочка оформлена. Первый платёж списан, далее — ежемесячно."
                          : "Средства на эскроу-счёте. Холдирование 24 часа.",
                    });
                    setTimeout(() => {
                      clearCart();
                      navigate("dashboard-customer", { tab: "orders" });
                    }, 2500);
                  }}
                  className="flex-1"
                  disabled={paymentMethod === "installment" && !selectedInstallmentPlan}
                >
                  {paymentMethod === "installment" ? "Оформить рассрочку" : "Оплатить"}{" "}
                  {formatCurrency(total)}
                </Button>
              </div>
            </Card>
          )}

          {step === 3 && (
            <Card className="p-8 text-center">
              <div className="h-16 w-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
                <Award className="h-8 w-8 text-emerald-600" />
              </div>
              <h2 className="font-display text-2xl font-bold mb-2">Заказ оформлен!</h2>
              <p className="text-muted-foreground mb-4">
                Спасибо за заказ. Мы отправили подтверждение на вашу почту.
                {user?.accountType === "legal"
                  ? " Счёт на оплату отправлен в бухгалтерию. Средства на эскроу-счёте после оплаты."
                  : " Средства на эскроу-счёте, холдирование 24 часа."}
              </p>

              {/* Документы для юрлиц */}
              {user?.accountType === "legal" && user.legalInfo && (
                <div className="mt-6 p-4 border border-primary/30 rounded-lg bg-primary/5 text-left">
                  <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                    <FileText className="h-4 w-4 text-primary" />
                    Документы для бухгалтерии
                  </h3>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between p-2 bg-card rounded text-sm">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-blue-600" />
                        <div>
                          <div className="font-medium">Счёт на оплату №{Date.now().toString().slice(-6)}</div>
                          <div className="text-xs text-muted-foreground">
                            от {new Date().toLocaleDateString("ru-RU")} • {user.legalInfo.companyName}
                          </div>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => toast.success("Счёт скачан (PDF)")}
                      >
                        Скачать PDF
                      </Button>
                    </div>
                    {user.legalInfo.hasVat && (
                      <div className="flex items-center justify-between p-2 bg-card rounded text-sm">
                        <div className="flex items-center gap-2">
                          <Receipt className="h-4 w-4 text-purple-600" />
                          <div>
                            <div className="font-medium">Счёт-фактура с НДС 20%</div>
                            <div className="text-xs text-muted-foreground">
                              ИНН {user.legalInfo.inn} • КПП {user.legalInfo.kpp || "—"}
                            </div>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => toast.success("Счёт-фактура скачана (PDF)")}
                        >
                          Скачать
                        </Button>
                      </div>
                    )}
                    <div className="flex items-center justify-between p-2 bg-card rounded text-sm">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-emerald-600" />
                        <div>
                          <div className="font-medium">Акт выполненных работ</div>
                          <div className="text-xs text-muted-foreground">после получения заказа</div>
                        </div>
                      </div>
                      <Button size="sm" variant="ghost" disabled>
                        Ожидает
                      </Button>
                    </div>
                    {user.legalInfo.taxSystem === "OSNO" && (
                      <div className="text-xs text-muted-foreground p-2 bg-amber-50 rounded mt-2">
                        ℹ️ Организация на ОСНО — потребуется договор и УПД
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Чек для физлиц */}
              {user?.accountType !== "legal" && (
                <div className="mt-6 p-4 border border-border rounded-lg text-left max-w-md mx-auto">
                  <h3 className="font-semibold text-sm mb-2 flex items-center gap-2">
                    <Receipt className="h-4 w-4 text-emerald-600" />
                    Электронный чек
                  </h3>
                  <div className="text-xs text-muted-foreground space-y-1">
                    <div className="flex justify-between">
                      <span>Формат:</span>
                      <span>ФНС России (54-ФЗ)</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Способ:</span>
                      <span>Email / SMS</span>
                    </div>
                    <div className="flex justify-between">
                      <span>НДС:</span>
                      <span>Не облагается (УСН)</span>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full mt-3"
                    onClick={() => toast.success("Чек отправлен на email")}
                  >
                    Отправить чек повторно
                  </Button>
                </div>
              )}

              <p className="text-sm text-muted-foreground mt-6">
                Перенаправляем в личный кабинет...
              </p>
            </Card>
          )}
        </div>

        {/* Summary */}
        <Card className="p-4 h-fit sticky top-20">
          <h3 className="font-display font-semibold mb-3">Ваш заказ</h3>
          <div className="space-y-2 mb-3 max-h-64 overflow-y-auto">
            {cart.map((item, i) => (
              <div key={i} className="flex gap-2 text-sm">
                <img src={item.image} alt="" className="h-10 w-10 rounded object-cover" loading="lazy" decoding="async" />
                <div className="flex-1 min-w-0">
                  <div className="truncate">{item.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {item.quantity} × {formatCurrency(item.price)}
                  </div>
                </div>
                <div className="font-medium">
                  {formatCurrency(item.price * item.quantity)}
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-1.5 text-sm border-t pt-3">
            <div className="flex justify-between text-muted-foreground">
              <span>Товары</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
            {discount > 0 && (
              <div className="flex justify-between text-emerald-600">
                <span>Скидка</span>
                <span>−{formatCurrency(discount)}</span>
              </div>
            )}
            <div className="flex justify-between text-muted-foreground">
              <span>Доставка</span>
              <span>{deliveryCost === 0 ? "Бесплатно" : formatCurrency(deliveryCost)}</span>
            </div>
            <div className="flex justify-between font-semibold text-base pt-2 border-t">
              <span>Итого</span>
              <span>{formatCurrency(total)}</span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

export function ContactsPage() {
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    topic: "general",
    message: "",
  });
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.email || !form.message) {
      toast.error("Заполните имя, email и сообщение");
      return;
    }
    // In a real app this would POST to /api/inquiries
    toast.success("Сообщение отправлено!", {
      description: "Ответим в течение 24 часов на " + form.email,
    });
    setSubmitted(true);
    setForm({ name: "", email: "", phone: "", topic: "general", message: "" });
    setTimeout(() => setSubmitted(false), 5000);
  };

  return (
    <div className="container mx-auto px-4 py-6 lg:py-10 max-w-5xl">
      {/* ===== HERO ===== */}
      <div className="text-center mb-10">
        <Badge className="mb-3 bg-primary/10 text-primary border-primary/20">
          <Mail className="h-3 w-3 mr-1" />
          Связаться с нами
        </Badge>
        <h1 className="font-display text-3xl lg:text-5xl font-bold mb-3">
          Контакты
        </h1>
        <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
          Мы всегда на связи — выберите удобный способ связаться с нами.
          Поддержка работает ежедневно с 10:00 до 22:00 по МСК.
        </p>
      </div>

      {/* ===== QUICK CONTACT METHODS ===== */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        <Card className="p-6 text-center hover:shadow-lg transition-shadow">
          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
            <Phone className="h-6 w-6 text-primary" />
          </div>
          <h3 className="font-semibold mb-1">Телефон</h3>
          <p className="text-sm text-muted-foreground mb-2">Ежедневно 10:00–22:00 (МСК)</p>
          <a href="tel:+78001234567" className="text-primary font-medium hover:underline">
            8 (800) 123-45-67
          </a>
          <p className="text-xs text-muted-foreground mt-1">Бесплатно по России</p>
        </Card>

        <Card className="p-6 text-center hover:shadow-lg transition-shadow">
          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
            <Mail className="h-6 w-6 text-primary" />
          </div>
          <h3 className="font-semibold mb-1">Email</h3>
          <p className="text-sm text-muted-foreground mb-2">Ответим в течение 24 часов</p>
          <a href="mailto:hello@conditera.ru" className="text-primary font-medium hover:underline">
            hello@conditera.ru
          </a>
          <p className="text-xs text-muted-foreground mt-1">Для общих вопросов</p>
        </Card>

        <Card className="p-6 text-center hover:shadow-lg transition-shadow">
          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
            <MessageCircle className="h-6 w-6 text-primary" />
          </div>
          <h3 className="font-semibold mb-1">Чат на сайте</h3>
          <p className="text-sm text-muted-foreground mb-2">Виджет в правом нижнем углу</p>
          <p className="text-primary font-medium">Онлайн 24/7</p>
          <p className="text-xs text-muted-foreground mt-1">Среднее время ответа: 5 минут</p>
        </Card>
      </div>

      {/* ===== CONTACT FORM + DEPARTMENTS ===== */}
      <div className="grid lg:grid-cols-2 gap-6 mb-8">
        {/* Contact Form */}
        <Card className="p-6">
          <h2 className="font-display text-xl font-bold mb-2">Напишите нам</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Заполните форму, и мы перезвоним или напишем на email в течение 24 часов.
          </p>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <Label htmlFor="name" className="text-sm font-medium">Имя *</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Как к вам обращаться?"
                className="mt-1"
              />
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="email" className="text-sm font-medium">Email *</Label>
                <Input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="you@example.com"
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="phone" className="text-sm font-medium">Телефон</Label>
                <Input
                  id="phone"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="+7 (___) ___-__-__"
                  className="mt-1"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="topic" className="text-sm font-medium">Тема обращения</Label>
              <select
                id="topic"
                value={form.topic}
                onChange={(e) => setForm({ ...form, topic: e.target.value })}
                className="mt-1 w-full px-3 py-2 rounded-md border border-input bg-background text-sm"
              >
                <option value="general">Общий вопрос</option>
                <option value="order">Проблема с заказом</option>
                <option value="dispute">Спор и возврат</option>
                <option value="partnership">Сотрудничество</option>
                <option value="press">Пресса и медиа</option>
                <option value="investor">Инвесторам</option>
                <option value="confectioner">Хочу стать кондитером</option>
              </select>
            </div>
            <div>
              <Label htmlFor="message" className="text-sm font-medium">Сообщение *</Label>
              <Textarea
                id="message"
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
                placeholder="Опишите ваш вопрос или предложение..."
                rows={4}
                className="mt-1"
              />
            </div>
            <Button type="submit" className="w-full" disabled={submitted}>
              {submitted ? "Сообщение отправлено ✓" : "Отправить сообщение"}
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              Нажимая «Отправить», вы соглашаетесь с обработкой персональных данных
              по 152-ФЗ.
            </p>
          </form>
        </Card>

        {/* Departments */}
        <div className="space-y-6">
          <Card className="p-6">
            <h2 className="font-display text-xl font-bold mb-4">Для покупателей</h2>
            <div className="space-y-3 text-sm">
              <div className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Phone className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <div className="font-medium">Поддержка покупателей</div>
                  <div className="text-muted-foreground">8 (800) 123-45-67</div>
                  <div className="text-xs text-muted-foreground">Ежедневно 10:00–22:00</div>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Mail className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <div className="font-medium">Вопросы по заказам</div>
                  <div className="text-muted-foreground">orders@conditera.ru</div>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <div className="font-medium">Споры и возвраты</div>
                  <div className="text-muted-foreground">disputes@conditera.ru</div>
                  <div className="text-xs text-muted-foreground">Срок рассмотрения: 24 часа</div>
                </div>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <h2 className="font-display text-xl font-bold mb-4">Для кондитеров</h2>
            <div className="space-y-3 text-sm">
              <div className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Phone className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <div className="font-medium">Поддержка кондитеров</div>
                  <div className="text-muted-foreground">8 (800) 123-45-68</div>
                  <div className="text-xs text-muted-foreground">Пн–Пт 9:00–21:00</div>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Mail className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <div className="font-medium">Регистрация и верификация</div>
                  <div className="text-muted-foreground">partners@conditera.ru</div>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <CreditCard className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <div className="font-medium">Выплаты и финансы</div>
                  <div className="text-muted-foreground">payouts@conditera.ru</div>
                  <div className="text-xs text-muted-foreground">Выплаты: 1–3 рабочих дня</div>
                </div>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <h2 className="font-display text-xl font-bold mb-4">Для бизнеса и прессы</h2>
            <div className="space-y-3 text-sm">
              <div className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Mail className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <div className="font-medium">Партнёрство и B2B</div>
                  <div className="text-muted-foreground">b2b@conditera.ru</div>
                  <div className="text-xs text-muted-foreground">Корпоративные заказы, тендеры</div>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Mail className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <div className="font-medium">Пресса и медиа</div>
                  <div className="text-muted-foreground">press@conditera.ru</div>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Mail className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <div className="font-medium">Инвесторам</div>
                  <div className="text-muted-foreground">invest@conditera.ru</div>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* ===== REGIONAL OFFICES ===== */}
      <Card className="p-6 mb-8">
        <h2 className="font-display text-xl font-bold mb-2">Региональные пункты выдачи</h2>
        <p className="text-muted-foreground text-sm mb-4">
          Пункты выдачи «Уездного кондитера» в 28 городах России. Здесь можно
          забрать заказ самовывозом, получить консультацию или сдать торт при споре.
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
          {[
            { city: "Москва", address: "ул. Печная, д. 1", phone: "+7 (495) 123-45-67", hours: "10–22" },
            { city: "Санкт-Петербург", address: "Лиговский пр., д. 50", phone: "+7 (812) 345-67-89", hours: "10–22" },
            { city: "Казань", address: "ул. Баумана, д. 33", phone: "+7 (843) 234-56-78", hours: "10–20" },
            { city: "Екатеринбург", address: "ул. Малышева, д. 5", phone: "+7 (343) 345-67-89", hours: "10–20" },
            { city: "Новосибирск", address: "Красный пр., д. 17", phone: "+7 (383) 234-56-78", hours: "10–20" },
            { city: "Краснодар", address: "ул. Красная, д. 88", phone: "+7 (861) 234-56-78", hours: "10–20" },
            { city: "Нижний Новгород", address: "ул. Большая Покровская, д. 60", phone: "+7 (831) 234-56-78", hours: "10–20" },
            { city: "Самара", address: "ул. Куйбышева, д. 88", phone: "+7 (846) 234-56-78", hours: "10–20" },
          ].map((office, i) => (
            <div key={i} className="p-3 border border-border rounded-lg">
              <div className="flex items-center gap-1.5 mb-1">
                <MapPin className="h-3.5 w-3.5 text-primary shrink-0" />
                <div className="font-semibold text-sm">{office.city}</div>
              </div>
              <div className="text-xs text-muted-foreground">{office.address}</div>
              <div className="text-xs text-muted-foreground mt-1">{office.phone}</div>
              <div className="text-xs text-primary mt-1">{office.hours} МСК</div>
            </div>
          ))}
        </div>
        <div className="text-center mt-4">
          <a href="/catalog" className="text-sm text-primary hover:underline">
            Смотреть все 28 пунктов выдачи →
          </a>
        </div>
      </Card>

      {/* ===== SOCIAL LINKS ===== */}
      <Card className="p-6 mb-8">
        <h2 className="font-display text-xl font-bold mb-4">Мы в социальных сетях</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { name: "Telegram", handle: "@conditera", url: "https://t.me/conditera", desc: "Канал с работами кондитеров" },
            { name: "ВКонтакте", handle: "vk.com/conditera", url: "https://vk.com/conditera", desc: "Сообщество, акции, конкурсы" },
            { name: "YouTube", handle: "Уездный кондитер", url: "https://youtube.com/@conditera", desc: "Видеоуроки и обзоры" },
            { name: "Дзен", handle: "Уездный кондитер", url: "https://dzen.ru/conditera", desc: "Статьи и рецепты" },
          ].map((social, i) => (
            <a
              key={i}
              href={social.url}
              target="_blank"
              rel="noopener noreferrer"
              className="p-4 border border-border rounded-lg hover:border-primary/40 hover:bg-accent/30 transition-all"
            >
              <div className="font-semibold text-sm mb-1">{social.name}</div>
              <div className="text-xs text-primary">{social.handle}</div>
              <div className="text-xs text-muted-foreground mt-1">{social.desc}</div>
            </a>
          ))}
        </div>
      </Card>

      {/* ===== COMPANY DETAILS ===== */}
      <Card className="p-6 mb-8">
        <h2 className="font-display text-xl font-bold mb-4">Реквизиты компании</h2>
        <div className="grid sm:grid-cols-2 gap-6 text-sm">
          <div className="space-y-2">
            <div className="font-semibold mb-2">Юридическое лицо</div>
            <div><span className="text-muted-foreground">Наименование:</span> ООО «Уездный кондитер»</div>
            <div><span className="text-muted-foreground">ИНН:</span> 7701234567</div>
            <div><span className="text-muted-foreground">КПП:</span> 770101001</div>
            <div><span className="text-muted-foreground">ОГРН:</span> 1234567890123</div>
            <div><span className="text-muted-foreground">ОКПО:</span> 12345678</div>
          </div>
          <div className="space-y-2">
            <div className="font-semibold mb-2">Адрес и контакты</div>
            <div><span className="text-muted-foreground">Юр. адрес:</span> 101000, г. Москва, ул. Печная, д. 1</div>
            <div><span className="text-muted-foreground">Почтовый адрес:</span> 101000, г. Москва, а/я 123</div>
            <div><span className="text-muted-foreground">Телефон:</span> 8 (800) 123-45-67</div>
            <div><span className="text-muted-foreground">Email:</span> hello@conditera.ru</div>
            <div><span className="text-muted-foreground">Сайт:</span> conditera.ru</div>
          </div>
        </div>
        <div className="mt-4 p-3 bg-muted/50 rounded-lg text-xs text-muted-foreground">
          <strong className="font-medium">Банковские реквизиты:</strong> р/с 40702810400000012345
          в ПАО «Сбербанк», БИК 044525225, к/с 30101810400000000225.
          Для получения полного пакета документов напишите на b2b@conditera.ru.
        </div>
      </Card>

      {/* ===== WORKING HOURS ===== */}
      <Card className="p-6 text-center bg-primary/5 border-primary/20">
        <Clock className="h-10 w-10 text-primary mx-auto mb-2" />
        <h3 className="font-display font-semibold mb-1">Режим работы</h3>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Платформа работает 24/7 — заказы принимаются круглосуточно.
          Поддержка отвечает ежедневно с 10:00 до 22:00 по московскому времени.
          Региональные пункты выдачи — с 10:00 до 20:00 по местному времени.
        </p>
      </Card>
    </div>
  );
}

export function ForConfectionersPage() {
  const [calcOrders, setCalcOrders] = useState(8);
  const [calcAvgCheck, setCalcAvgCheck] = useState(3500);
  const [calcTariff, setCalcTariff] = useState<keyof typeof TARIFFS>("PROFI");

  // Income calculator
  const monthlyRevenue = calcOrders * calcAvgCheck * 4; // 4 weeks
  const platformCommission = monthlyRevenue * TARIFFS[calcTariff].commission;
  const yookassaFee = monthlyRevenue * TARIFFS[calcTariff].yookassa;
  const monthlySubscription = TARIFFS[calcTariff].monthly;
  const taxNPD = monthlyRevenue * 0.04; // 4% NPD for individuals
  const netIncome = monthlyRevenue - platformCommission - yookassaFee - monthlySubscription - taxNPD;

  return (
    <div className="container mx-auto px-4 py-6 lg:py-10 max-w-5xl">
      {/* ===== HERO ===== */}
      <div className="text-center mb-10">
        <Badge className="mb-3 bg-primary/10 text-primary border-primary/20">
          <Sparkles className="h-3 w-3 mr-1" />
          Для кондитеров
        </Badge>
        <h1 className="font-display text-3xl lg:text-5xl font-bold mb-3">
          Продавайте торты на «Уездном кондитере»
        </h1>
        <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
          Присоединяйтесь к 2 400+ кондитерам, которые уже продают
          свои изделия напрямую покупателям по всей России. Без посредников,
          без сложной бюрократии — только вы и ваши клиенты.
        </p>
      </div>

      {/* ===== BENEFITS ===== */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {[
          {
            icon: Users,
            title: "Доступ к 120 000+ покупателей",
            text: "Не нужно искать клиентов через соцсети или сарафанное радио. Платформа приводит заинтересованных покупателей из вашей локации и всей России. Конверсия в заказ — 8–12%.",
          },
          {
            icon: ShieldCheck,
            title: "Безопасные платежи через эскроу",
            text: "Эскроу-счёт защищает и вас, и покупателя. Деньги поступают на ваш баланс автоматически после доставки + 24 часа. Без рисков неоплаты или мошенничества.",
          },
          {
            icon: CreditCard,
            title: "Быстрые выплаты 1–3 раза в неделю",
            text: "Автоматические выплаты на банковскую карту 1–3 раза в неделю. Минимальная сумма — 1 000 ₽. Комиссия от 15% — всё включено (эквайринг, эскроу, поддержка).",
          },
          {
            icon: TrendingUp,
            title: "Аналитика и прогноз спроса",
            text: "Прогноз спроса по категориям, аналитика заказов, тренды по начинкам и сезонность. Рекомендации по ценам на основе ваших конкурентов в регионе.",
          },
          {
            icon: Award,
            title: "Верификация и система доверия",
            text: "Проверенные кондитеры получают приоритет в каталоге. Авто-подтверждение ИП и ООО через DaData за 5 минут. Уровни: NEW → VERIFIED → MASTER → EXPERT.",
          },
          {
            icon: Sparkles,
            title: "Конструктор тортов и AI",
            text: "Получайте заказы через конструктор — покупатель сам выбирает начинку, покрытие и декор. AI-консультант рекомендует ваш профиль подходящим клиентам.",
          },
        ].map((v, i) => {
          const Icon = v.icon;
          return (
            <Card key={i} className="p-5 hover:shadow-lg transition-shadow">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                <Icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-semibold mb-2">{v.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{v.text}</p>
            </Card>
          );
        })}
      </div>

      {/* ===== INCOME CALCULATOR ===== */}
      <Card className="p-6 lg:p-8 mb-8 bg-gradient-to-br from-primary/5 to-transparent border-primary/20">
        <h2 className="font-display text-xl lg:text-2xl font-bold mb-2">Калькулятор дохода</h2>
        <p className="text-muted-foreground mb-6">
          Рассчитайте примерный доход за месяц. Расчёт примерный — реальные
          показатели зависят от вашего региона, рейтинга и ассортимента.
        </p>
        <div className="grid lg:grid-cols-2 gap-6">
          {/* Inputs */}
          <div className="space-y-4">
            <div>
              <Label className="text-sm font-medium flex items-center justify-between mb-2">
                <span>Заказов в неделю</span>
                <span className="text-primary font-bold">{calcOrders}</span>
              </Label>
              <input
                type="range"
                min="1"
                max="30"
                value={calcOrders}
                onChange={(e) => setCalcOrders(Number(e.target.value))}
                className="w-full accent-primary"
              />
              <div className="flex justify-between text-xs text-muted-foreground mt-1">
                <span>1</span>
                <span>30</span>
              </div>
            </div>
            <div>
              <Label className="text-sm font-medium flex items-center justify-between mb-2">
                <span>Средний чек, ₽</span>
                <span className="text-primary font-bold">{calcAvgCheck.toLocaleString("ru-RU")}</span>
              </Label>
              <input
                type="range"
                min="1000"
                max="15000"
                step="500"
                value={calcAvgCheck}
                onChange={(e) => setCalcAvgCheck(Number(e.target.value))}
                className="w-full accent-primary"
              />
              <div className="flex justify-between text-xs text-muted-foreground mt-1">
                <span>1 000 ₽</span>
                <span>15 000 ₽</span>
              </div>
            </div>
            <div>
              <Label className="text-sm font-medium mb-2 block">Тариф</Label>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(TARIFFS) as Array<keyof typeof TARIFFS>).map(key => (
                  <button
                    key={key}
                    onClick={() => setCalcTariff(key)}
                    className={`px-3 py-2 rounded-md text-sm font-medium border-2 transition-all ${
                      calcTariff === key
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:border-primary/30"
                    }`}
                  >
                    {TARIFFS[key].name} ({Math.round(TARIFFS[key].commission * 100)}%)
                  </button>
                ))}
              </div>
            </div>
          </div>
          {/* Results */}
          <div className="bg-card border border-border rounded-lg p-5">
            <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Выручка в месяц</div>
            <div className="text-2xl font-bold mb-4">{formatCurrency(monthlyRevenue)}</div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Комиссия платформы</span>
                <span className="text-red-600">−{formatCurrency(platformCommission)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Эквайринг YooKassa</span>
                <span className="text-red-600">−{formatCurrency(yookassaFee)}</span>
              </div>
              {monthlySubscription > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Подписка</span>
                  <span className="text-red-600">−{formatCurrency(monthlySubscription)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Налог НПД (4%)</span>
                <span className="text-red-600">−{formatCurrency(taxNPD)}</span>
              </div>
              <div className="border-t border-border pt-2 mt-2 flex justify-between font-bold">
                <span>Чистый доход</span>
                <span className="text-primary">{formatCurrency(netIncome)}</span>
              </div>
            </div>
            <div className="mt-4 p-3 bg-primary/5 rounded text-xs text-muted-foreground">
              💡 При {calcOrders} заказах в неделю и среднем чеке {calcAvgCheck.toLocaleString("ru-RU")} ₽
              на тарифе {TARIFFS[calcTariff].name} ваш чистый доход — {formatCurrency(netIncome)} в месяц.
            </div>
          </div>
        </div>
      </Card>

      {/* ===== TARIFFS ===== */}
      <Card className="p-6 lg:p-8 mb-8">
        <h2 className="font-display text-xl lg:text-2xl font-bold mb-2">Тарифы и комиссии</h2>
        <p className="text-muted-foreground mb-6">
          Выберите подходящий тариф. Комиссия включает все платежи и услуги платформы
          — эквайринг, эскроу, поддержку, использование конструктора. Смена тарифа —
          в любой момент в личном кабинете.
        </p>
        <div className="grid sm:grid-cols-3 gap-4">
          {Object.entries(TARIFFS).map(([key, t]) => (
            <Card key={key} className={`p-5 border-2 ${key === "PROFI" ? "border-primary" : "border-border"} hover:border-primary/40 hover:shadow-lg transition-all`}>
              {key === "PROFI" && (
                <Badge className="mb-2 bg-primary text-primary-foreground">Популярный</Badge>
              )}
              <div className="font-display font-bold text-lg mb-1">{t.name}</div>
              <div className="text-3xl font-bold text-primary mb-1">
                {Math.round(t.commission * 100)}%
              </div>
              <div className="text-xs text-muted-foreground mb-3">
                комиссия + {Math.round(t.yookassa * 100)}% эквайринг
              </div>
              {t.monthly > 0 && (
                <div className="text-sm font-medium mb-3">
                  + {formatCurrency(t.monthly)} / мес
                </div>
              )}
              <ul className="space-y-1.5 text-xs">
                {t.benefits.map((b) => (
                  <li key={b} className="flex items-start gap-1.5">
                    <Award className="h-3 w-3 text-primary shrink-0 mt-0.5" />
                    {b}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      </Card>

      {/* ===== STEPS ===== */}
      <Card className="p-6 lg:p-8 mb-8">
        <h2 className="font-display text-xl lg:text-2xl font-bold mb-2">Как начать продавать</h2>
        <p className="text-muted-foreground mb-6">
          Четыре простых шага от регистрации до первого заказа. Весь процесс
          занимает 1–3 рабочих дня в зависимости от типа верификации.
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { num: "1", title: "Регистрация", text: "Создайте аккаунт кондитера, укажите город и специализацию (торты, десерты, ПП-изделия и т.д.). Займёт 5 минут." },
            { num: "2", title: "Верификация", text: "Загрузите документы: паспорт, ИНН. Для самозанятых — регистрация НПД. ИП и ООО подтверждаются автоматически через DaData за 5 минут." },
            { num: "3", title: "Портфолио", text: "Добавьте минимум 3 фото работ в портфолио. Опишите начинку, покрытие, цены и сроки изготовления. Заполните тариф." },
            { num: "4", title: "Первый заказ", text: "Принимайте заказы через каталог или конструктор тортов. Модератор проверит профиль в течение 1 рабочего дня — и вы в игре!" },
          ].map((step) => (
            <div key={step.num} className="relative">
              <div className="h-12 w-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-lg mb-3">
                {step.num}
              </div>
              <h3 className="font-semibold mb-2">{step.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{step.text}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* ===== TESTIMONIALS ===== */}
      <Card className="p-6 lg:p-8 mb-8">
        <h2 className="font-display text-xl lg:text-2xl font-bold mb-2">Отзывы кондитеров</h2>
        <p className="text-muted-foreground mb-6">
          Реальные истории кондитеров, которые построили свой бизнес на платформе.
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            {
              name: "Анна Сладкая",
              city: "Москва",
              specialty: "Бенто-торты",
              income: "180 000 ₽/мес",
              text: "За 8 месяцев на платформе выросла с 2 до 25 заказов в неделю. AI-консультант приводит идеальных клиентов — тех, кто уже готов купить. Сама занимаюсь только готовкой.",
              avatar: "AS",
            },
            {
              name: "Мария Бисквитова",
              city: "Казань",
              specialty: "Свадебные торты",
              income: "320 000 ₽/мес",
              text: "Перешла с инстаграма — забыла про головную боль с оплатами и доставкой. Эскроу даёт уверенность, что деньги точно придут. Платформа берёт на себя чеки и налоги.",
              avatar: "MB",
            },
            {
              name: "Елена Зефирная",
              city: "Екатеринбург",
              specialty: "Зефирные букеты",
              income: "95 000 ₽/мес",
              text: "Живу в Екатеринбурге, продаю по всей России через СДЭК. Доставка с термопакетом работает идеально — ни одного испорченного заказа за год. Спасибо платформе!",
              avatar: "EZ",
            },
            {
              name: "Ольга Макаронова",
              city: "Санкт-Петербург",
              specialty: "Макаронс",
              income: "240 000 ₽/мес",
              text: "Конструктор тортов — гениальная штука. Покупатель сам собирает набор, я только готовлю. Конверсия в заказ выросла в 2.5 раза по сравнению с просто каталогом.",
              avatar: "OM",
            },
            {
              name: "Дарья Тортова",
              city: "Новосибирск",
              specialty: "ПП-десерты",
              income: "120 000 ₽/мес",
              text: "Узкая ниша — ПП-десерты без сахара. Думала, не вытяну на платформе с обычными тортами. Оказалось, AI-консультант отлично понимает «без сахара» и ведёт ко мне целевых клиентов.",
              avatar: "DT",
            },
            {
              name: "Игорь Шоколадов",
              city: "Краснодар",
              specialty: "Шоколадные фонтаны",
              income: "200 000 ₽/мес",
              text: "Корпоративные заказы через тендеры платформы — 40% моего дохода. B2B-отдел продаёт мои фонтаны на банкеты от 50 человек. Сам бы никогда не вышел на этих клиентов.",
              avatar: "IS",
            },
          ].map((t, i) => (
            <div key={i} className="p-4 border border-border rounded-lg">
              <div className="flex items-center gap-3 mb-3">
                <Avatar className="h-10 w-10">
                  <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                    {t.avatar}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <div className="font-semibold text-sm">{t.name}</div>
                  <div className="text-xs text-muted-foreground">{t.city} • {t.specialty}</div>
                </div>
              </div>
              <div className="text-xs text-primary font-medium mb-2">Доход: {t.income}</div>
              <p className="text-sm text-muted-foreground leading-relaxed">{t.text}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* ===== TAXES ===== */}
      <Card className="p-6 lg:p-8 mb-8">
        <h2 className="font-display text-xl lg:text-2xl font-bold mb-2">Налоги для самозанятых</h2>
        <p className="text-muted-foreground mb-6">
          Платформа автоматически формирует чеки и передаёт данные в ФНС через
          интеграцию с «Мой налог». Вам не нужно отдельно регистрировать чеки —
          всё происходит автоматически при оплате заказа.
        </p>
        <div className="grid sm:grid-cols-2 gap-4 mb-4">
          <div className="p-5 rounded-lg bg-muted/50 border border-border">
            <div className="text-3xl font-bold text-primary mb-1">4%</div>
            <div className="text-sm font-medium">С доходов от физических лиц</div>
            <div className="text-xs text-muted-foreground mt-2">
              Налоговый вычет 10 000 ₽ при регистрации снижает ставку до 3%.
              Применяется к заказам физических лиц.
            </div>
          </div>
          <div className="p-5 rounded-lg bg-muted/50 border border-border">
            <div className="text-3xl font-bold text-primary mb-1">6%</div>
            <div className="text-sm font-medium">С доходов от юридических лиц</div>
            <div className="text-xs text-muted-foreground mt-2">
              Лимит дохода 2.4 млн ₽ в год. При превышении — переход на ИП.
              Чеки формируются автоматически с реквизитами покупателя-юрлица.
            </div>
          </div>
        </div>
        <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
          <div className="flex items-start gap-3">
            <ShieldCheck className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div className="text-sm">
              <strong className="font-medium">Платформа берёт на себя:</strong> формирование чеков,
              передачу данных в ФНС, налоговую отчётность, юридическое сопровождение сделок,
              эскроу-гарантии, разрешение споров. Вам остаётся только готовить торты и
              развивать своё мастерство!
            </div>
          </div>
        </div>
      </Card>

      {/* ===== FAQ ===== */}
      <Card className="p-6 lg:p-8 mb-8">
        <h2 className="font-display text-xl lg:text-2xl font-bold mb-2">Частые вопросы кондитеров</h2>
        <p className="text-muted-foreground mb-6">
          Краткие ответы на главные вопросы. Подробный FAQ — на странице помощи.
        </p>
        <div className="space-y-4">
          {[
            {
              q: "Сколько стоит регистрация?",
              a: "Регистрация бесплатная. Платите только комиссию с продаж (15–25% в зависимости от тарифа). PREMIUM и BUSINESS имеют ежемесячную подписку за расширенные возможности — аналитику и приоритет в выдаче.",
            },
            {
              q: "Можно ли совмещать с продажами через соцсети?",
              a: "Да, конечно. Многие кондитеры используют «Уездный кондитер» как дополнительный канал продаж. В личном кабинете можно указать ссылки на ваши соцсети — покупатели видят их в профиле.",
            },
            {
              q: "Что если покупатель не забрал заказ?",
              a: "Эскроу защищает и вас. Если покупатель не забрал заказ по своей вине (изменил планы, не ответил) — деньги переводятся вам после 7 дней хранения. Если по вашей вине (несоответствие заказу, порча) — возврат покупателю.",
            },
            {
              q: "Нужно ли самому возить торты?",
              a: "Нет. Доставка — отдельный сервис платформы. По Москве — курьеры-партнёры (Яндекс Доставка, Dostavista). По России — СДЭК и Boxberry с термопакетом. Самовывоз покупателем — бесплатно.",
            },
            {
              q: "Какие документы нужны для регистрации?",
              a: "Для самозанятых: паспорт, ИНН, регистрация в «Мой налог» (можно сделать онлайн за 10 минут). Для ИП: ОГРНИП, ИНН. Для ООО: ОГРН, ИНН, устав. Верификация ИП и ООО — автоматически через DaData.",
            },
          ].map((faq, i) => (
            <div key={i} className="border-b border-border pb-4 last:border-0 last:pb-0">
              <div className="font-semibold text-sm mb-1">{faq.q}</div>
              <div className="text-sm text-muted-foreground leading-relaxed">{faq.a}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* ===== CTA ===== */}
      <Card className="p-6 lg:p-8 text-center bg-primary/5 border-primary/20">
        <h2 className="font-display text-xl lg:text-2xl font-bold mb-2">Готовы начать?</h2>
        <p className="text-muted-foreground mb-6 max-w-xl mx-auto">
          Регистрация занимает 5 минут. Первый заказ — в течение недели.
          Без вступительных взносов и обязательств.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <a href="/login" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-sm font-medium">
            <Sparkles className="h-4 w-4" />
            Зарегистрироваться как кондитер
          </a>
          <a href="/contacts" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-border hover:bg-accent transition-colors text-sm font-medium">
            <MessageCircle className="h-4 w-4" />
            Задать вопрос
          </a>
        </div>
      </Card>
    </div>
  );
}

export function ReviewsPage() {
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("recent");

  const allReviews = [
    {
      id: "r1",
      productName: "Торт «Свадебный вальс»",
      confectionerName: "Мария Сладкая",
      confectionerAvatar: "МС",
      userName: "Анна Иванова",
      userAvatar: "https://i.pravatar.cc/150?img=1",
      rating: 5,
      date: "2026-06-28",
      text: "Заказывала свадебный торт на 80 человек. Мария — настоящий профессионал! Торт был не только красивым, но и невероятно вкусным. Гости были в восторге. Спасибо огромное за наш идеальный день!",
      responseFrom: "Мария Сладкая",
      responseText: "Анна, спасибо за тёплые слова! Было честью быть частью вашего праздника.",
      responseDate: "2026-06-29",
      helpful: 12,
    },
    {
      id: "r2",
      productName: "Бенто-торт «День рождения»",
      confectionerName: "Елена Зефирная",
      confectionerAvatar: "ЕЗ",
      userName: "Дмитрий Петров",
      userAvatar: "https://i.pravatar.cc/150?img=11",
      rating: 5,
      date: "2026-06-25",
      text: "Заказывал бенто-торт для дочки на 5 лет. Дизайн — принцесса Диснея, выполнено идеально. Начинка — клубника со сливками, очень нежная. Доставка вовремя, упаковка аккуратная. Однозначно рекомендую!",
      responseFrom: null,
      responseText: null,
      responseDate: null,
      helpful: 8,
    },
    {
      id: "r3",
      productName: "Капкейки «Праздничный набор»",
      confectionerName: "Ольга Макаронова",
      confectionerAvatar: "ОМ",
      userName: "Светлана К.",
      userAvatar: "https://i.pravatar.cc/150?img=5",
      rating: 4,
      date: "2026-06-20",
      text: "Капкейки вкусные, свежие, красиво оформлены. Единственное — хотелось бы больше разнообразия начинок в наборе из 12 шт. В остальном всё отлично, буду заказывать ещё.",
      responseFrom: "Ольга Макаронова",
      responseText: "Светлана, спасибо за отзыв! Учту пожелание по начинкам.",
      responseDate: "2026-06-21",
      helpful: 5,
    },
    {
      id: "r4",
      productName: "Торт «Чёрный лес»",
      confectionerName: "Игорь Шоколадов",
      confectionerAvatar: "ИШ",
      userName: "Алексей С.",
      userAvatar: "https://i.pravatar.cc/150?img=15",
      rating: 5,
      date: "2026-06-18",
      text: "Заказывал торт на юбилей отца. Шоколадный бисквит с вишней — классика, которая не подводит. Игорь сделал всё идеально: и вкус, и дизайн. Особая благодарность за быструю доставку!",
      responseFrom: null,
      responseText: null,
      responseDate: null,
      helpful: 15,
    },
    {
      id: "r5",
      productName: "Макаронс ассорти (24 шт)",
      confectionerName: "Ольга Макаронова",
      confectionerAvatar: "ОМ",
      userName: "Мария В.",
      userAvatar: "https://i.pravatar.cc/150?img=20",
      rating: 5,
      date: "2026-06-15",
      text: "Макаронс просто тают во рту! Заказывала для девичника — все подруги были в восторге. Особенно понравились фисташковый и малиновый.",
      responseFrom: "Ольга Макаронова",
      responseText: "Мария, благодарю за такой подробный отзыв! Рада, что девичник удался.",
      responseDate: "2026-06-16",
      helpful: 22,
    },
    {
      id: "r6",
      productName: "Торт «Реалистичный — Кедр»",
      confectionerName: "Дарья Тортова",
      confectionerAvatar: "ДТ",
      userName: "Сергей Н.",
      userAvatar: "https://i.pravatar.cc/150?img=33",
      rating: 5,
      date: "2026-06-10",
      text: "Заказывал реалистичный торт в виде кедра. Дарья — гений! Торт выглядел как настоящий, гости не верили, что это торт. Внутри — медовик, очень вкусно. Произведение искусства!",
      responseFrom: null,
      responseText: null,
      responseDate: null,
      helpful: 18,
    },
  ];

  const filters = [
    { id: "all", label: "Все отзывы", count: allReviews.length },
    { id: "5", label: "5 звёзд", count: allReviews.filter(r => r.rating === 5).length },
    { id: "4", label: "4 звезды", count: allReviews.filter(r => r.rating === 4).length },
    { id: "with-response", label: "С ответом", count: allReviews.filter(r => r.responseFrom).length },
  ];

  const filteredReviews = activeFilter === "all"
    ? allReviews
    : activeFilter === "with-response"
    ? allReviews.filter(r => r.responseFrom)
    : allReviews.filter(r => r.rating === parseInt(activeFilter));

  const sortedReviews = [...filteredReviews].sort((a, b) => {
    if (sortBy === "recent") return b.date.localeCompare(a.date);
    if (sortBy === "helpful") return b.helpful - a.helpful;
    if (sortBy === "rating") return b.rating - a.rating;
    return 0;
  });

  const avgRating = (allReviews.reduce((sum, r) => sum + r.rating, 0) / allReviews.length).toFixed(1);

  return (
    <div className="container mx-auto px-4 py-6 lg:py-10 max-w-5xl">
      <div className="text-center mb-8">
        <Badge className="mb-3 bg-primary/10 text-primary border-primary/20">
          <Star className="h-3 w-3 mr-1" />
          Отзывы покупателей
        </Badge>
        <h1 className="font-display text-3xl lg:text-5xl font-bold mb-3">
          Отзывы о кондитерах
        </h1>
        <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
          Реальные отзывы покупателей о тортах и десертах от кондитеров
          платформы. Все отзывы проверены — мы удаляем фейковые.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Card className="p-5 text-center">
          <div className="font-display text-3xl font-bold text-primary">{avgRating}</div>
          <div className="text-sm font-medium mt-1">Средний рейтинг</div>
          <div className="text-xs text-muted-foreground mt-1">из 5.0</div>
        </Card>
        <Card className="p-5 text-center">
          <div className="font-display text-3xl font-bold">{allReviews.length}+</div>
          <div className="text-sm font-medium mt-1">Всего отзывов</div>
          <div className="text-xs text-muted-foreground mt-1">за 2026 год</div>
        </Card>
        <Card className="p-5 text-center">
          <div className="font-display text-3xl font-bold">{Math.round(allReviews.filter(r => r.rating === 5).length / allReviews.length * 100)}%</div>
          <div className="text-sm font-medium mt-1">Пятизвёздочных</div>
          <div className="text-xs text-muted-foreground mt-1">отзывов</div>
        </Card>
        <Card className="p-5 text-center">
          <div className="font-display text-3xl font-bold">{allReviews.filter(r => r.responseFrom).length}</div>
          <div className="text-sm font-medium mt-1">С ответом</div>
          <div className="text-xs text-muted-foreground mt-1">кондитера</div>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-6">
        {filters.map(f => (
          <button
            key={f.id}
            onClick={() => setActiveFilter(f.id)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              activeFilter === f.id
                ? "bg-primary text-primary-foreground"
                : "bg-muted hover:bg-muted/70 text-muted-foreground"
            }`}
          >
            {f.label}
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${
              activeFilter === f.id ? "bg-primary-foreground/20" : "bg-background/70"
            }`}>{f.count}</span>
          </button>
        ))}
        <div className="ml-auto">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="px-3 py-1.5 rounded-md border border-input bg-background text-sm"
          >
            <option value="recent">Сначала новые</option>
            <option value="helpful">Полезные</option>
            <option value="rating">По рейтингу</option>
          </select>
        </div>
      </div>

      <div className="space-y-4">
        {sortedReviews.map(review => (
          <Card key={review.id} className="p-5">
            <div className="flex items-start gap-4 mb-3">
              <Avatar className="h-10 w-10 shrink-0">
                <AvatarImage src={review.userAvatar} />
                <AvatarFallback className="bg-primary/10 text-primary text-xs">
                  {review.userName.split(" ").map(n => n[0]).join("")}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <div className="font-semibold text-sm">{review.userName}</div>
                    <div className="text-xs text-muted-foreground">{review.date}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map(s => (
                      <Star
                        key={s}
                        className={`h-4 w-4 ${s <= review.rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="mb-3">
              <Badge variant="secondary" className="mb-2">{review.productName}</Badge>
              <p className="text-sm leading-relaxed">{review.text}</p>
            </div>

            {review.responseFrom && (
              <div className="mt-3 p-4 bg-muted/50 rounded-lg border-l-4 border-primary">
                <div className="flex items-center gap-2 mb-2">
                  <Avatar className="h-6 w-6">
                    <AvatarFallback className="bg-primary text-primary-foreground text-[10px]">
                      {review.confectionerAvatar}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-xs font-medium">
                    Ответ от {review.responseFrom} (кондитер)
                  </span>
                  <span className="text-xs text-muted-foreground">• {review.responseDate}</span>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">{review.responseText}</p>
              </div>
            )}

            <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
              <div className="flex items-center gap-3">
                <button className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                  <Award className="h-3.5 w-3.5" />
                  Полезно ({review.helpful})
                </button>
              </div>
              <div className="text-xs text-muted-foreground">
                Кондитер: <span className="font-medium text-foreground">{review.confectionerName}</span>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Card className="p-6 mt-8 text-center bg-primary/5 border-primary/20">
        <h2 className="font-display text-xl font-bold mb-2">Поделитесь впечатлениями</h2>
        <p className="text-muted-foreground mb-4 max-w-md mx-auto text-sm">
          Заказали торт? Оставьте отзыв — это поможет другим покупателям
          выбрать кондитера, а кондитеру — стать лучше.
        </p>
        <Button>Написать отзыв</Button>
      </Card>
    </div>
  );
}

// ====================================================================
// ForSuppliersPage — страница для поставщиков сырья и ингредиентов
// ====================================================================
export function ForSuppliersPage() {
  return (
    <div className="container mx-auto px-4 py-6 lg:py-10 max-w-5xl">
      {/* ===== HERO ===== */}
      <div className="text-center mb-10">
        <Badge className="mb-3 bg-primary/10 text-primary border-primary/20">
          <Store className="h-3 w-3 mr-1" />
          Для поставщиков
        </Badge>
        <h1 className="font-display text-3xl lg:text-5xl font-bold mb-3">
          Продавайте сырьё кондитерам
        </h1>
        <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
          Присоединяйтесь к 80+ поставщикам, которые продают муку, шоколад,
          декор и ингредиенты напрямую кондитерам платформы по всей России.
        </p>
      </div>

      {/* ===== BENEFITS ===== */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {[
          { icon: Users, title: "Доступ к 2 400+ кондитерам", text: "Не нужно искать клиентов — все кондитеры платформы ваши потенциальные покупатели. Заказы через B2B-маркетплейс." },
          { icon: ShieldCheck, title: "Безопасные платежи", text: "Эскроу-счёт защищает оплату. Деньги поступают после подтверждения получения товара кондитером." },
          { icon: CreditCard, title: "Комиссия 5%", text: "Минимальная комиссия на B2B-сегменте. Без ежемесячных платежей. Платите только за реальные продажи." },
          { icon: TrendingUp, title: "Аналитика спроса", text: "Видите тренды по категориям: что покупают чаще, сезонность, средний чек. Прогнозируйте закупки." },
          { icon: Truck, title: "Логистика", text: "Доставка через СДЭК, Деловые Линии или самовывоз. Интеграция с транспортными компаниями." },
          { icon: Award, title: "Сертификация", text: "Загрузите сертификаты качества (ГОСТ, ТУ, ISO). Проверенные поставщики получают приоритет в выдаче." },
        ].map((v, i) => {
          const Icon = v.icon;
          return (
            <Card key={i} className="p-5 hover:shadow-lg transition-shadow">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                <Icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-semibold mb-2">{v.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{v.text}</p>
            </Card>
          );
        })}
      </div>

      {/* ===== HOW IT WORKS ===== */}
      <Card className="p-6 lg:p-8 mb-8">
        <h2 className="font-display text-xl lg:text-2xl font-bold mb-2">Как начать продавать</h2>
        <p className="text-muted-foreground mb-6">Четыре шага от регистрации до первой продажи.</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { num: "1", title: "Регистрация", text: "Создайте аккаунт поставщика, укажите город и тип товаров (мука, шоколад, декор, оборудование)." },
            { num: "2", title: "Верификация", text: "Загрузите ИНН, сертификаты качества. ИП и ООО подтверждаются через DaData за 5 минут." },
            { num: "3", title: "Каталог", text: "Добавьте товары: название, описание, цена, фото, единицы измерения, минимальный заказ." },
            { num: "4", title: "Первая продажа", text: "Получайте заказы от кондитеров. Отгружайте — деньги на счёт после подтверждения." },
          ].map((step) => (
            <div key={step.num} className="relative">
              <div className="h-12 w-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-lg mb-3">
                {step.num}
              </div>
              <h3 className="font-semibold mb-2">{step.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{step.text}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* ===== PRODUCT CATEGORIES ===== */}
      <Card className="p-6 lg:p-8 mb-8">
        <h2 className="font-display text-xl lg:text-2xl font-bold mb-2">Категории товаров</h2>
        <p className="text-muted-foreground mb-6">Что можно продавать на B2B-маркетплейсе платформы.</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[
            { name: "Мука и сырьё", icon: "🧂", desc: "Пшеничная, миндальная, кокосовая мука" },
            { name: "Шоколад", icon: "🍫", desc: "Кувертюра, какао-порошок, какао-масло" },
            { name: "Сахар и подсластители", icon: "🍯", desc: "Тростниковый, эритрит, стевия" },
            { name: "Молочные продукты", icon: "🥛", desc: "Сливки, масло, сливочный сыр, молоко" },
            { name: "Декор для тортов", icon: "🎀", desc: "Вафельная бумага, сахарные жемчужины" },
            { name: "Пищевые красители", icon: "🎨", desc: "Гелевые, сухие, аэрографные" },
            { name: "Формы и оснастка", icon: "📐", desc: "Кольца, кондитерские мешки, насадки" },
            { name: "Упаковка", icon: "📦", desc: "Коробки, подложки, ленты" },
            { name: "Оборудование", icon: "🔧", desc: "Планетарные миксеры, печи, тестомесы" },
          ].map((cat, i) => (
            <div key={i} className="p-4 border border-border rounded-lg hover:border-primary/30 transition-colors">
              <div className="text-3xl mb-2">{cat.icon}</div>
              <div className="font-semibold text-sm mb-1">{cat.name}</div>
              <div className="text-xs text-muted-foreground">{cat.desc}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* ===== FAQ ===== */}
      <Card className="p-6 lg:p-8 mb-8">
        <h2 className="font-display text-xl lg:text-2xl font-bold mb-4">Частые вопросы поставщиков</h2>
        <div className="space-y-4">
          {[
            { q: "Какая комиссия платформы для поставщиков?", a: "Комиссия — 5% с каждой продажи. Без ежемесячных платежей. Вы платите только за реальные продажи. Дополнительно 2.5% — эквайринг YooKassa." },
            { q: "Как происходит оплата?", a: "Кондитер оплачивает заказ через YooKassa. Средства холдируются на эскроу-счёте 24 часа после получения товара. После подтверждения — выплата на ваш счёт 1–3 рабочих дня." },
            { q: "Можно ли продавать оптом?", a: "Да. У каждого товара можно указать оптовые цены (от 10 кг, от 50 кг и т.д.). Кондитеры видят розничную и оптовую цену при заказе." },
            { q: "Нужны ли сертификаты?", a: "Обязательны для пищевых продуктов: декларация соответствия, сертификат качества. Загрузите их в профиле — проверенные поставщики получают приоритет." },
            { q: "Какая минимальная сумма заказа?", a: "Вы устанавливаете минимальный заказ сами. Рекомендуем 3 000 ₽ для розничных и 15 000 ₽ для оптовых." },
          ].map((faq, i) => (
            <div key={i} className="border-b border-border pb-4 last:border-0 last:pb-0">
              <div className="font-semibold text-sm mb-1">{faq.q}</div>
              <div className="text-sm text-muted-foreground leading-relaxed">{faq.a}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* ===== CTA ===== */}
      <Card className="p-6 lg:p-8 text-center bg-primary/5 border-primary/20">
        <h2 className="font-display text-xl lg:text-2xl font-bold mb-2">Готовы начать?</h2>
        <p className="text-muted-foreground mb-6 max-w-xl mx-auto text-sm">
          Регистрация занимает 5 минут. Первый заказ — в течение недели.
          Без вступительных взносов и обязательств.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <a href="/login" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-sm font-medium">
            <Store className="h-4 w-4" />
            Зарегистрироваться как поставщик
          </a>
          <a href="/contacts" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-border hover:bg-accent transition-colors text-sm font-medium">
            <MessageCircle className="h-4 w-4" />
            Задать вопрос
          </a>
        </div>
      </Card>
    </div>
  );
}
