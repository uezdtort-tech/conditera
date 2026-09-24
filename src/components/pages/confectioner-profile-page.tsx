"use client";

import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { ProductCard } from "@/components/marketplace/product-card";
import { TastingLocationsBlock } from "@/components/marketplace/tasting-locations-block";
import { SimpleXConnectWidget } from "@/components/simplex/simplex-connect-widget";
import {
  Star,
  MapPin,
  Check,
  MessageCircle,
  Heart,
  Share2,
  Cake,
  Calendar,
  Users,
  TrendingUp,
  Award,
  ChevronLeft,
  Truck,
  Navigation,
  Building2,
  FileText,
  ShieldCheck,
  CreditCard,
  MapPinned,
} from "lucide-react";
import {
  TRUST_LEVELS,
  TARIFFS,
  LEGAL_STATUS_INFO,
  formatCurrency,
  calculateDistance,
} from "@/lib/finance";
import { ECO_BADGES, CONFECTIONER_ECO_BADGES } from "@/lib/mock-data-features";

export function ConfectionerProfilePage() {
  const nav = useAppStore((s) => s.nav);
  const confectioners = useAppStore((s) => s.confectioners);
  const products = useAppStore((s) => s.products);
  const channelPosts = useAppStore((s) => s.channelPosts);
  const userLocation = useAppStore((s) => s.userLocation);
  const navigate = useAppStore((s) => s.navigate);
  const setChatOpen = useAppStore((s) => s.setChatOpen);

  const confectioner = confectioners.find((c) => c.id === nav.params?.id);

  if (!confectioner) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <h2 className="font-display text-2xl font-bold mb-2">Кондитер не найден</h2>
        <Button onClick={() => navigate("confectioners")}>К списку кондитеров</Button>
      </div>
    );
  }

  const productsList = products.filter((p) => p.confectionerId === confectioner.id);
  const posts = channelPosts.filter((p) => p.confectionerId === confectioner.id);
  const trust = TRUST_LEVELS[confectioner.trustLevel] ?? TRUST_LEVELS.NEW;
  const tariff = TARIFFS[confectioner.tariff];
  const legal = LEGAL_STATUS_INFO[confectioner.legalInfo.status];

  // Расчёт расстояния
  const distance =
    userLocation?.lat && userLocation?.lng && confectioner.location.lat && confectioner.location.lng
      ? calculateDistance(
          userLocation.lat,
          userLocation.lng,
          confectioner.location.lat,
          confectioner.location.lng
        )
      : null;

  const inZone =
    distance !== null && confectioner.location.serviceRadiusKm
      ? distance <= confectioner.location.serviceRadiusKm
      : null;

  return (
    <div>
      {/* Cover */}
      <div className="relative h-48 sm:h-64 bg-gradient-to-br from-primary/20 via-accent to-primary/10 overflow-hidden">
        {confectioner.cover && (
          <img
            src={confectioner.cover}
            alt=""
            className="w-full h-full object-cover opacity-70" loading="lazy" decoding="async" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background to-transparent" />
        <button
          onClick={() => navigate("confectioners")}
          className="absolute top-4 left-4 bg-background/80 backdrop-blur px-3 py-1.5 rounded-md text-sm hover:bg-background"
        >
          <ChevronLeft className="h-4 w-4 inline mr-1" />
          Назад
        </button>
      </div>

      <div className="container mx-auto px-4">
        {/* Profile header */}
        <div className="relative -mt-16 mb-6">
          <div className="flex flex-col sm:flex-row gap-4 items-start">
            <Avatar className="h-24 w-24 sm:h-32 sm:w-32 border-4 border-background shadow-lg shrink-0">
              <AvatarImage src={confectioner.avatar} alt={confectioner.businessName} />
              <AvatarFallback className="text-2xl">
                {confectioner.businessName.slice(0, 2)}
              </AvatarFallback>
            </Avatar>

            <div className="flex-1 pt-2 sm:pt-16">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <h1 className="font-display text-2xl sm:text-3xl font-bold">
                  {confectioner.businessName}
                </h1>
                {confectioner.verified && (
                  <Badge className="bg-primary text-primary-foreground">
                    <Check className="h-3 w-3 mr-1" />
                    Верифицирован
                  </Badge>
                )}
                <Badge variant="outline" className={trust.color}>
                  <Award className="h-3 w-3 mr-1" />
                  {trust.label}
                </Badge>
                <Badge variant="outline">{tariff.name}</Badge>
              </div>

              <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground mb-3">
                <span className="flex items-center gap-1">
                  <MapPin className="h-4 w-4" />
                  {confectioner.city}
                  {confectioner.location.district && (
                    <span className="text-xs">• {confectioner.location.district}</span>
                  )}
                </span>
                {distance !== null && (
                  <Badge
                    variant="outline"
                    className={
                      inZone
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : "bg-amber-50 text-amber-700 border-amber-200"
                    }
                  >
                    <Navigation className="h-3 w-3 mr-1" />
                    {distance < 1 ? "рядом с вами" : `${distance} км от вас`}
                    {inZone ? " • в зоне" : " • вне зоны"}
                  </Badge>
                )}
                <span className="flex items-center gap-1">
                  <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                  {confectioner.rating.toFixed(1)} ({confectioner.reviewsCount})
                </span>
                <span className="flex items-center gap-1">
                  <Cake className="h-4 w-4" />
                  {confectioner.ordersCount} заказов
                </span>
                <span className="flex items-center gap-1">
                  <Users className="h-4 w-4" />
                  {confectioner.followersCount} подписчиков
                </span>
                <span className="flex items-center gap-1">
                  <Calendar className="h-4 w-4" />с {confectioner.joinedAt}
                </span>
              </div>

              {/* Бейджи: юр.статус, доставка, верификация */}
              <div className="flex flex-wrap items-center gap-2 mb-4">
                <Badge variant="outline" className={legal.color}>
                  {legal.icon} {legal.label}
                </Badge>
                {confectioner.location.serviceRadiusKm && (
                  <Badge variant="outline">
                    <Truck className="h-3 w-3 mr-1" />
                    Доставка: {confectioner.location.serviceRadiusKm} км
                  </Badge>
                )}
                {confectioner.selfPickup && (
                  <Badge variant="outline">Самовывоз</Badge>
                )}
                {confectioner.legalInfo.documentsVerified && (
                  <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                    <ShieldCheck className="h-3 w-3 mr-1" />
                    Документы проверены
                  </Badge>
                )}
              </div>

              <p className="text-muted-foreground max-w-3xl mb-4">
                {confectioner.description}
              </p>

              <div className="flex flex-wrap gap-2 mb-4">
                {confectioner.specialization.map((spec) => (
                  <Badge key={spec} variant="secondary">
                    {spec}
                  </Badge>
                ))}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button onClick={() => setChatOpen(true)}>
                  <MessageCircle className="h-4 w-4 mr-2" />
                  Написать
                </Button>
                <Button variant="outline">
                  <Heart className="h-4 w-4 mr-2" />
                  Подписаться
                </Button>
                <Button variant="outline">
                  <Share2 className="h-4 w-4 mr-2" />
                  Поделиться
                </Button>
              </div>
            </div>
          </div>
        </div>

        <Separator className="my-6" />

        {/* SimpleX — приватный E2E-канал для премиум-клиентов */}
        <div className="mb-6">
          <SimpleXConnectWidget
            variant="banner"
            title="Приватный канал с этим кондитером"
            description="Хотите обсудить заказ конфиденциально? Подключитесь через SimpleX Chat — сквозное шифрование, без номера телефона, без передачи данных третьим сторонам."
          />
        </div>

        {/* Tabs */}
        <Tabs defaultValue="products">
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="products">Товары ({productsList.length})</TabsTrigger>
            <TabsTrigger value="portfolio">Портфолио</TabsTrigger>
            <TabsTrigger value="channel">Канал ({posts.length})</TabsTrigger>
            <TabsTrigger value="location">
              <MapPin className="h-3.5 w-3.5 mr-1" />
              Локация
            </TabsTrigger>
            <TabsTrigger value="legal">
              <FileText className="h-3.5 w-3.5 mr-1" />
              Юр. реквизиты
            </TabsTrigger>
            <TabsTrigger value="reviews">Отзывы</TabsTrigger>
            <TabsTrigger value="about">О кондитере</TabsTrigger>
          </TabsList>

          <TabsContent value="products" className="mt-6">
            {productsList.length === 0 ? (
              <Card className="p-8 text-center text-muted-foreground">
                У кондитера пока нет товаров в каталоге
              </Card>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {productsList.map((p) => (
                  <ProductCard key={p.id} product={p} />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="portfolio" className="mt-6">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {confectioner.portfolioImages.map((img, i) => (
                <div
                  key={i}
                  className="aspect-square rounded-lg overflow-hidden bg-muted group cursor-pointer"
                >
                  <img
                    src={img}
                    alt={`Работа ${i + 1}`}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform" loading="lazy" decoding="async" />
                </div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="channel" className="mt-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {posts.map((post) => (
                <Card key={post.id} className="overflow-hidden p-0">
                  <div className="aspect-square">
                    <img
                      src={post.image}
                      alt=""
                      className="w-full h-full object-cover" loading="lazy" decoding="async" />
                  </div>
                  <div className="p-3">
                    <p className="text-sm line-clamp-3 mb-2">{post.caption}</p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Heart className="h-3 w-3" />
                        {post.likes}
                      </span>
                      <span className="flex items-center gap-1">
                        <MessageCircle className="h-3 w-3" />
                        {post.comments}
                      </span>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="location" className="mt-6">
            <div className="grid lg:grid-cols-2 gap-4">
              {/* Адрес */}
              <Card className="p-6">
                <h3 className="font-display font-semibold mb-3 flex items-center gap-2">
                  <MapPin className="h-5 w-5 text-primary" />
                  Адрес кондитера
                </h3>
                <div className="space-y-2 text-sm">
                  <div className="flex items-start gap-2">
                    <span className="text-muted-foreground min-w-[100px]">Регион:</span>
                    <span className="font-medium">{confectioner.location.region}</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-muted-foreground min-w-[100px]">Город:</span>
                    <span className="font-medium">{confectioner.location.city}</span>
                  </div>
                  {confectioner.location.district && (
                    <div className="flex items-start gap-2">
                      <span className="text-muted-foreground min-w-[100px]">Район:</span>
                      <span className="font-medium">{confectioner.location.district}</span>
                    </div>
                  )}
                  {confectioner.location.street && (
                    <div className="flex items-start gap-2">
                      <span className="text-muted-foreground min-w-[100px]">Улица:</span>
                      <span className="font-medium">
                        {confectioner.location.street}
                        {confectioner.location.house && `, д. ${confectioner.location.house}`}
                        {confectioner.location.apartment && `, кв. ${confectioner.location.apartment}`}
                      </span>
                    </div>
                  )}
                  {confectioner.location.postalCode && (
                    <div className="flex items-start gap-2">
                      <span className="text-muted-foreground min-w-[100px]">Индекс:</span>
                      <span className="font-medium">{confectioner.location.postalCode}</span>
                    </div>
                  )}
                  {distance !== null && (
                    <div className="flex items-start gap-2 pt-2 mt-2 border-t">
                      <span className="text-muted-foreground min-w-[100px]">От вас:</span>
                      <Badge
                        className={
                          inZone
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-amber-100 text-amber-800"
                        }
                      >
                        <Navigation className="h-3 w-3 mr-1" />
                        {distance} км {inZone ? "• в зоне доставки" : "• вне зоны"}
                      </Badge>
                    </div>
                  )}
                </div>
              </Card>

              {/* Зона доставки */}
              <Card className="p-6">
                <h3 className="font-display font-semibold mb-3 flex items-center gap-2">
                  <Truck className="h-5 w-5 text-primary" />
                  Зона доставки
                </h3>
                <div className="space-y-3 text-sm">
                  {confectioner.location.serviceRadiusKm && (
                    <div className="p-3 bg-primary/5 rounded-lg">
                      <div className="text-xs text-muted-foreground">Радиус доставки</div>
                      <div className="font-display text-xl font-bold text-primary">
                        {confectioner.location.serviceRadiusKm} км
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        От адреса кондитера
                      </div>
                    </div>
                  )}
                  {confectioner.location.deliveryCities && confectioner.location.deliveryCities.length > 0 && (
                    <div>
                      <div className="text-xs text-muted-foreground mb-2">Города доставки:</div>
                      <div className="flex flex-wrap gap-1.5">
                        {confectioner.location.deliveryCities.map((city) => (
                          <Badge key={city} variant="secondary" className="text-xs">
                            <MapPin className="h-3 w-3 mr-1" />
                            {city}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  <div>
                    <div className="text-xs text-muted-foreground mb-2">Способы получения:</div>
                    <div className="flex flex-wrap gap-1.5">
                      {confectioner.selfPickup && (
                        <Badge variant="outline" className="text-xs">
                          ✓ Самовывоз
                        </Badge>
                      )}
                      {confectioner.deliveryOptions.map((opt) => (
                        <Badge key={opt} variant="outline" className="text-xs">
                          {opt === "own" && "🚗 Своя доставка"}
                          {opt === "courier" && "📦 Курьер платформы"}
                          {opt === "pickup_point" && "🏪 ПВЗ"}
                          {opt === "cdek" && "📦 СДЭК"}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              </Card>
            </div>

            {/* Визуализация зоны (упрощённая) */}
            <Card className="p-6 mt-4">
              <h3 className="font-display font-semibold mb-3 flex items-center gap-2">
                <MapPinned className="h-5 w-5 text-primary" />
                Расположение на карте
              </h3>
              {confectioner.location.lat && confectioner.location.lng ? (
                <div className="relative aspect-[2/1] rounded-lg overflow-hidden bg-gradient-to-br from-primary/5 to-accent/30 border border-border">
                  {/* Стилизованная карта */}
                  <div className="absolute inset-0 bg-pattern opacity-30" />
                  {/* Зона доставки */}
                  {confectioner.location.serviceRadiusKm && (
                    <div
                      className="absolute rounded-full border-2 border-primary/30 bg-primary/5"
                      style={{
                        left: "50%",
                        top: "50%",
                        width: `${Math.min(80, confectioner.location.serviceRadiusKm * 1.5)}%`,
                        height: `${Math.min(80, confectioner.location.serviceRadiusKm * 1.5)}%`,
                        transform: "translate(-50%, -50%)",
                      }}
                    />
                  )}
                  {/* Маркер кондитера */}
                  <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
                    <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center shadow-lg">
                      <Cake className="h-4 w-4 text-primary-foreground" />
                    </div>
                    <div className="mt-1 bg-background/90 backdrop-blur px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap">
                      {confectioner.businessName}
                    </div>
                  </div>
                  {/* Пользователь */}
                  {userLocation?.lat && userLocation?.lng && distance !== null && (
                    <div
                      className="absolute flex flex-col items-center"
                      style={{
                        left: `${50 + (distance > 0 ? Math.min(40, distance * 1.5) : 0)}%`,
                        top: "50%",
                      }}
                    >
                      <div className="h-6 w-6 rounded-full bg-blue-500 flex items-center justify-center border-2 border-white shadow-lg">
                        <Navigation className="h-3 w-3 text-white" />
                      </div>
                      <div className="mt-1 bg-background/90 backdrop-blur px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap">
                        Вы ({distance} км)
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground text-center py-8">
                  Координаты не указаны
                </div>
              )}
            </Card>
          </TabsContent>

          <TabsContent value="legal" className="mt-6">
            <div className="grid lg:grid-cols-2 gap-4">
              {/* Юридический статус */}
              <Card className="p-6">
                <h3 className="font-display font-semibold mb-3 flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-primary" />
                  Юридический статус
                </h3>
                <div className={`p-4 rounded-lg border ${legal.color} mb-4`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-2xl">{legal.icon}</span>
                    <span className="font-display font-bold text-lg">{legal.label}</span>
                  </div>
                  <p className="text-sm opacity-90">{legal.description}</p>
                </div>
                <div className="space-y-2 text-sm">
                  {legal.maxAnnualIncome && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Лимит дохода в год:</span>
                      <span className="font-medium">{formatCurrency(legal.maxAnnualIncome)}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Работа с B2B:</span>
                    <span className="font-medium">{legal.canWorkWithB2B ? "✓ Да" : "✗ Нет"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Счёт-фактура с НДС:</span>
                    <span className="font-medium">{legal.canIssueVatInvoice ? "✓ Да" : "✗ Нет"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Налог с физлиц:</span>
                    <span className="font-medium">{Math.round(legal.taxRateIndividual * 100)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Налог с юрлиц:</span>
                    <span className="font-medium">{Math.round(legal.taxRateLegal * 100)}%</span>
                  </div>
                </div>
              </Card>

              {/* Реквизиты */}
              <Card className="p-6">
                <h3 className="font-display font-semibold mb-3 flex items-center gap-2">
                  <FileText className="h-5 w-5 text-primary" />
                  Реквизиты
                </h3>
                <div className="space-y-2 text-sm">
                  {confectioner.legalInfo.inn && (
                    <Requisite label="ИНН" value={confectioner.legalInfo.inn} />
                  )}
                  {confectioner.legalInfo.npdRegisteredAt && (
                    <Requisite label="НПД зарегистрирован" value={confectioner.legalInfo.npdRegisteredAt} />
                  )}
                  {confectioner.legalInfo.ipOgrnip && (
                    <Requisite label="ОГРНИП" value={confectioner.legalInfo.ipOgrnip} />
                  )}
                  {confectioner.legalInfo.ipInn && (
                    <Requisite label="ИНН ИП" value={confectioner.legalInfo.ipInn} />
                  )}
                  {confectioner.legalInfo.ipUsnRate && (
                    <Requisite label="Ставка УСН" value={confectioner.legalInfo.ipUsnRate} />
                  )}
                  {confectioner.legalInfo.oooOgrn && (
                    <Requisite label="ОГРН" value={confectioner.legalInfo.oooOgrn} />
                  )}
                  {confectioner.legalInfo.oooInn && (
                    <Requisite label="ИНН ООО" value={confectioner.legalInfo.oooInn} />
                  )}
                  {confectioner.legalInfo.oooKpp && (
                    <Requisite label="КПП" value={confectioner.legalInfo.oooKpp} />
                  )}
                  {confectioner.legalInfo.oooLegalAddress && (
                    <Requisite label="Юр. адрес" value={confectioner.legalInfo.oooLegalAddress} />
                  )}
                  {confectioner.legalInfo.oooTaxSystem && (
                    <Requisite
                      label="Система налогообложения"
                      value={
                        confectioner.legalInfo.oooTaxSystem === "OSNO"
                          ? "ОСНО"
                          : confectioner.legalInfo.oooTaxSystem === "USN_6"
                          ? "УСН 6% (доходы)"
                          : confectioner.legalInfo.oooTaxSystem === "USN_15"
                          ? "УСН 15% (доходы − расходы)"
                          : "ОСНО с НДС"
                      }
                    />
                  )}
                  {confectioner.legalInfo.bankAccount && (
                    <Requisite label="Расчётный счёт" value={`••••${confectioner.legalInfo.bankAccount.slice(-4)}`} />
                  )}
                  {confectioner.legalInfo.bankName && (
                    <Requisite label="Банк" value={confectioner.legalInfo.bankName} />
                  )}
                </div>
                {confectioner.legalInfo.documentsVerified && (
                  <div className="mt-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2">
                    <ShieldCheck className="h-5 w-5 text-emerald-600 shrink-0" />
                    <div className="text-sm">
                      <div className="font-medium text-emerald-800">Документы верифицированы</div>
                      {confectioner.legalInfo.verifiedAt && (
                        <div className="text-xs text-emerald-700">
                          Проверено {confectioner.legalInfo.verifiedAt}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Эко-бейджи */}
                {(() => {
                  const ecoBadges = CONFECTIONER_ECO_BADGES[confectioner.id] || [];
                  if (ecoBadges.length === 0) return null;
                  return (
                    <div className="mt-4">
                      <div className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1">
                        🌱 Эко-бейджи ({ecoBadges.length})
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {ecoBadges.map((badgeType) => {
                          const badge = ECO_BADGES.find((b) => b.type === badgeType);
                          if (!badge) return null;
                          return (
                            <div
                              key={badgeType}
                              className="flex items-center gap-1 px-2 py-1 bg-emerald-50 border border-emerald-200 rounded-lg text-xs"
                              title={badge.description}
                            >
                              <span>{badge.icon}</span>
                              <span className="text-emerald-800 font-medium">{badge.label}</span>
                              {badge.verified && <Check className="h-3 w-3 text-emerald-600" />}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="reviews" className="mt-6">
            <Card className="p-6">
              <div className="grid sm:grid-cols-[200px_1fr] gap-6">
                <div className="text-center">
                  <div className="font-display text-5xl font-bold">
                    {confectioner.rating.toFixed(1)}
                  </div>
                  <div className="flex justify-center gap-0.5 my-2">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star
                        key={i}
                        className={`h-4 w-4 ${
                          i < Math.round(confectioner.rating)
                            ? "fill-amber-400 text-amber-400"
                            : "text-border"
                        }`}
                      />
                    ))}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {confectioner.reviewsCount} отзывов
                  </div>
                </div>
                <div className="space-y-3">
                  {[
                    {
                      name: "Екатерина",
                      rating: 5,
                      date: "неделю назад",
                      text: "Заказывала торт на день рождения — превзошёл все ожидания! Нежный, не приторный, украшен безупречно.",
                    },
                    {
                      name: "Андрей",
                      rating: 5,
                      date: "2 недели назад",
                      text: "Брали на корпоратив. Все остались довольны. Доставка точно в срок, торт в идеальном состоянии.",
                    },
                    {
                      name: "Ольга",
                      rating: 5,
                      date: "месяц назад",
                      text: "Лучший медовик, что я пробовала! Заказываю уже третий раз. Мария — настоящий мастер.",
                    },
                  ].map((r, i) => (
                    <div key={i} className="border-b last:border-0 pb-3">
                      <div className="flex items-center justify-between mb-1">
                        <div className="font-medium text-sm">{r.name}</div>
                        <div className="text-xs text-muted-foreground">{r.date}</div>
                      </div>
                      <div className="flex gap-0.5 mb-1">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star
                            key={i}
                            className={`h-3 w-3 ${
                              i < r.rating
                                ? "fill-amber-400 text-amber-400"
                                : "text-border"
                            }`}
                          />
                        ))}
                      </div>
                      <p className="text-sm text-muted-foreground">{r.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="about" className="mt-6">
            <div className="grid sm:grid-cols-2 gap-4">
              <Card className="p-6">
                <h3 className="font-display font-semibold mb-3">Информация</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Город:</span>
                    <span className="font-medium">{confectioner.city}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">С нами с:</span>
                    <span className="font-medium">{confectioner.joinedAt}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Тариф:</span>
                    <span className="font-medium">{tariff.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Налоговый режим:</span>
                    <span className="font-medium">
                      {confectioner.taxMode === "NPD"
                        ? "Самозанятый (НПД)"
                        : confectioner.taxMode === "IP"
                        ? "ИП"
                        : "ООО"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Уровень доверия:</span>
                    <span className="font-medium">{trust.label}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Время ответа:</span>
                    <span className="font-medium">{confectioner.responseTime}</span>
                  </div>
                </div>
              </Card>
              <Card className="p-6">
                <h3 className="font-display font-semibold mb-3">Статистика</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="text-center p-3 bg-muted/50 rounded-lg">
                    <TrendingUp className="h-5 w-5 mx-auto mb-1 text-primary" />
                    <div className="font-display text-xl font-bold">
                      {confectioner.ordersCount}
                    </div>
                    <div className="text-xs text-muted-foreground">заказов</div>
                  </div>
                  <div className="text-center p-3 bg-muted/50 rounded-lg">
                    <Star className="h-5 w-5 mx-auto mb-1 text-amber-500" />
                    <div className="font-display text-xl font-bold">
                      {confectioner.rating.toFixed(1)}
                    </div>
                    <div className="text-xs text-muted-foreground">рейтинг</div>
                  </div>
                  <div className="text-center p-3 bg-muted/50 rounded-lg">
                    <Users className="h-5 w-5 mx-auto mb-1 text-primary" />
                    <div className="font-display text-xl font-bold">
                      {confectioner.followersCount}
                    </div>
                    <div className="text-xs text-muted-foreground">подписчиков</div>
                  </div>
                  <div className="text-center p-3 bg-muted/50 rounded-lg">
                    <Check className="h-5 w-5 mx-auto mb-1 text-emerald-600" />
                    <div className="font-display text-xl font-bold">
                      {confectioner.reviewsCount}
                    </div>
                    <div className="text-xs text-muted-foreground">отзывов</div>
                  </div>
                </div>
              </Card>
            </div>
          </TabsContent>
        </Tabs>

        {/* Где попробовать */}
        <TastingLocationsBlock confectionerId={confectioner.id} confectionerName={confectioner.businessName} />
      </div>
    </div>
  );
}

function Requisite({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center gap-2 py-1 border-b border-border last:border-0">
      <span className="text-muted-foreground text-xs">{label}:</span>
      <span className="font-mono text-xs font-medium">{value}</span>
    </div>
  );
}
