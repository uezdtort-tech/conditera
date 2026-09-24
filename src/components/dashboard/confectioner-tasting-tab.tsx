"use client";

import { useState, useMemo } from "react";
import { useAppStore } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Plus, Edit, Trash2, MapPin, Clock, Phone, Utensils,
  Check, X, Navigation, Building2,
} from "lucide-react";
import { toast } from "sonner";
import type { TastingLocation } from "@/lib/types";

const TYPES: { value: TastingLocation["type"]; label: string; icon: typeof Utensils }[] = [
  { value: "restaurant", label: "Ресторан", icon: Utensils },
  { value: "cafe", label: "Кафе", icon: Utensils },
  { value: "coffee_shop", label: "Кофейня", icon: Utensils },
  { value: "bakery", label: "Пекарня", icon: Utensils },
  { value: "hotel", label: "Отель", icon: Building2 },
  { value: "shop", label: "Магазин", icon: Building2 },
  { value: "food_court", label: "Фуд-корт", icon: Utensils },
  { value: "canteen", label: "Столовая", icon: Utensils },
];

export function ConfectionerTastingTab({ confectionerId, city }: {
  confectionerId: string;
  city: string;
}) {
  const allLocations = useAppStore((s) => s.tastingLocations);
  const addLoc = useAppStore((s) => s.addTastingLocation);
  const updateLoc = useAppStore((s) => s.updateTastingLocation);
  const deleteLoc = useAppStore((s) => s.deleteTastingLocation);

  const locations = useMemo(
    () => allLocations.filter((tl) => tl.confectionerId === confectionerId),
    [allLocations, confectionerId]
  );

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    type: "cafe" as TastingLocation["type"],
    establishmentName: "",
    description: "",
    availableProducts: "",
    contactName: "",
    contactPhone: "",
    address: "",
    workingHours: "",
    averageCheck: 0,
    photo: "",
  });

  const resetForm = () => {
    setForm({
      type: "cafe", establishmentName: "", description: "", availableProducts: "",
      contactName: "", contactPhone: "", address: "", workingHours: "",
      averageCheck: 0, photo: "",
    });
    setEditingId(null);
  };

  const openCreate = () => { resetForm(); setShowForm(true); };

  const openEdit = (loc: TastingLocation) => {
    setForm({
      type: loc.type,
      establishmentName: loc.establishmentName,
      description: loc.description,
      availableProducts: loc.availableProducts.join(", "),
      contactName: loc.contactName || "",
      contactPhone: loc.contactPhone || "",
      address: loc.address,
      workingHours: loc.workingHours || "",
      averageCheck: loc.averageCheck || 0,
      photo: loc.photo || "",
    });
    setEditingId(loc.id);
    setShowForm(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.establishmentName.trim()) { toast.error("Введите название заведения"); return; }
    if (!form.address.trim()) { toast.error("Введите адрес"); return; }

    const data = {
      confectionerId,
      type: form.type,
      typeLabel: TYPES.find((t) => t.value === form.type)?.label,
      establishmentName: form.establishmentName.trim(),
      description: form.description.trim(),
      availableProducts: form.availableProducts.split(",").map((s) => s.trim()).filter(Boolean),
      contactName: form.contactName.trim() || undefined,
      contactPhone: form.contactPhone.trim() || undefined,
      address: form.address.trim(),
      city,
      status: "active" as const,
      workingHours: form.workingHours || undefined,
      averageCheck: form.averageCheck || undefined,
      photo: form.photo || undefined,
    };

    if (editingId) {
      updateLoc(editingId, data);
      toast.success("Точка дегустации обновлена");
    } else {
      addLoc(data);
      toast.success("Точка дегустации добавлена");
    }
    setShowForm(false);
    resetForm();
  };

  const handleDelete = (id: string, name: string) => {
    if (confirm(`Удалить «${name}»?`)) {
      deleteLoc(id);
      toast.success("Удалено");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Utensils className="h-5 w-5 text-primary" />
            Где попробовать
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Укажите рестораны, кафе и магазины, где можно попробовать вашу продукцию
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1" />Добавить
        </Button>
      </div>

      {locations.length === 0 ? (
        <Card className="p-8 text-center">
          <Utensils className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground mb-4">
            Нет точек дегустации. Добавьте рестораны и кафе, где доступна ваша продукция — это привлечёт новых клиентов!
          </p>
          <Button onClick={openCreate}><Plus className="h-4 w-4 mr-1" />Добавить первую точку</Button>
        </Card>
      ) : (
        <div className="space-y-3">
          {locations.map((loc) => {
            const typeLabel = loc.typeLabel || TYPES.find((t) => t.value === loc.type)?.label || "Заведение";
            return (
              <Card key={loc.id} className="p-4">
                <div className="flex flex-wrap items-start gap-3">
                  {loc.photo && (
                    <img src={loc.photo} alt="" className="w-16 h-16 rounded-lg object-cover shrink-0" loading="lazy" decoding="async" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-medium">{loc.establishmentName}</span>
                      <Badge variant="outline">{typeLabel}</Badge>
                      {loc.verified && <Badge className="bg-emerald-500 text-white text-[10px]"><Check className="h-2.5 w-2.5 mr-0.5" />Проверено</Badge>}
                      <Badge variant={loc.status === "active" ? "default" : "secondary"} className="text-[10px]">
                        {loc.status === "active" ? "Активна" : "Скрыта"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2 mb-1">{loc.description}</p>
                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                      <span><MapPin className="h-3 w-3 inline mr-0.5" />{loc.city}, {loc.address}</span>
                      {loc.workingHours && <span><Clock className="h-3 w-3 inline mr-0.5" />{loc.workingHours}</span>}
                      {loc.contactPhone && <span><Phone className="h-3 w-3 inline mr-0.5" />{loc.contactPhone}</span>}
                    </div>
                    {loc.availableProducts.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {loc.availableProducts.map((p) => <Badge key={p} variant="secondary" className="text-[9px]">{p}</Badge>)}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => openEdit(loc)}><Edit className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDelete(loc.id, loc.establishmentName)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Форма */}
      <Dialog open={showForm} onOpenChange={(open) => { setShowForm(open); if (!open) resetForm(); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{editingId ? "Редактировать точку" : "Новая точка дегустации"}</DialogTitle>
            <DialogDescription>Укажите заведение, где доступна ваша продукция</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            {/* Тип заведения */}
            <div>
              <Label>Тип заведения</Label>
              <div className="grid grid-cols-4 gap-2 mt-1.5">
                {TYPES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setForm({ ...form, type: t.value })}
                    className={`flex flex-col items-center gap-1 p-2 rounded-lg border-2 text-xs transition ${
                      form.type === t.value ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                    }`}
                  >
                    <t.icon className="h-4 w-4" />
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label>Название заведения *</Label>
              <Input value={form.establishmentName} onChange={(e) => setForm({ ...form, establishmentName: e.target.value })} placeholder="Кофейня «Уют»" required />
            </div>

            <div>
              <Label>Описание (что доступно)</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2}
                placeholder="Здесь всегда можно купить торты с сахарной печатью. Свежие десерты ежедневно." />
            </div>

            <div>
              <Label>Доступные товары (через запятую)</Label>
              <Input value={form.availableProducts} onChange={(e) => setForm({ ...form, availableProducts: e.target.value })}
                placeholder="Торт с фото, Капкейки, Набор пряников" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Адрес *</Label>
                <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="ул. Ленина, 15" required />
              </div>
              <div>
                <Label>Часы работы</Label>
                <Input value={form.workingHours} onChange={(e) => setForm({ ...form, workingHours: e.target.value })} placeholder="Пн-Вс 9:00-21:00" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Контактное лицо</Label>
                <Input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} placeholder="Анна" />
              </div>
              <div>
                <Label>Телефон</Label>
                <Input value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} placeholder="+7 916 ..." />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Средний чек, ₽</Label>
                <Input type="number" value={form.averageCheck || ""} onChange={(e) => setForm({ ...form, averageCheck: +e.target.value })} placeholder="500" />
              </div>
              <div>
                <Label>Фото заведения (URL)</Label>
                <Input value={form.photo} onChange={(e) => setForm({ ...form, photo: e.target.value })} placeholder="https://..." />
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <Button type="submit" className="flex-1">{editingId ? "Сохранить" : "Добавить точку"}</Button>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Отмена</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
