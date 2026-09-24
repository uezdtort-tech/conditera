"use client";

import { useAppStore } from "@/lib/store";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Plus,
  Edit,
  Trash2,
  Sparkles,
  Eye,
  MousePointerClick,
  TrendingUp,
  MapPin,
  Calendar,
  Tag,
  AlertCircle,
  Gift,
  Clock,
  Users,
  BookOpen,
  ChefHat,
  Play,
  Heart,
  MessageCircle,
  Package,
  Boxes,
  ArrowDownUp,
  AlertTriangle,
  CheckCircle2,
  Bell,
  BellRing,
  X,
  PartyPopper,
  Wrench,
} from "lucide-react";
import {
  PROMOTION_TYPE_INFO,
  RECIPE_DIFFICULTY_INFO,
  PRODUCTION_STAGES,
} from "@/lib/mock-data-extra";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
} from "@/lib/finance";
import type {
  Promotion,
  PromotionType,
  PromotionStatus,
  Recipe,
  RecipeType,
  RecipeDifficulty,
  RecipeAccess,
  InventoryItem,
  InventoryUnit,
  GanttTask,
  ProductionStage,
  Reminder,
} from "@/lib/types";
import { toast } from "sonner";

// ==================== ВКЛАДКА АКЦИИ ====================
export function ConfectionerPromotionsTab({
  confectionerId,
}: {
  confectionerId: string;
}) {
  const promotions = useAppStore((s) => s.promotions);
  const createPromotion = useAppStore((s) => s.createPromotion);
  const updatePromotion = useAppStore((s) => s.updatePromotion);
  const deletePromotion = useAppStore((s) => s.deletePromotion);
  const promotePromotion = useAppStore((s) => s.promotePromotion);
  const confectioners = useAppStore((s) => s.confectioners);
  const navigate = useAppStore((s) => s.navigate);

  const confectioner = confectioners.find((c) => c.id === confectionerId);
  const myPromotions = promotions.filter((p) => p.confectionerId === confectionerId);
  const [showCreate, setShowCreate] = useState(false);
  const [promotingId, setPromotingId] = useState<string | null>(null);
  const [promoBudget, setPromoBudget] = useState(5000);
  const [promoRegions, setPromoRegions] = useState<string[]>([]);

  const totalViews = myPromotions.reduce((s, p) => s + p.views, 0);
  const totalClicks = myPromotions.reduce((s, p) => s + p.clicks, 0);
  const totalConversions = myPromotions.reduce((s, p) => s + p.conversions, 0);
  const activeCount = myPromotions.filter((p) => p.status === "active").length;
  const promotedCount = myPromotions.filter((p) => p.isPromoted).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">Акции и спецпредложения</h1>
          <p className="text-sm text-muted-foreground">
            Создавайте акции для привлечения клиентов. Активируйте платное продвижение для показа во всплывающих окнах.
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Создать акцию
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Всего акций</div>
          <div className="font-display text-xl font-bold">{myPromotions.length}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Активных</div>
          <div className="font-display text-xl font-bold text-emerald-600">{activeCount}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Просмотры</div>
          <div className="font-display text-xl font-bold">{totalViews}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Конверсии</div>
          <div className="font-display text-xl font-bold text-primary">{totalConversions}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Продвигаются</div>
          <div className="font-display text-xl font-bold text-amber-600">{promotedCount}</div>
        </Card>
      </div>

      {/* List */}
      <div className="space-y-3">
        {myPromotions.map((promo) => {
          const typeInfo = PROMOTION_TYPE_INFO[promo.type];
          const daysLeft = Math.ceil(
            (new Date(promo.endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
          );
          return (
            <Card key={promo.id} className="p-4">
              <div className="flex flex-col sm:flex-row gap-3">
                {/* Image */}
                <div className="w-full sm:w-32 h-24 rounded-lg overflow-hidden bg-muted shrink-0">
                  {promo.image && (
                    <img src={promo.image} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-sm">{promo.title}</h3>
                      <Badge className={`text-[10px] ${typeInfo.color}`}>
                        {typeInfo.label}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={
                          promo.status === "active"
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]"
                            : promo.status === "scheduled"
                            ? "bg-blue-50 text-blue-700 border-blue-200 text-[10px]"
                            : "bg-slate-50 text-slate-700 border-slate-200 text-[10px]"
                        }
                      >
                        {promo.status === "active"
                          ? "Активна"
                          : promo.status === "scheduled"
                          ? "Запланирована"
                          : promo.status === "paused"
                          ? "Приостановлена"
                          : promo.status === "expired"
                          ? "Истекла"
                          : "Черновик"}
                      </Badge>
                      {promo.isPromoted && (
                        <Badge className="bg-amber-500 text-white text-[10px]">
                          <Sparkles className="h-3 w-3 mr-1" />
                          Продвигается
                        </Badge>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => setPromotingId(promo.id)}
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => {
                          updatePromotion(promo.id, {
                            status: promo.status === "active" ? "paused" : "active",
                          });
                          toast.success(
                            promo.status === "active" ? "Акция приостановлена" : "Акция активирована"
                          );
                        }}
                      >
                        {promo.status === "active" ? (
                          <Clock className="h-3.5 w-3.5" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-destructive"
                        onClick={() => {
                          if (confirm("Удалить акцию?")) {
                            deletePromotion(promo.id);
                            toast.success("Акция удалена");
                          }
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
                    {promo.description}
                  </p>

                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    {promo.promoCode && (
                      <span className="flex items-center gap-1">
                        <Tag className="h-3 w-3" />
                        <code className="bg-muted px-1.5 py-0.5 rounded font-mono">
                          {promo.promoCode}
                        </code>
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      до {formatDate(promo.endDate)}
                    </span>
                    {daysLeft >= 0 && daysLeft <= 7 && (
                      <Badge className="bg-amber-100 text-amber-800 text-[10px]">
                        Осталось {daysLeft} дн.
                      </Badge>
                    )}
                    <span className="flex items-center gap-1">
                      <Eye className="h-3 w-3" />
                      {promo.views}
                    </span>
                    <span className="flex items-center gap-1">
                      <MousePointerClick className="h-3 w-3" />
                      {promo.clicks} кликов
                    </span>
                    <span className="flex items-center gap-1">
                      <TrendingUp className="h-3 w-3" />
                      {promo.conversions} конверсий
                    </span>
                  </div>

                  {/* Conversion rate */}
                  {promo.views > 0 && (
                    <div className="mt-2">
                      <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                        <span>Конверсия: {((promo.conversions / promo.views) * 100).toFixed(1)}%</span>
                        <span>
                          {promo.usedCount}
                          {promo.maxUsageCount ? ` / ${promo.maxUsageCount}` : ""} использовано
                        </span>
                      </div>
                      <Progress
                        value={promo.maxUsageCount ? (promo.usedCount / promo.maxUsageCount) * 100 : (promo.conversions / Math.max(1, promo.views)) * 100}
                        className="h-1"
                      />
                    </div>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {myPromotions.length === 0 && (
        <Card className="p-12 text-center">
          <Gift className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <h3 className="font-semibold mb-1">Акций пока нет</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Создайте первую акцию для привлечения клиентов
          </p>
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Создать акцию
          </Button>
        </Card>
      )}

      {/* Create dialog */}
      {showCreate && (
        <CreatePromotionDialog
          confectionerId={confectionerId}
          confectionerCities={confectioner?.location.deliveryCities || [confectioner?.city || "Москва"]}
          onClose={() => setShowCreate(false)}
          onCreate={(promo) => {
            createPromotion(promo);
            toast.success("Акция создана!");
            setShowCreate(false);
          }}
        />
      )}

      {/* Promote dialog */}
      {promotingId && (
        <PromoteDialog
          promotion={myPromotions.find((p) => p.id === promotingId)!}
          budget={promoBudget}
          setBudget={setPromoBudget}
          regions={promoRegions}
          setRegions={setPromoRegions}
          onClose={() => setPromotingId(null)}
          onConfirm={() => {
            promotePromotion(promotingId, promoBudget, promoRegions);
            toast.success("Продвижение активировано!", {
              description: `Бюджет: ${formatCurrency(promoBudget)}, регионов: ${promoRegions.length}`,
            });
            setPromotingId(null);
          }}
        />
      )}
    </div>
  );
}

function CreatePromotionDialog({
  confectionerId,
  confectionerCities,
  onClose,
  onCreate,
}: {
  confectionerId: string;
  confectionerCities: string[];
  onClose: () => void;
  onCreate: (promo: Omit<Promotion, "id" | "createdAt" | "views" | "clicks" | "conversions" | "usedCount">) => void;
}) {
  const confectioners = useAppStore((s) => s.confectioners);
  const confectioner = confectioners.find((c) => c.id === confectionerId)!;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<PromotionType>("discount_percent");
  const [value, setValue] = useState<number>(10);
  const [promoCode, setPromoCode] = useState("");
  const [minOrderAmount, setMinOrderAmount] = useState<number>(0);
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  );
  const [cities, setCities] = useState<string[]>(confectionerCities);
  const [maxUsageCount, setMaxUsageCount] = useState<number>(0);

  const handleSubmit = () => {
    if (!title || !description) {
      toast.error("Заполните название и описание");
      return;
    }
    onCreate({
      confectionerId,
      confectionerName: confectioner.businessName,
      confectionerAvatar: confectioner.avatar,
      title,
      description,
      type,
      value: value > 0 ? value : undefined,
      promoCode: promoCode || undefined,
      minOrderAmount: minOrderAmount > 0 ? minOrderAmount : undefined,
      startDate,
      endDate,
      cities,
      regions: [confectioner.location.region],
      maxUsageCount: maxUsageCount > 0 ? maxUsageCount : undefined,
      status: "active",
      isPromoted: false,
      image: "https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=800",
    });
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Создать акцию</DialogTitle>
          <DialogDescription>
            Заполните параметры акции. После создания она сразу станет активной.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Название акции *</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Скидка 15% на первый заказ"
            />
          </div>
          <div>
            <Label>Описание *</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Подробно опишите условия акции..."
              rows={3}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Тип акции</Label>
              <Select value={type} onValueChange={(v) => setType(v as PromotionType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PROMOTION_TYPE_INFO).map(([key, info]) => (
                    <SelectItem key={key} value={key}>
                      {info.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Значение (%, ₽ или множитель)</Label>
              <Input
                type="number"
                value={value}
                onChange={(e) => setValue(+e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Промокод</Label>
              <Input
                value={promoCode}
                onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                placeholder="WELCOME15"
              />
            </div>
            <div>
              <Label>Мин. сумма заказа (₽)</Label>
              <Input
                type="number"
                value={minOrderAmount}
                onChange={(e) => setMinOrderAmount(+e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Дата начала</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <Label>Дата окончания</Label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label>Города (через запятую)</Label>
            <Input
              value={cities.join(", ")}
              onChange={(e) => setCities(e.target.value.split(",").map((c) => c.trim()).filter(Boolean))}
            />
          </div>
          <div>
            <Label>Макс. использований (0 = без лимита)</Label>
            <Input
              type="number"
              value={maxUsageCount}
              onChange={(e) => setMaxUsageCount(+e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={handleSubmit}>Создать акцию</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PromoteDialog({
  promotion,
  budget,
  setBudget,
  regions,
  setRegions,
  onClose,
  onConfirm,
}: {
  promotion: Promotion;
  budget: number;
  setBudget: (v: number) => void;
  regions: string[];
  setRegions: (v: string[]) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const allRegions = [
    "Москва",
    "Московская область",
    "Санкт-Петербург",
    "Ленинградская область",
    "Тульская область",
    "Воронежская область",
    "Новосибирская область",
    "Свердловская область",
    "Вся Россия",
  ];

  const estimatedViews = Math.floor(budget / 5); // 5₽ за показ
  const estimatedClicks = Math.floor(estimatedViews * 0.05);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-amber-500" />
            Платное продвижение акции
          </DialogTitle>
          <DialogDescription>
            Акция будет показываться во всплывающем окне у пользователей из выбранных регионов.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Card className="p-3 bg-amber-50 border-amber-200">
            <div className="text-xs text-amber-800">
              <strong>{promotion.title}</strong>
              <div className="mt-1">
                Промокод: {promotion.promoCode || "—"}
              </div>
            </div>
          </Card>

          <div>
            <Label>Бюджет продвижения: {formatCurrency(budget)}</Label>
            <Input
              type="range"
              min={500}
              max={50000}
              step={500}
              value={budget}
              onChange={(e) => setBudget(+e.target.value)}
              className="mt-2"
            />
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>500 ₽</span>
              <span>50 000 ₽</span>
            </div>
          </div>

          <div>
            <Label>Регионы показа</Label>
            <div className="grid grid-cols-2 gap-2 mt-2 max-h-48 overflow-y-auto">
              {allRegions.map((r) => (
                <label
                  key={r}
                  className="flex items-center gap-1.5 text-sm cursor-pointer p-2 hover:bg-accent rounded"
                >
                  <input
                    type="checkbox"
                    checked={regions.includes(r)}
                    onChange={(e) => {
                      if (e.target.checked) setRegions([...regions, r]);
                      else setRegions(regions.filter((x) => x !== r));
                    }}
                  />
                  <span className="text-xs">{r}</span>
                </label>
              ))}
            </div>
          </div>

          <Card className="p-3 bg-primary/5">
            <div className="text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Стоимость показа:</span>
                <span>5 ₽</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Оценка показов:</span>
                <span className="font-medium">~{estimatedViews}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Оценка кликов (5%):</span>
                <span className="font-medium">~{estimatedClicks}</span>
              </div>
              <div className="flex justify-between font-semibold pt-1 border-t">
                <span>Списывается:</span>
                <span className="text-primary">{formatCurrency(budget)}</span>
              </div>
            </div>
          </Card>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button
            onClick={onConfirm}
            disabled={regions.length === 0}
            className="bg-amber-500 hover:bg-amber-600"
          >
            <Sparkles className="h-4 w-4 mr-1" />
            Активировать за {formatCurrency(budget)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ==================== ВКЛАДКА РЕЦЕПТЫ ====================
export function ConfectionerRecipesTab({
  confectionerId,
}: {
  confectionerId: string;
}) {
  const recipes = useAppStore((s) => s.recipes);
  const createRecipe = useAppStore((s) => s.createRecipe);
  const updateRecipe = useAppStore((s) => s.updateRecipe);
  const deleteRecipe = useAppStore((s) => s.deleteRecipe);
  const confectioners = useAppStore((s) => s.confectioners);

  const confectioner = confectioners.find((c) => c.id === confectionerId);
  const myRecipes = recipes.filter((r) => r.confectionerId === confectionerId);
  const [showCreate, setShowCreate] = useState(false);

  const totalViews = myRecipes.reduce((s, r) => s + r.views, 0);
  const totalLikes = myRecipes.reduce((s, r) => s + r.likes, 0);
  const paidCount = myRecipes.filter((r) => r.access === "paid").length;
  const earnings = myRecipes
    .filter((r) => r.access === "paid")
    .reduce((s, r) => s + (r.price || 0) * Math.floor(r.views * 0.05), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">Рецепты и уроки</h1>
          <p className="text-sm text-muted-foreground">
            Публикуйте бесплатные рецепты для аудитории или продавайте платные мастер-классы.
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Опубликовать
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-3">
          <BookOpen className="h-5 w-5 text-primary mb-1" />
          <div className="font-display text-xl font-bold">{myRecipes.length}</div>
          <div className="text-xs text-muted-foreground">всего</div>
        </Card>
        <Card className="p-3">
          <Eye className="h-5 w-5 text-blue-600 mb-1" />
          <div className="font-display text-xl font-bold">{totalViews}</div>
          <div className="text-xs text-muted-foreground">просмотров</div>
        </Card>
        <Card className="p-3">
          <Heart className="h-5 w-5 text-rose-600 mb-1" />
          <div className="font-display text-xl font-bold">{totalLikes}</div>
          <div className="text-xs text-muted-foreground">лайков</div>
        </Card>
        <Card className="p-3">
          <TrendingUp className="h-5 w-5 text-emerald-600 mb-1" />
          <div className="font-display text-xl font-bold">{formatCurrency(earnings)}</div>
          <div className="text-xs text-muted-foreground">доход ({paidCount} платных)</div>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {myRecipes.map((recipe) => {
          const typeInfo = RECIPE_TYPE_INFO[recipe.type];
          const diffInfo = RECIPE_DIFFICULTY_INFO[recipe.difficulty];
          return (
            <Card key={recipe.id} className="overflow-hidden p-0">
              <div className="relative aspect-video bg-muted">
                <img src={recipe.coverImage} alt={recipe.title} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                <Badge className={`absolute top-2 left-2 ${typeInfo.color}`}>
                  {typeInfo.label}
                </Badge>
                {recipe.access === "paid" && (
                  <Badge className="absolute top-2 right-2 bg-amber-500 text-white">
                    {formatCurrency(recipe.price || 0)}
                  </Badge>
                )}
                {recipe.videoUrl && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="h-10 w-10 rounded-full bg-white/80 flex items-center justify-center">
                      <Play className="h-5 w-5 text-primary fill-primary ml-1" />
                    </div>
                  </div>
                )}
              </div>
              <div className="p-3">
                <h3 className="font-medium text-sm line-clamp-2 mb-2">{recipe.title}</h3>
                <div className="flex items-center gap-3 text-[10px] text-muted-foreground mb-2">
                  <span className="flex items-center gap-0.5">
                    <Eye className="h-3 w-3" />
                    {recipe.views}
                  </span>
                  <span className="flex items-center gap-0.5">
                    <Heart className="h-3 w-3" />
                    {recipe.likes}
                  </span>
                  <span className="flex items-center gap-0.5">
                    <MessageCircle className="h-3 w-3" />
                    {recipe.comments}
                  </span>
                  <Badge variant="outline" className={`text-[10px] ml-auto ${diffInfo.color}`}>
                    {diffInfo.label}
                  </Badge>
                </div>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      updateRecipe(recipe.id, { published: !recipe.published });
                      toast.success(recipe.published ? "Снято с публикации" : "Опубликовано");
                    }}
                  >
                    {recipe.published ? "Скрыть" : "Опубликовать"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => {
                      if (confirm("Удалить рецепт?")) {
                        deleteRecipe(recipe.id);
                        toast.success("Рецепт удалён");
                      }
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {myRecipes.length === 0 && (
        <Card className="p-12 text-center">
          <ChefHat className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <h3 className="font-semibold mb-1">Рецептов пока нет</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Опубликуйте первый рецепт или мастер-класс
          </p>
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Опубликовать
          </Button>
        </Card>
      )}

      {showCreate && (
        <CreateRecipeDialog
          confectionerId={confectionerId}
          confectionerName={confectioner?.businessName || ""}
          confectionerAvatar={confectioner?.avatar}
          onClose={() => setShowCreate(false)}
          onCreate={(recipe) => {
            createRecipe(recipe);
            toast.success("Рецепт создан!");
            setShowCreate(false);
          }}
        />
      )}
    </div>
  );
}

const RECIPE_TYPE_INFO: Record<RecipeType, { label: string; color: string }> = {
  recipe: { label: "Рецепт", color: "bg-blue-100 text-blue-800" },
  master_class: { label: "Мастер-класс", color: "bg-purple-100 text-purple-800" },
  video_lesson: { label: "Видеоурок", color: "bg-rose-100 text-rose-800" },
  article: { label: "Статья", color: "bg-emerald-100 text-emerald-800" },
};

function CreateRecipeDialog({
  confectionerId,
  confectionerName,
  confectionerAvatar,
  onClose,
  onCreate,
}: {
  confectionerId: string;
  confectionerName: string;
  confectionerAvatar?: string;
  onClose: () => void;
  onCreate: (recipe: Omit<Recipe, "id" | "createdAt" | "views" | "likes" | "comments">) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<RecipeType>("recipe");
  const [difficulty, setDifficulty] = useState<RecipeDifficulty>("easy");
  const [access, setAccess] = useState<RecipeAccess>("free");
  const [price, setPrice] = useState(0);
  const [prepTime, setPrepTime] = useState(20);
  const [cookTime, setCookTime] = useState(40);
  const [servings, setServings] = useState(8);
  const [category, setCategory] = useState("Торты");
  const [tags, setTags] = useState("");
  const [coverImage, setCoverImage] = useState("https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=800");

  const handleSubmit = () => {
    if (!title || !description) {
      toast.error("Заполните название и описание");
      return;
    }
    onCreate({
      confectionerId,
      confectionerName,
      confectionerAvatar,
      type,
      title,
      description,
      coverImage,
      prepTime,
      cookTime,
      totalTime: prepTime + cookTime,
      difficulty,
      servings,
      ingredients: [],
      steps: [],
      tips: [],
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      category,
      access,
      price: access === "paid" ? price : undefined,
      published: true,
      publishedAt: new Date().toISOString().slice(0, 10),
    });
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Опубликовать рецепт / урок</DialogTitle>
          <DialogDescription>
            Заполните基本信息. Подробное содержание (ингредиенты, шаги) можно добавить позже.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Название *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Идеальный бисквит" />
          </div>
          <div>
            <Label>Описание *</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Краткое описание рецепта..."
              rows={3}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Тип</Label>
              <Select value={type} onValueChange={(v) => setType(v as RecipeType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="recipe">Рецепт</SelectItem>
                  <SelectItem value="master_class">Мастер-класс</SelectItem>
                  <SelectItem value="video_lesson">Видеоурок</SelectItem>
                  <SelectItem value="article">Статья</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Сложность</Label>
              <Select value={difficulty} onValueChange={(v) => setDifficulty(v as RecipeDifficulty)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="easy">Легко</SelectItem>
                  <SelectItem value="medium">Средне</SelectItem>
                  <SelectItem value="hard">Сложно</SelectItem>
                  <SelectItem value="expert">Эксперт</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Подготовка (мин)</Label>
              <Input type="number" value={prepTime} onChange={(e) => setPrepTime(+e.target.value)} />
            </div>
            <div>
              <Label>Готовка (мин)</Label>
              <Input type="number" value={cookTime} onChange={(e) => setCookTime(+e.target.value)} />
            </div>
            <div>
              <Label>Порций</Label>
              <Input type="number" value={servings} onChange={(e) => setServings(+e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Категория</Label>
              <Input value={category} onChange={(e) => setCategory(e.target.value)} />
            </div>
            <div>
              <Label>Теги (через запятую)</Label>
              <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="бисквит, классика" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Доступ</Label>
              <Select value={access} onValueChange={(v) => setAccess(v as RecipeAccess)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="free">Бесплатно</SelectItem>
                  <SelectItem value="paid">Платный</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {access === "paid" && (
              <div>
                <Label>Цена (₽)</Label>
                <Input type="number" value={price} onChange={(e) => setPrice(+e.target.value)} />
              </div>
            )}
          </div>
          <div>
            <Label>URL обложки</Label>
            <Input value={coverImage} onChange={(e) => setCoverImage(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={handleSubmit}>Опубликовать</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ==================== ВКЛАДКА СКЛАД ====================
export function ConfectionerInventoryTab({
  confectionerId,
}: {
  confectionerId: string;
}) {
  const inventory = useAppStore((s) => s.inventory);
  const stockMovements = useAppStore((s) => s.stockMovements);
  const updateInventoryItem = useAppStore((s) => s.updateInventoryItem);
  const deleteInventoryItem = useAppStore((s) => s.deleteInventoryItem);
  const addStockMovement = useAppStore((s) => s.addStockMovement);
  const suppliers = useAppStore((s) => s.confectioners); // для простоты
  const [showAddMovement, setShowAddMovement] = useState<string | null>(null);

  const myItems = inventory.filter((i) => i.confectionerId === confectionerId);
  const myMovements = stockMovements.filter((m) =>
    myItems.some((i) => i.id === m.itemId)
  );

  const totalValue = myItems.reduce((s, i) => s + i.quantity * i.costPerUnit, 0);
  const lowStockItems = myItems.filter((i) => i.quantity <= i.minQuantity);
  const expiringItems = myItems.filter((i) => {
    if (!i.expiryDate) return false;
    const days = Math.ceil((new Date(i.expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return days <= 7 && days >= 0;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">Складской учёт</h1>
          <p className="text-sm text-muted-foreground">
            Управление ингредиентами и материалами. Контроль остатков и сроков годности.
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-3">
          <Boxes className="h-5 w-5 text-primary mb-1" />
          <div className="font-display text-xl font-bold">{myItems.length}</div>
          <div className="text-xs text-muted-foreground">позиций</div>
        </Card>
        <Card className="p-3">
          <Package className="h-5 w-5 text-emerald-600 mb-1" />
          <div className="font-display text-xl font-bold">{formatCurrency(totalValue)}</div>
          <div className="text-xs text-muted-foreground">общая стоимость</div>
        </Card>
        <Card className="p-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 mb-1" />
          <div className="font-display text-xl font-bold">{lowStockItems.length}</div>
          <div className="text-xs text-muted-foreground">заканчивается</div>
        </Card>
        <Card className="p-3">
          <Clock className="h-5 w-5 text-red-600 mb-1" />
          <div className="font-display text-xl font-bold">{expiringItems.length}</div>
          <div className="text-xs text-muted-foreground">истекает срок</div>
        </Card>
      </div>

      {/* Alerts */}
      {(lowStockItems.length > 0 || expiringItems.length > 0) && (
        <Card className="p-4 bg-amber-50 border-amber-200">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1 text-sm">
              <div className="font-medium text-amber-900 mb-2">Требуется внимание</div>
              <div className="space-y-1">
                {lowStockItems.map((item) => (
                  <div key={item.id} className="text-amber-800 text-xs flex items-center justify-between">
                    <span>
                      • <strong>{item.name}</strong>: {item.quantity} {item.unit} (мин: {item.minQuantity})
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[10px]"
                      onClick={() => setShowAddMovement(item.id)}
                    >
                      Пополнить
                    </Button>
                  </div>
                ))}
                {expiringItems.map((item) => {
                  const days = Math.ceil((new Date(item.expiryDate!).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                  return (
                    <div key={item.id} className="text-red-800 text-xs">
                      • <strong>{item.name}</strong>: срок годности истекает через {days} дн. ({formatDate(item.expiryDate!)})
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Inventory table */}
      <Card className="p-4">
        <h3 className="font-semibold mb-3">Остатки на складе</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="pb-2 pr-3">Наименование</th>
                <th className="pb-2 pr-3">Категория</th>
                <th className="pb-2 pr-3 text-right">Кол-во</th>
                <th className="pb-2 pr-3 text-right">Мин.</th>
                <th className="pb-2 pr-3 text-right">Цена/ед</th>
                <th className="pb-2 pr-3 text-right">Сумма</th>
                <th className="pb-2 pr-3">Срок</th>
                <th className="pb-2 pr-3">Стеллаж</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {myItems.map((item) => {
                const isLow = item.quantity <= item.minQuantity;
                const daysToExpiry = item.expiryDate
                  ? Math.ceil((new Date(item.expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                  : null;
                const isExpiringSoon = daysToExpiry !== null && daysToExpiry <= 7 && daysToExpiry >= 0;
                const isExpired = daysToExpiry !== null && daysToExpiry < 0;
                return (
                  <tr key={item.id} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-medium">{item.name}</td>
                    <td className="py-2 pr-3 text-muted-foreground text-xs">{item.category}</td>
                    <td className={`py-2 pr-3 text-right font-medium ${isLow ? "text-amber-600" : ""}`}>
                      {item.quantity} {item.unit}
                    </td>
                    <td className="py-2 pr-3 text-right text-muted-foreground text-xs">
                      {item.minQuantity}
                    </td>
                    <td className="py-2 pr-3 text-right text-xs">
                      {formatCurrency(item.costPerUnit)}
                    </td>
                    <td className="py-2 pr-3 text-right font-medium">
                      {formatCurrency(item.quantity * item.costPerUnit)}
                    </td>
                    <td className="py-2 pr-3 text-xs">
                      {item.expiryDate ? (
                        <span className={isExpired ? "text-red-600" : isExpiringSoon ? "text-amber-600" : "text-muted-foreground"}>
                          {formatDate(item.expiryDate)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">
                      {item.storageLocation || "—"}
                    </td>
                    <td className="py-2">
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => setShowAddMovement(item.id)}
                        >
                          <ArrowDownUp className="h-3 w-3 mr-1" />
                          Движение
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Stock movements */}
      <Card className="p-4">
        <h3 className="font-semibold mb-3">Последние движения</h3>
        <div className="space-y-2">
          {myMovements.slice(0, 8).map((m) => (
            <div key={m.id} className="flex items-center justify-between p-2 border border-border rounded text-sm">
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className={
                    m.type === "incoming"
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]"
                      : m.type === "outgoing"
                      ? "bg-blue-50 text-blue-700 border-blue-200 text-[10px]"
                      : m.type === "waste"
                      ? "bg-red-50 text-red-700 border-red-200 text-[10px]"
                      : "bg-slate-50 text-slate-700 border-slate-200 text-[10px]"
                  }
                >
                  {m.type === "incoming" ? "Поступление" : m.type === "outgoing" ? "Списание" : m.type === "waste" ? "Брак" : "Корректировка"}
                </Badge>
                <div>
                  <div className="font-medium text-xs">{m.itemName}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {m.reason} • {formatDateTime(m.date)}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className={`font-medium ${m.type === "incoming" ? "text-emerald-600" : "text-red-600"}`}>
                  {m.type === "incoming" ? "+" : "−"}{m.quantity} {m.unit}
                </div>
                {m.totalCost && (
                  <div className="text-[10px] text-muted-foreground">
                    {formatCurrency(m.totalCost)}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Add movement dialog */}
      {showAddMovement && (
        <AddMovementDialog
          item={myItems.find((i) => i.id === showAddMovement)!}
          onClose={() => setShowAddMovement(null)}
          onAdd={(movement) => {
            addStockMovement(movement);
            toast.success("Движение добавлено");
            setShowAddMovement(null);
          }}
        />
      )}
    </div>
  );
}

function AddMovementDialog({
  item,
  onClose,
  onAdd,
}: {
  item: InventoryItem;
  onClose: () => void;
  onAdd: (movement: Omit<import("@/lib/types").StockMovement, "id" | "date">) => void;
}) {
  const [type, setType] = useState<"incoming" | "outgoing" | "waste" | "adjustment">("incoming");
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState("");

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Движение по складу</DialogTitle>
          <DialogDescription>
            {item.name} • Текущий остаток: {item.quantity} {item.unit}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Тип операции</Label>
            <Select value={type} onValueChange={(v) => setType(v as any)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="incoming">Поступление</SelectItem>
                <SelectItem value="outgoing">Списание на заказ</SelectItem>
                <SelectItem value="waste">Списание (брак)</SelectItem>
                <SelectItem value="adjustment">Корректировка</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Количество ({item.unit})</Label>
            <Input
              type="number"
              step="0.1"
              value={quantity}
              onChange={(e) => setQuantity(+e.target.value)}
            />
          </div>
          <div>
            <Label>Причина</Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={type === "incoming" ? "Поставка от поставщика" : type === "waste" ? "Истёк срок / брак" : "Заказ UK-XXXX"}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button
            onClick={() =>
              onAdd({
                itemId: item.id,
                itemName: item.name,
                type,
                quantity,
                unit: item.unit,
                reason,
                costPerUnit: item.costPerUnit,
                totalCost: quantity * item.costPerUnit,
                createdBy: "Мария Уездная",
              })
            }
          >
            Добавить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ==================== ВКЛАДКА ПРОИЗВОДСТВО (ГАНТ) ====================
export function ConfectionerGanttTab() {
  const ganttTasks = useAppStore((s) => s.ganttTasks);
  const updateGanttTask = useAppStore((s) => s.updateGanttTask);
  const orders = useAppStore((s) => s.orders);
  const [viewMode, setViewMode] = useState<"day" | "week">("day");

  // Группируем по заказам
  const ordersMap = new Map<string, GanttTask[]>();
  ganttTasks.forEach((task) => {
    if (!ordersMap.has(task.orderId)) {
      ordersMap.set(task.orderId, []);
    }
    ordersMap.get(task.orderId)!.push(task);
  });

  // Часы для отображения (8:00 - 20:00)
  const hours = Array.from({ length: 13 }, (_, i) => 8 + i);
  // Дни недели
  const today = new Date("2026-06-30");
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    return d;
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "bg-emerald-500";
      case "in_progress":
        return "bg-primary";
      case "delayed":
        return "bg-red-500";
      case "cancelled":
        return "bg-slate-300";
      default:
        return "bg-blue-300";
    }
  };

  const handleAdvanceStage = (task: GanttTask) => {
    const stages: ProductionStage[] = [
      "preparation",
      "baking",
      "cooling",
      "assembling",
      "decorating",
      "packaging",
      "delivery_prep",
      "completed",
    ];
    const currentIdx = stages.indexOf(task.stage);
    if (currentIdx < stages.length - 1) {
      const nextStage = stages[currentIdx + 1];
      const nextStageInfo = PRODUCTION_STAGES[nextStage];
      updateGanttTask(task.id, {
        stage: nextStage,
        stageLabel: nextStageInfo.label,
        status: nextStage === "completed" ? "completed" : "in_progress",
        progress: nextStage === "completed" ? 100 : 50,
      });
      toast.success(`Этап: ${nextStageInfo.label}`, {
        description: `Заказ ${task.orderNumber}`,
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">Производство — таблица Ганта</h1>
          <p className="text-sm text-muted-foreground">
            Планирование и контроль исполнения заказов по этапам производства.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant={viewMode === "day" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("day")}
          >
            День
          </Button>
          <Button
            variant={viewMode === "week" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("week")}
          >
            Неделя
          </Button>
        </div>
      </div>

      {/* Legend */}
      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <span className="font-medium">Этапы:</span>
          {Object.entries(PRODUCTION_STAGES).map(([key, info]) => (
            <div key={key} className="flex items-center gap-1.5">
              <div
                className="h-3 w-3 rounded"
                style={{ backgroundColor: info.color }}
              />
              <span>{info.icon} {info.label}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Gantt chart */}
      <Card className="p-4 overflow-x-auto">
        {viewMode === "day" ? (
          <div className="min-w-[800px]">
            {/* Hours header */}
            <div className="flex border-b pb-2 mb-2">
              <div className="w-64 shrink-0 text-xs font-semibold text-muted-foreground">
                Заказ / Этап
              </div>
              <div className="flex-1 grid grid-cols-13 gap-px">
                {hours.map((h) => (
                  <div key={h} className="text-[10px] text-center text-muted-foreground">
                    {h}:00
                  </div>
                ))}
              </div>
            </div>

            {/* Tasks */}
            <div className="space-y-1">
              {Array.from(ordersMap.entries()).map(([orderId, tasks]) => {
                const order = orders.find((o) => o.id === orderId);
                return (
                  <div key={orderId}>
                    {/* Order header */}
                    <div className="flex items-center gap-2 py-1 px-2 bg-muted/30 rounded text-xs">
                      <span className="font-semibold">{tasks[0].orderNumber}</span>
                      <span className="text-muted-foreground">{tasks[0].customerName}</span>
                      <span className="text-muted-foreground">•</span>
                      <span className="text-muted-foreground">{tasks[0].productName}</span>
                      {order && (
                        <Badge
                          variant="outline"
                          className="ml-auto text-[10px]"
                        >
                          Доставка: {formatDate(order.deliveryDate)}
                        </Badge>
                      )}
                    </div>

                    {/* Tasks */}
                    {tasks.map((task) => {
                      const startHour = new Date(task.startDate).getHours();
                      const startMinute = new Date(task.startDate).getMinutes();
                      const endHour = new Date(task.endDate).getHours();
                      const endMinute = new Date(task.endDate).getMinutes();
                      const startPercent = ((startHour - 8) + startMinute / 60) / 12 * 100;
                      const widthPercent = ((endHour - startHour) + (endMinute - startMinute) / 60) / 12 * 100;
                      const stageInfo = PRODUCTION_STAGES[task.stage];
                      return (
                        <div key={task.id} className="flex items-center py-1">
                          <div className="w-64 shrink-0 pr-3 text-xs flex items-center gap-1.5">
                            <span>{stageInfo.icon}</span>
                            <span className="truncate">{task.stageLabel}</span>
                            {task.assignee && (
                              <span className="text-[10px] text-muted-foreground">({task.assignee})</span>
                            )}
                          </div>
                          <div className="flex-1 relative h-7">
                            {/* Hour grid */}
                            <div className="absolute inset-0 grid grid-cols-12">
                              {Array.from({ length: 12 }).map((_, i) => (
                                <div key={i} className="border-r border-border/40" />
                              ))}
                            </div>
                            {/* Task bar */}
                            <div
                              className="absolute top-1 bottom-1 rounded flex items-center px-2 text-[10px] text-white font-medium overflow-hidden cursor-pointer hover:opacity-90 transition-opacity"
                              style={{
                                left: `${startPercent}%`,
                                width: `${Math.max(2, widthPercent)}%`,
                                backgroundColor: task.color,
                              }}
                              onClick={() => handleAdvanceStage(task)}
                              title={`${task.stageLabel} — нажмите для перехода к следующему этапу`}
                            >
                              <div
                                className="absolute inset-0 bg-black/20 rounded"
                                style={{ width: `${task.progress}%` }}
                              />
                              <span className="relative z-10 truncate">
                                {task.progress}% • {task.duration}мин
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="min-w-[900px]">
            {/* Days header */}
            <div className="flex border-b pb-2 mb-2">
              <div className="w-64 shrink-0 text-xs font-semibold text-muted-foreground">
                Заказ
              </div>
              <div className="flex-1 grid grid-cols-7 gap-1">
                {days.map((d, i) => (
                  <div key={i} className="text-[10px] text-center">
                    <div className="font-medium">
                      {["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"][d.getDay()]}
                    </div>
                    <div className="text-muted-foreground">
                      {d.getDate()}.{d.getMonth() + 1}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Tasks per order */}
            <div className="space-y-2">
              {Array.from(ordersMap.entries()).map(([orderId, tasks]) => {
                const order = orders.find((o) => o.id === orderId);
                const orderDate = new Date(tasks[0].startDate);
                const dayIdx = Math.floor((orderDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
                return (
                  <div key={orderId} className="flex items-center py-1">
                    <div className="w-64 shrink-0 pr-3">
                      <div className="text-xs font-semibold">{tasks[0].orderNumber}</div>
                      <div className="text-[10px] text-muted-foreground">{tasks[0].productName}</div>
                    </div>
                    <div className="flex-1 grid grid-cols-7 gap-1 relative h-10">
                      {days.map((d, i) => {
                        const dayTasks = tasks.filter((t) => {
                          const td = new Date(t.startDate);
                          return td.getDate() === d.getDate() && td.getMonth() === d.getMonth();
                        });
                        return (
                          <div key={i} className="border border-border/40 rounded relative">
                            {dayTasks.map((t, ti) => {
                              const stageInfo = PRODUCTION_STAGES[t.stage];
                              return (
                                <div
                                  key={ti}
                                  className="absolute left-0 right-0 rounded text-[9px] text-white px-1 py-0.5 truncate"
                                  style={{
                                    top: `${ti * 18}px`,
                                    backgroundColor: t.color,
                                  }}
                                  title={`${t.stageLabel} — ${t.duration}мин`}
                                >
                                  {stageInfo.icon} {t.stageLabel}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>

      {/* Active orders summary */}
      <Card className="p-4">
        <h3 className="font-semibold mb-3">Активные заказы — сроки</h3>
        <div className="space-y-2">
          {Array.from(ordersMap.entries()).map(([orderId, tasks]) => {
            const order = orders.find((o) => o.id === orderId);
            const inProgress = tasks.filter((t) => t.status === "in_progress");
            const pending = tasks.filter((t) => t.status === "pending");
            const completed = tasks.filter((t) => t.status === "completed");
            const totalProgress = tasks.length > 0
              ? Math.round((completed.length / tasks.length) * 100)
              : 0;
            return (
              <div key={orderId} className="flex items-center gap-3 p-2 border border-border rounded">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-sm">{tasks[0].orderNumber}</span>
                    <span className="text-xs text-muted-foreground">{tasks[0].customerName}</span>
                    <span className="text-xs text-muted-foreground">•</span>
                    <span className="text-xs text-muted-foreground truncate">{tasks[0].productName}</span>
                  </div>
                  <Progress value={totalProgress} className="h-1.5" />
                </div>
                <div className="text-right text-xs shrink-0">
                  <div className="text-muted-foreground">
                    {completed.length}/{tasks.length} этапов
                  </div>
                  {inProgress[0] && (
                    <div className="text-primary font-medium">
                      Сейчас: {inProgress[0].stageLabel}
                    </div>
                  )}
                </div>
                {order && (
                  <div className="text-right text-xs shrink-0">
                    <div className="text-muted-foreground">Доставка</div>
                    <div className="font-medium">{formatDate(order.deliveryDate)}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

// ==================== ВКЛАДКА НАПОМИНАНИЯ ====================
export function ConfectionerRemindersTab() {
  const reminders = useAppStore((s) => s.reminders);
  const markReminderRead = useAppStore((s) => s.markReminderRead);
  const markReminderDone = useAppStore((s) => s.markReminderDone);
  const navigate = useAppStore((s) => s.navigate);

  const [filter, setFilter] = useState<"all" | "today" | "overdue" | "urgent">("all");

  const filtered = reminders.filter((r) => {
    if (r.isDone) return false;
    const due = new Date(r.dueDate);
    const now = new Date();
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59);
    switch (filter) {
      case "today":
        return due <= todayEnd;
      case "overdue":
        return due < now;
      case "urgent":
        return r.priority === "urgent" || r.priority === "high";
      default:
        return true;
    }
  });

  const unreadCount = reminders.filter((r) => !r.isRead && !r.isDone).length;
  const overdueCount = reminders.filter((r) => {
    return !r.isDone && new Date(r.dueDate) < new Date();
  }).length;
  const urgentCount = reminders.filter((r) => !r.isDone && (r.priority === "urgent" || r.priority === "high")).length;

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "urgent":
        return "bg-red-100 text-red-800 border-red-200";
      case "high":
        return "bg-amber-100 text-amber-800 border-amber-200";
      case "medium":
        return "bg-blue-100 text-blue-800 border-blue-200";
      default:
        return "bg-slate-100 text-slate-800 border-slate-200";
    }
  };

  const getTypeInfo = (type: string) => {
    switch (type) {
      case "order_deadline":
        return { icon: Clock, label: "Срок заказа", color: "text-primary" };
      case "restock":
        return { icon: Package, label: "Склад", color: "text-amber-600" };
      case "expiry":
        return { icon: AlertTriangle, label: "Срок годности", color: "text-red-600" };
      case "promotion_end":
        return { icon: Sparkles, label: "Акция", color: "text-purple-600" };
      case "review_request":
        return { icon: MessageCircle, label: "Отзыв", color: "text-blue-600" };
      case "payment":
        return { icon: Tag, label: "Платёж", color: "text-emerald-600" };
      default:
        return { icon: Bell, label: "Напоминание", color: "text-muted-foreground" };
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-bold flex items-center gap-2">
          Напоминания
          {unreadCount > 0 && (
            <Badge className="bg-primary text-primary-foreground">
              <BellRing className="h-3 w-3 mr-1" />
              {unreadCount}
            </Badge>
          )}
        </h1>
        <p className="text-sm text-muted-foreground">
          Сроки исполнения заказов, пополнение склада, окончание акций.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant={filter === "all" ? "default" : "outline"}
          size="sm"
          onClick={() => setFilter("all")}
        >
          Все ({reminders.filter((r) => !r.isDone).length})
        </Button>
        <Button
          variant={filter === "today" ? "default" : "outline"}
          size="sm"
          onClick={() => setFilter("today")}
        >
          Сегодня
        </Button>
        <Button
          variant={filter === "overdue" ? "default" : "outline"}
          size="sm"
          onClick={() => setFilter("overdue")}
          className={overdueCount > 0 ? "text-red-600" : ""}
        >
          Просрочено ({overdueCount})
        </Button>
        <Button
          variant={filter === "urgent" ? "default" : "outline"}
          size="sm"
          onClick={() => setFilter("urgent")}
          className={urgentCount > 0 ? "text-amber-600" : ""}
        >
          Срочные ({urgentCount})
        </Button>
      </div>

      {/* Reminders list */}
      <div className="space-y-2">
        {filtered.map((reminder) => {
          const typeInfo = getTypeInfo(reminder.type);
          const TypeIcon = typeInfo.icon;
          const due = new Date(reminder.dueDate);
          const now = new Date();
          const isOverdue = due < now;
          const isToday = due.toDateString() === now.toDateString();
          const timeUntil = due.getTime() - now.getTime();
          const hoursUntil = Math.floor(timeUntil / (1000 * 60 * 60));
          const daysUntil = Math.floor(hoursUntil / 24);
          return (
            <Card
              key={reminder.id}
              className={`p-3 ${!reminder.isRead ? "border-primary/40 bg-primary/5" : ""} ${
                isOverdue ? "border-red-300 bg-red-50" : ""
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 bg-muted`}>
                  <TypeIcon className={`h-5 w-5 ${typeInfo.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div>
                      <div className="font-medium text-sm flex items-center gap-2">
                        {reminder.title}
                        {!reminder.isRead && (
                          <span className="h-2 w-2 rounded-full bg-primary" />
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {reminder.description}
                      </div>
                    </div>
                    <Badge variant="outline" className={`text-[10px] shrink-0 ${getPriorityColor(reminder.priority)}`}>
                      {reminder.priority === "urgent"
                        ? "Срочно"
                        : reminder.priority === "high"
                        ? "Важно"
                        : reminder.priority === "medium"
                        ? "Средне"
                        : "Низкий"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <div className="text-xs">
                      {isOverdue ? (
                        <span className="text-red-600 font-medium">
                          Просрочено на {Math.abs(daysUntil)} дн.
                        </span>
                      ) : isToday ? (
                        <span className="text-amber-600 font-medium">
                          Сегодня в {due.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      ) : daysUntil === 1 ? (
                        <span className="text-blue-600">Завтра</span>
                      ) : (
                        <span className="text-muted-foreground">
                          {formatDateTime(reminder.dueDate)}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => markReminderRead(reminder.id)}
                      >
                        Прочитано
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => {
                          markReminderDone(reminder.id);
                          toast.success("Напоминание выполнено");
                        }}
                      >
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Готово
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <Card className="p-12 text-center">
          <Bell className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <h3 className="font-semibold mb-1">Нет напоминаний</h3>
          <p className="text-sm text-muted-foreground">
            Все задачи под контролем
          </p>
        </Card>
      )}
    </div>
  );
}
