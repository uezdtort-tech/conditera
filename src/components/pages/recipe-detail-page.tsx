"use client";

import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft,
  Clock,
  Users,
  ChefHat,
  Flame,
  Heart,
  Share2,
  Bookmark,
  Check,
  Minus,
  Plus,
  MapPin,
  Star,
  Truck,
  Package,
  ShoppingBag,
  Navigation,
  Search,
  Zap,
  X,
} from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/finance";

const RECIPE_DIFFICULTY = {
  easy: { label: "Легко", color: "bg-emerald-100 text-emerald-800", stars: "★☆☆" },
  medium: { label: "Средне", color: "bg-amber-100 text-amber-800", stars: "★★☆" },
  hard: { label: "Сложно", color: "bg-red-100 text-red-800", stars: "★★★" },
};

export function RecipeDetailPage() {
  const navigate = useAppStore((s) => s.navigate);
  const nav = useAppStore((s) => s.nav);
  const recipes = useAppStore((s) => s.recipes);
  const user = useAppStore((s) => s.user);
  const confectioners = useAppStore((s) => s.confectioners);
  const [checkedSteps, setCheckedSteps] = useState<Set<number>>(new Set());
  const [servings, setServings] = useState(4);
  const [acceptances, setAcceptances] = useState<any[]>([]);
  const [loadingAcceptances, setLoadingAcceptances] = useState(false);
  const [myAcceptance, setMyAcceptance] = useState(false);
  const [acceptPrice, setAcceptPrice] = useState("");
  const [acceptDays, setAcceptDays] = useState("3");
  const [userCity, setUserCity] = useState("");
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);

  const recipe = recipes.find((r) => r.id === nav.params?.id);

  // Загружаем сохранённую геолокацию из localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem("recipe_user_location");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.coords) setUserCoords(parsed.coords);
        if (parsed.city) setUserCity(parsed.city);
      }
    } catch {}
  }, []);

  // Загружаем подтверждения от кондитеров (с координатами пользователя для расчёта расстояния)
  useEffect(() => {
    if (!recipe) return;
    setLoadingAcceptances(true);
    const params = new URLSearchParams();
    if (userCoords) {
      params.set("lat", String(userCoords.lat));
      params.set("lng", String(userCoords.lng));
    } else if (userCity.trim()) {
      params.set("city", userCity.trim());
    }
    const qs = params.toString() ? `?${params.toString()}` : "";
    fetch(`/api/recipes/${recipe.id}/acceptances${qs}`)
      .then(res => res.ok ? res.json() : { acceptances: [] })
      .then(data => {
        setAcceptances(data.acceptances || []);
        // Проверяем — подтвердил ли текущий кондитер
        if (user?.id) {
          const mine = (data.acceptances || []).find((a: any) => a.confectioner?.userId === user.id);
          setMyAcceptance(!!mine);
        }
      })
      .catch(() => setAcceptances([]))
      .finally(() => setLoadingAcceptances(false));
  }, [recipe?.id, user?.id, userCoords, userCity]);

  // Геолокация по кнопке
  const handleGeolocate = () => {
    if (!navigator.geolocation) {
      toast.error("Геолокация не поддерживается вашим браузером");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserCoords(coords);
        setUserCity("");
        try { localStorage.setItem("recipe_user_location", JSON.stringify({ coords })); } catch {}
        toast.success("Местоположение определено");
        setLocating(false);
      },
      (err) => {
        toast.error("Не удалось определить геолокацию: " + err.message);
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  // Поиск по городу/адресу
  const handleCitySearch = () => {
    if (!userCity.trim()) return;
    setUserCoords(null);
    try { localStorage.setItem("recipe_user_location", JSON.stringify({ city: userCity.trim() })); } catch {}
    // запрос с пересчётом через геокодер (если город неизвестен словарю, API обратится к DaData/Яндекс)
    setLoadingAcceptances(true);
    const params = new URLSearchParams();
    params.set("q", userCity.trim());
    fetch(`/api/recipes/${recipe?.id}/acceptances?${params.toString()}`)
      .then(res => res.ok ? res.json() : { acceptances: [] })
      .then(data => {
        setAcceptances(data.acceptances || []);
        if (data.userLocation?.source && data.userLocation.source !== "city_dict") {
          toast.success(`Адрес определён через ${data.userLocation.source === "dadata" ? "DaData" : "Яндекс.Геокодер"}`);
        }
      })
      .catch(() => setAcceptances([]))
      .finally(() => setLoadingAcceptances(false));
  };

  const handleClearLocation = () => {
    setUserCoords(null);
    setUserCity("");
    try { localStorage.removeItem("recipe_user_location"); } catch {}
  };

  const nearestAcceptance = acceptances.find(a => a.isNearest);

  // Кондитер подтверждает готовность
  const handleAcceptRecipe = async () => {
    if (!user || !recipe) return;
    const roles = user.roles || [];
    if (!roles.includes("CONFECTIONER")) {
      toast.error("Только кондитеры могут подтверждать готовность");
      return;
    }
    try {
      const res = await fetch(`/api/recipes/${recipe.id}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          priceFrom: parseInt(acceptPrice) || 1500,
          prepDays: parseInt(acceptDays) || 3,
          delivery: true,
          selfPickup: true,
        }),
      });
      if (res.ok) {
        toast.success("Вы подтвердили готовность испечь этот рецепт!");
        setMyAcceptance(true);
        // Обновляем список
        const data = await res.json();
        setAcceptances(prev => [...prev, { acceptanceId: data.acceptanceId, priceFrom: parseInt(acceptPrice) || 1500, confectioner: { businessName: user.name, avatar: user.avatar, city: "", rating: 0, verified: false } }]);
      } else {
        const err = await res.json();
        toast.error(err.error || "Ошибка");
      }
    } catch (e) {
      toast.error("Ошибка сети");
    }
  };

  if (!recipe) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <ChefHat className="h-12 w-12 mx-auto mb-3 text-muted-foreground" />
        <h2 className="font-display text-2xl font-bold mb-2">Рецепт не найден</h2>
        <Button onClick={() => navigate("recipes")} className="mt-4">
          <ArrowLeft className="h-4 w-4 mr-2" />
          К рецептам
        </Button>
      </div>
    );
  }

  const diff = RECIPE_DIFFICULTY[recipe.difficulty as keyof typeof RECIPE_DIFFICULTY] || RECIPE_DIFFICULTY.easy;
  const totalTime = (recipe.prepTime || 0) + (recipe.cookTime || 0);

  const ingredients = (recipe.ingredients as any[]) || [];
  const steps = (recipe.steps as any[]) || [];

  const toggleStep = (i: number) => {
    setCheckedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  return (
    <div className="container mx-auto px-4 py-6 lg:py-10 max-w-4xl">
      {/* Back button */}
      <Button
        variant="ghost"
        onClick={() => navigate("recipes")}
        className="mb-4 -ml-2"
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        Назад к рецептам
      </Button>

      {/* Hero */}
      <div className="relative rounded-2xl overflow-hidden mb-6 aspect-[16/9]">
        <img
          src={recipe.coverImage}
          alt={recipe.title}
          className="w-full h-full object-cover"
          loading="lazy"
          decoding="async"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
        <div className="absolute bottom-4 left-4 right-4">
          <div className="flex items-center gap-2 mb-2">
            <Badge className={diff.color}>{diff.stars} {diff.label}</Badge>
            <Badge variant="secondary">{recipe.type === "recipe" ? "Рецепт" : "Статья"}</Badge>
            {recipe.tags.slice(0, 3).map((tag) => (
              <Badge key={tag} variant="outline" className="text-white border-white/30">
                {tag}
              </Badge>
            ))}
          </div>
          <h1 className="font-display text-2xl lg:text-3xl font-bold text-white">
            {recipe.title}
          </h1>
        </div>
      </div>

      {/* Info bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <Card className="p-3 text-center">
          <Clock className="h-5 w-5 mx-auto mb-1 text-primary" />
          <div className="text-xs text-muted-foreground">Общее время</div>
          <div className="font-semibold">{totalTime} мин</div>
        </Card>
        <Card className="p-3 text-center">
          <Users className="h-5 w-5 mx-auto mb-1 text-primary" />
          <div className="text-xs text-muted-foreground">Порций</div>
          <div className="font-semibold">{servings}</div>
        </Card>
        <Card className="p-3 text-center">
          <ChefHat className="h-5 w-5 mx-auto mb-1 text-primary" />
          <div className="text-xs text-muted-foreground">Подготовка</div>
          <div className="font-semibold">{recipe.prepTime || 0} мин</div>
        </Card>
        <Card className="p-3 text-center">
          <Flame className="h-5 w-5 mx-auto mb-1 text-primary" />
          <div className="text-xs text-muted-foreground">Запекание</div>
          <div className="font-semibold">{recipe.cookTime || 0} мин</div>
        </Card>
      </div>

      {/* Description */}
      <Card className="p-6 mb-6">
        <p className="text-muted-foreground leading-relaxed">{recipe.description}</p>
      </Card>

      {/* Actions */}
      <div className="flex gap-2 mb-6">
        <Button
          variant="outline"
          size="sm"
          onClick={() => toast.success("Добавлено в избранное")}
          className="gap-2"
        >
          <Heart className="h-4 w-4" />
          В избранное
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            navigator.clipboard?.writeText(window.location.href);
            toast.success("Ссылка скопирована");
          }}
          className="gap-2"
        >
          <Share2 className="h-4 w-4" />
          Поделиться
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => toast.success("Сохранено")}
          className="gap-2"
        >
          <Bookmark className="h-4 w-4" />
          Сохранить
        </Button>
      </div>

      <div className="grid lg:grid-cols-[1fr_2fr] gap-6">
        {/* Ingredients */}
        <div>
          <Card className="p-5 sticky top-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-lg font-bold">Ингредиенты</h2>
              <div className="flex items-center gap-2">
                <Button
                  size="icon"
                  variant="outline"
                  className="h-7 w-7"
                  onClick={() => setServings(Math.max(1, servings - 1))}
                >
                  <Minus className="h-3 w-3" />
                </Button>
                <span className="font-semibold w-6 text-center">{servings}</span>
                <Button
                  size="icon"
                  variant="outline"
                  className="h-7 w-7"
                  onClick={() => setServings(Math.min(20, servings + 1))}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            </div>
            <Separator className="mb-3" />
            <ul className="space-y-2">
              {ingredients.length > 0 ? (
                ingredients.map((ing: any, i: number) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <div className="h-4 w-4 rounded-full border-2 border-primary/30 mt-0.5 shrink-0" />
                    <span className="text-muted-foreground">
                      {ing.name || ing.title || ing}
                      {ing.amount ? ` — ${ing.amount}` : ing.quantity ? ` — ${ing.quantity}` : ""}
                      {ing.unit ? ` ${ing.unit}` : ""}
                    </span>
                  </li>
                ))
              ) : (
                <li className="text-sm text-muted-foreground">Ингредиенты не указаны</li>
              )}
            </ul>
          </Card>
        </div>

        {/* Steps */}
        <div>
          <h2 className="font-display text-lg font-bold mb-4">Этапы приготовления</h2>
          <div className="space-y-3">
            {steps.length > 0 ? (
              steps.map((step: any, i: number) => {
                const isChecked = checkedSteps.has(i);
                return (
                  <Card
                    key={i}
                    className={`p-4 cursor-pointer transition-all ${
                      isChecked ? "opacity-60 bg-emerald-50/50" : "hover:border-primary/30"
                    }`}
                    onClick={() => toggleStep(i)}
                  >
                    <div className="flex gap-3">
                      <div
                        className={`h-8 w-8 rounded-full flex items-center justify-center font-bold shrink-0 ${
                          isChecked ? "bg-emerald-500 text-white" : "bg-primary/10 text-primary"
                        }`}
                      >
                        {isChecked ? <Check className="h-4 w-4" /> : i + 1}
                      </div>
                      <div className="flex-1">
                        <p className={`text-sm leading-relaxed ${isChecked ? "line-through" : ""}`}>
                          {typeof step === "string" ? step : step.text || step.description || ""}
                        </p>
                        {typeof step === "object" && step.image && (
                          <img
                            src={step.image}
                            alt={`Шаг ${i + 1}`}
                            className="mt-2 rounded-lg w-full max-h-48 object-cover"
                            loading="lazy"
                            decoding="async"
                          />
                        )}
                        {typeof step === "object" && (step.time || step.duration) && (
                          <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {step.time || step.duration} мин
                          </div>
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })
            ) : (
              <Card className="p-6 text-center text-muted-foreground">
                Этапы приготовления не указаны
              </Card>
            )}
          </div>

          {/* Recommendations */}
          <Card className="p-5 mt-6 bg-primary/5 border-primary/20">
            <h3 className="font-display font-bold mb-2 flex items-center gap-2">
              <ChefHat className="h-4 w-4 text-primary" />
              Рекомендации от кондитера
            </h3>
            <ul className="space-y-1.5 text-sm text-muted-foreground">
              <li>• Все ингредиенты должны быть комнатной температуры</li>
              <li>• Тесто не перемешивайте слишком долго — это сделает выпечку плотной</li>
              <li>• Духовку разогрейте заранее до нужной температуры</li>
              <li>• Проверяйте готовность зубочисткой — она должна выходить сухой</li>
              <li>• Дайте торту полностью остыть перед украшением</li>
            </ul>
          </Card>

          {/* Progress */}
          {checkedSteps.size > 0 && (
            <div className="mt-6 p-4 bg-emerald-50 rounded-lg text-center">
              <p className="text-sm text-emerald-700">
                Готово: {checkedSteps.size} из {steps.length} шагов
                {checkedSteps.size === steps.length && " 🎉 Рецепт готов!"}
              </p>
              <div className="h-2 bg-emerald-200 rounded-full mt-2 overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all"
                  style={{ width: `${(checkedSteps.size / Math.max(steps.length, 1)) * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* === Кондитеры готовы испечь по этому рецепту === */}
      <div className="mt-8">
        <h2 className="font-display text-xl font-bold mb-4 flex items-center gap-2">
          <ChefHat className="h-5 w-5 text-primary" />
          Кондитеры готовы испечь
          {acceptances.length > 0 && (
            <Badge className="ml-2 bg-primary/10 text-primary">{acceptances.length}</Badge>
          )}
        </h2>

        {/* Поле «Где вы находитесь?» для расчёта ближайшего кондитера */}
        <Card className="p-4 mb-4 border-primary/20">
          <div className="flex flex-wrap items-center gap-2">
            <MapPin className="h-4 w-4 text-primary shrink-0" />
            <span className="text-sm font-medium shrink-0">Где вы находитесь?</span>
            <input
              type="text"
              value={userCity}
              onChange={e => setUserCity(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleCitySearch(); }}
              placeholder="Город или адрес (Москва, Тула г. Псков, ул. Тверская 12)"
              className="flex-1 min-w-[180px] px-3 py-1.5 border rounded-md bg-background text-sm"
            />
            <Button size="sm" variant="outline" onClick={handleCitySearch} className="gap-1">
              <Search className="h-3.5 w-3.5" />
              Найти
            </Button>
            <Button size="sm" variant="outline" onClick={handleGeolocate} disabled={locating} className="gap-1">
              <Navigation className={`h-3.5 w-3.5 ${locating ? "animate-pulse" : ""}`} />
              {locating ? "Определяю..." : "Моё местоположение"}
            </Button>
            {(userCoords || userCity) && (
              <Button size="sm" variant="ghost" onClick={handleClearLocation} className="gap-1 text-muted-foreground">
                <X className="h-3.5 w-3.5" />
                Сбросить
              </Button>
            )}
          </div>
          {(userCoords || userCity) && (
            <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
              <Check className="h-3 w-3 text-emerald-500" />
              {userCoords
                ? `Координаты: ${userCoords.lat.toFixed(4)}, ${userCoords.lng.toFixed(4)} — кондитеры отсортированы по близости`
                : `Город: ${userCity} — кондитеры отсортированы по близости`}
            </p>
          )}
          {!userCoords && !userCity && (
            <p className="text-xs text-muted-foreground mt-2">
              Укажите город или разрешите геолокацию — покажем ближайших кондитеров, готовых испечь этот рецепт
            </p>
          )}
        </Card>

        {/* Кнопка быстрого заказа у ближайшего */}
        {nearestAcceptance && (
          <Card className="p-4 mb-4 border-emerald-300 bg-gradient-to-r from-emerald-50 to-primary/5">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0">
                <Zap className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm">Ближайший кондитер</span>
                  <Badge className="bg-emerald-100 text-emerald-800 text-[10px]">{Math.round(nearestAcceptance.distanceKm)} км</Badge>
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {nearestAcceptance.confectioner?.businessName || "Кондитер"} • от {formatCurrency(nearestAcceptance.priceFrom || 0)} • {nearestAcceptance.prepDays || 3} дн
                </p>
              </div>
              <Button
                size="sm"
                className="gap-1 shrink-0"
                onClick={() => navigate("confectioner-profile", { id: nearestAcceptance.confectioner?.userId || nearestAcceptance.confectionerId })}
              >
                <ShoppingBag className="h-3.5 w-3.5" />
                Заказать
              </Button>
            </div>
          </Card>
        )}

        {/* Если кондитер — показываем форму подтверждения */}
        {user?.roles?.includes("CONFECTIONER") && !myAcceptance ? (
          <Card className="p-5 mb-4 border-primary/30 bg-primary/5">
            <h3 className="font-semibold mb-3">Я могу испечь этот рецепт</h3>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Цена от (₽)</label>
                <input
                  type="number"
                  value={acceptPrice}
                  onChange={e => setAcceptPrice(e.target.value)}
                  placeholder="1500"
                  className="block w-32 px-3 py-2 border rounded-md bg-background text-sm mt-1"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">За дней</label>
                <input
                  type="number"
                  value={acceptDays}
                  onChange={e => setAcceptDays(e.target.value)}
                  placeholder="3"
                  className="block w-24 px-3 py-2 border rounded-md bg-background text-sm mt-1"
                />
              </div>
              <Button onClick={handleAcceptRecipe} className="gap-2">
                <Check className="h-4 w-4" />
                Подтвердить готовность
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Покупатели увидят вас в списке кондитеров, готовых испечь по этому рецепту
            </p>
          </Card>
        ) : myAcceptance ? (
          <Card className="p-4 mb-4 border-emerald-200 bg-emerald-50/50">
            <p className="text-sm text-emerald-700 flex items-center gap-2">
              <Check className="h-4 w-4" />
              Вы подтвердили готовность испечь этот рецепт
            </p>
          </Card>
        ) : null}

        {/* Список кондитеров */}
        {loadingAcceptances ? (
          <Card className="p-6 text-center text-muted-foreground">
            Загрузка кондитеров...
          </Card>
        ) : acceptances.length === 0 ? (
          <Card className="p-6 text-center text-muted-foreground">
            <ChefHat className="h-8 w-8 mx-auto mb-2 opacity-50" />
            Пока ни один кондитер не подтвердил готовность испечь этот рецепт
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {acceptances.map((a, i) => {
              const conf = a.confectioner || {};
              return (
                <Card key={i} className={`p-4 hover:border-primary/30 transition-colors relative ${a.isNearest ? "border-emerald-400 ring-1 ring-emerald-200" : !a.withinServiceRadius && a.distanceKm !== null ? "opacity-60" : ""}`}>
                  {a.isNearest && (
                    <div className="absolute -top-2 left-3">
                      <Badge className="bg-emerald-500 text-white text-[10px] gap-1">
                        <Zap className="h-2.5 w-2.5" />
                        Ближайший
                      </Badge>
                    </div>
                  )}
                  <div className="flex items-start gap-3">
                    <Avatar className="h-12 w-12 shrink-0">
                      <AvatarImage src={conf.avatar} alt={conf.businessName || "Кондитер"} />
                      <AvatarFallback>{(conf.businessName || "?").slice(0, 2)}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{conf.businessName || "Кондитер"}</span>
                        {conf.verified && (
                          <Badge className="bg-emerald-100 text-emerald-800 text-[10px] shrink-0">✓</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5 flex-wrap">
                        {conf.rating > 0 && (
                          <>
                            <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                            <span>{conf.rating.toFixed(1)}</span>
                            <span>•</span>
                          </>
                        )}
                        {conf.city && (
                          <>
                            <MapPin className="h-3 w-3" />
                            <span>{conf.city}</span>
                            <span>•</span>
                          </>
                        )}
                        {a.distanceKm !== null && (
                          <>
                            <Navigation className={`h-3 w-3 ${a.isNearest ? "text-emerald-500" : ""}`} />
                            <span className={a.isNearest ? "text-emerald-600 font-semibold" : a.withinServiceRadius ? "" : "text-amber-600"}>
                              {a.distanceKm < 1 ? `${Math.round(a.distanceKm * 1000)} м` : `${Math.round(a.distanceKm)} км`}
                              {!a.withinServiceRadius && " (вне зоны)"}
                            </span>
                            <span>•</span>
                          </>
                        )}
                        <Clock className="h-3 w-3" />
                        <span>от {a.prepDays || 3} дн</span>
                      </div>
                      <div className="flex items-center gap-3 mt-2">
                        <span className="text-lg font-display font-bold text-primary">
                          {formatCurrency(a.priceFrom || 0)}
                          {a.priceTo ? ` — ${formatCurrency(a.priceTo)}` : ""}
                        </span>
                        <div className="flex gap-1.5">
                          {a.delivery && (
                            <Badge variant="outline" className="text-[10px] gap-1">
                              <Truck className="h-2.5 w-2.5" /> Доставка
                            </Badge>
                          )}
                          {a.selfPickup && (
                            <Badge variant="outline" className="text-[10px] gap-1">
                              <Package className="h-2.5 w-2.5" /> Самовывоз
                            </Badge>
                          )}
                        </div>
                      </div>
                      {a.notes && (
                        <p className="text-xs text-muted-foreground mt-2 italic">«{a.notes}»</p>
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="w-full mt-3 gap-2"
                    onClick={() => navigate("confectioner-profile", { id: conf.userId || a.confectionerId })}
                  >
                    <ShoppingBag className="h-3.5 w-3.5" />
                    {a.isNearest ? "Заказать у ближайшего" : "Заказать у этого кондитера"}
                  </Button>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
