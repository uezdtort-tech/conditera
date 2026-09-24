"use client";

/**
 * ConfectionerCapabilitiesPanel — панель управления способностями кондитера.
 *
 * Кондитер отмечает что он умеет делать, на основании этого работает поиск:
 *   • Типы изделий (cake, cupcakes, macarons, ...)
 *   • Основы (sponge, mousse, honey, ...)
 *   • Начинки (из БД — 45+ начинок)
 *   • Покрытия (cream_cheese, ganache, mastic, ...)
 *   • Формы (round, square, heart, sphere, book, ...)
 *   • Макс. ярусов (1-4)
 *   • Декор (berries, chocolate_curls, macarons, ...)
 *   • Диета (sugar_free, gluten_free, vegan, ...)
 *   • Доп. навыки (3d_modeling, sugar_flowers, airbrush, ...)
 *   • Доставка и сроки
 */
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { CAKE_BUILDER_OPTIONS } from "@/lib/mock-data";
import { formatCurrency } from "@/lib/finance";
import { toast } from "sonner";
import { Check, Save, Loader2, Truck, User, Calendar } from "lucide-react";

interface Capabilities {
  id?: string;
  confectioner_id?: string;
  product_types: string[];
  bases: string[];
  filling_ids: string[];
  coatings: string[];
  shapes: string[];
  max_tiers: number;
  decorations: string[];
  dietary: string[];
  additional_skills: string[];
  self_pickup: boolean;
  self_delivery: boolean;
  courier_delivery: boolean;
  russia_delivery: boolean;
  min_order_amount: number;
  min_prep_days: number;
  max_prep_days: number;
}

const DIETARY_OPTIONS = [
  { id: "sugar_free", label: "Без сахара (ПП)" },
  { id: "gluten_free", label: "Без глютена" },
  { id: "lactose_free", label: "Без лактозы" },
  { id: "vegan", label: "Веганские" },
  { id: "keto", label: "Кето" },
  { id: "nut_free", label: "Без орехов" },
  { id: "egg_free", label: "Без яиц" },
  { id: "dye_free", label: "Без красителей" },
];

const ADDITIONAL_SKILLS = [
  { id: "3d_modeling", label: "3D-моделирование" },
  { id: "sugar_flowers", label: "Сахарные цветы" },
  { id: "airbrush", label: "Аэрограф" },
  { id: "chocolate_sculpture", label: "Шоколадные скульптуры" },
  { id: "isomalt", label: "Изомальт" },
  { id: "wafer_paper", label: "Вафельная бумага" },
];

export function ConfectionerCapabilitiesPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [fillings, setFillings] = useState<{ id: string; name: string; flavor_group: string }[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      // Загрузить способности кондитера
      const capsRes = await fetch("/api/confectioner/capabilities");
      if (capsRes.ok) {
        const capsData = await capsRes.json();
        if (capsData.capabilities) {
          setCaps(capsData.capabilities);
        } else {
          // Инициализировать пустые способности
          setCaps({
            product_types: [],
            bases: [],
            filling_ids: [],
            coatings: [],
            shapes: [],
            max_tiers: 1,
            decorations: [],
            dietary: [],
            additional_skills: [],
            self_pickup: true,
            self_delivery: false,
            courier_delivery: true,
            russia_delivery: false,
            min_order_amount: 0,
            min_prep_days: 2,
            max_prep_days: 7,
          });
        }
      }

      // Загрузить начинки из БД
      const fillingsRes = await fetch("/api/fillings/list?status=APPROVED&limit=200");
      if (fillingsRes.ok) {
        const fillingsData = await fillingsRes.json();
        setFillings((fillingsData.fillings || []).map((f: { id: string; name: string; flavor_group: string }) => ({
          id: f.id,
          name: f.name,
          flavor_group: f.flavor_group,
        })));
      }
    } catch (err) {
      console.error("[capabilities] load error:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!caps) return;
    setSaving(true);
    try {
      const res = await fetch("/api/confectioner/capabilities", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(caps),
      });
      if (res.ok) {
        toast.success("Способности сохранены!", {
          description: "Теперь покупатели найдут вас по этим параметрам в конструкторе.",
        });
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error("Ошибка сохранения", { description: err.error || "Попробуйте ещё раз" });
      }
    } catch {
      toast.error("Ошибка сети");
    } finally {
      setSaving(false);
    }
  };

  const toggleArray = (key: keyof Capabilities, value: string) => {
    if (!caps) return;
    const arr = caps[key] as string[];
    const updated = arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
    setCaps({ ...caps, [key]: updated });
  };

  if (loading) {
    return (
      <Card className="p-8 text-center">
        <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
        <p className="text-sm text-muted-foreground mt-2">Загрузка способностей...</p>
      </Card>
    );
  }

  if (!caps) {
    return (
      <Card className="p-8 text-center">
        <p className="text-muted-foreground">Не удалось загрузить данные</p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Заголовок */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-xl font-bold">Способности и навыки</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Отметьте что вы умеете — на основе этого покупатели найдут вас в конструкторе
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          {saving ? "Сохранение..." : "Сохранить"}
        </Button>
      </div>

      {/* Типы изделий */}
      <CapabilitySection title="Типы изделий" subtitle="Что вы умеете делать?">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {CAKE_BUILDER_OPTIONS.productTypes.map((opt) => (
            <ToggleChip
              key={opt.id}
              active={caps.product_types.includes(opt.id)}
              onClick={() => toggleArray("product_types", opt.id)}
            >
              <span className="text-xl mr-1">{opt.icon}</span>
              {opt.label}
            </ToggleChip>
          ))}
        </div>
      </CapabilitySection>

      {/* Основы */}
      {caps.product_types.length > 0 && (
        <CapabilitySection title="Основы" subtitle="Какие основы вы делаете?">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {CAKE_BUILDER_OPTIONS.bases.map((opt) => (
              <ToggleChip
                key={opt.id}
                active={caps.bases.includes(opt.id)}
                onClick={() => toggleArray("bases", opt.id)}
              >
                {opt.label}
                {opt.priceBase > 0 && (
                  <span className="text-xs text-muted-foreground ml-1">+{formatCurrency(opt.priceBase)}</span>
                )}
              </ToggleChip>
            ))}
          </div>
        </CapabilitySection>
      )}

      {/* Начинки */}
      <CapabilitySection title="Начинки" subtitle={`${fillings.length} начинок доступно — отметьте те, что вы используете`}>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-60 overflow-y-auto">
          {fillings.map((f) => (
            <ToggleChip
              key={f.id}
              active={caps.filling_ids.includes(f.id)}
              onClick={() => toggleArray("filling_ids", f.id)}
              compact
            >
              {f.name}
            </ToggleChip>
          ))}
        </div>
      </CapabilitySection>

      {/* Покрытия */}
      <CapabilitySection title="Покрытия" subtitle="Какие покрытия вы используете?">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {CAKE_BUILDER_OPTIONS.coatings.map((opt) => (
            <ToggleChip
              key={opt.id}
              active={caps.coatings.includes(opt.id)}
              onClick={() => toggleArray("coatings", opt.id)}
            >
              {opt.label}
              {opt.price > 0 && (
                <span className="text-xs text-muted-foreground ml-1">+{formatCurrency(opt.price)}</span>
              )}
            </ToggleChip>
          ))}
        </div>
      </CapabilitySection>

      {/* Формы */}
      <CapabilitySection title="Формы изделий" subtitle="Какие формы вы умеете делать?">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {CAKE_BUILDER_OPTIONS.shapes.map((opt) => (
            <ToggleChip
              key={opt.id}
              active={caps.shapes.includes(opt.id)}
              onClick={() => toggleArray("shapes", opt.id)}
            >
              <span className="text-xl mr-1">{opt.icon}</span>
              {opt.label}
            </ToggleChip>
          ))}
        </div>
      </CapabilitySection>

      {/* Ярусы */}
      <CapabilitySection title="Количество ярусов" subtitle="Максимум ярусов, которые вы можете сделать">
        <div className="grid grid-cols-4 gap-2">
          {CAKE_BUILDER_OPTIONS.tiers.map((tier) => (
            <button
              key={tier.id}
              onClick={() => setCaps({ ...caps, max_tiers: tier.id })}
              className={`p-4 rounded-lg border-2 transition-all text-center ${
                caps.max_tiers === tier.id
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/40"
              }`}
            >
              <div className="font-bold">{tier.label}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {tier.minGuests}-{tier.maxGuests} гостей
              </div>
            </button>
          ))}
        </div>
      </CapabilitySection>

      {/* Декор */}
      <CapabilitySection title="Декор" subtitle="Какие элементы декора вы делаете?">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {CAKE_BUILDER_OPTIONS.decorations.map((opt) => (
            <ToggleChip
              key={opt.id}
              active={caps.decorations.includes(opt.id)}
              onClick={() => toggleArray("decorations", opt.id)}
            >
              {opt.label}
              <span className="text-xs text-muted-foreground ml-1">+{formatCurrency(opt.price)}</span>
            </ToggleChip>
          ))}
        </div>
      </CapabilitySection>

      {/* Диета и аллергены */}
      <CapabilitySection title="Диета и аллергены" subtitle="Какие диетические варианты вы делаете?">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {DIETARY_OPTIONS.map((opt) => (
            <ToggleChip
              key={opt.id}
              active={caps.dietary.includes(opt.id)}
              onClick={() => toggleArray("dietary", opt.id)}
            >
              {opt.label}
            </ToggleChip>
          ))}
        </div>
      </CapabilitySection>

      {/* Доп. навыки */}
      <CapabilitySection title="Дополнительные навыки" subtitle="Расширенные техники">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {ADDITIONAL_SKILLS.map((opt) => (
            <ToggleChip
              key={opt.id}
              active={caps.additional_skills.includes(opt.id)}
              onClick={() => toggleArray("additional_skills", opt.id)}
            >
              {opt.label}
            </ToggleChip>
          ))}
        </div>
      </CapabilitySection>

      {/* Доставка и сроки */}
      <CapabilitySection title="Доставка и сроки" subtitle="Условия работы">
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <Label className="text-sm font-medium">Доставка</Label>
            <div className="grid grid-cols-2 gap-2">
              <ToggleChip
                active={caps.self_pickup}
                onClick={() => setCaps({ ...caps, self_pickup: !caps.self_pickup })}
              >
                <User className="h-3.5 w-3.5 mr-1 inline" /> Самовывоз
              </ToggleChip>
              <ToggleChip
                active={caps.self_delivery}
                onClick={() => setCaps({ ...caps, self_delivery: !caps.self_delivery })}
              >
                <Truck className="h-3.5 w-3.5 mr-1 inline" /> Своя доставка
              </ToggleChip>
              <ToggleChip
                active={caps.courier_delivery}
                onClick={() => setCaps({ ...caps, courier_delivery: !caps.courier_delivery })}
              >
                <Truck className="h-3.5 w-3.5 mr-1 inline" /> Курьер
              </ToggleChip>
              <ToggleChip
                active={caps.russia_delivery}
                onClick={() => setCaps({ ...caps, russia_delivery: !caps.russia_delivery })}
              >
                <Truck className="h-3.5 w-3.5 mr-1 inline" /> По России
              </ToggleChip>
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <Label className="text-sm font-medium">Минимальный заказ (₽)</Label>
              <Input
                type="number"
                value={Math.floor(caps.min_order_amount / 100)}
                onChange={(e) => setCaps({ ...caps, min_order_amount: parseInt(e.target.value || "0") * 100 })}
                placeholder="1500"
                className="mt-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-sm font-medium">
                  <Calendar className="h-3.5 w-3.5 inline mr-1" /> Мин. дней
                </Label>
                <Input
                  type="number"
                  value={caps.min_prep_days}
                  onChange={(e) => setCaps({ ...caps, min_prep_days: parseInt(e.target.value || "2") })}
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-sm font-medium">
                  <Calendar className="h-3.5 w-3.5 inline mr-1" /> Макс. дней
                </Label>
                <Input
                  type="number"
                  value={caps.max_prep_days}
                  onChange={(e) => setCaps({ ...caps, max_prep_days: parseInt(e.target.value || "7") })}
                  className="mt-1"
                />
              </div>
            </div>
          </div>
        </div>
      </CapabilitySection>

      {/* Save button at bottom */}
      <div className="flex justify-end pt-4 border-t">
        <Button onClick={handleSave} disabled={saving} size="lg">
          {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          {saving ? "Сохранение..." : "Сохранить способности"}
        </Button>
      </div>
    </div>
  );
}

// =====================================================================
// Helper components
// =====================================================================

function CapabilitySection({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="mb-3">
        <h3 className="font-semibold text-sm">{title}</h3>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </Card>
  );
}

function ToggleChip({
  active,
  onClick,
  children,
  compact,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-center text-center border-2 rounded-lg transition-all ${
        compact ? "text-xs px-2 py-1.5" : "text-sm px-3 py-2"
      } ${
        active
          ? "border-primary bg-primary/5 text-primary"
          : "border-border hover:border-primary/40 text-foreground"
      }`}
    >
      {active && <Check className="h-3 w-3 mr-1 shrink-0" />}
      <span className="truncate">{children}</span>
    </button>
  );
}
