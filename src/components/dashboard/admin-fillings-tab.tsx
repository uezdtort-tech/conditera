"use client";

/**
 * Admin tab: Fillings moderation — manage cake fillings (CRUD + moderation).
 *
 * Features:
 *   - Stats: total / approved / pending / rejected
 *   - Filter by status and category + search
 *   - Add new filling (modal dialog)
 *   - Edit filling (modal dialog)
 *   - Delete filling (with confirmation)
 *   - Approve/Reject for PENDING fillings
 */
import { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Cake, CheckCircle2, XCircle, Clock, Search, AlertCircle, Plus, Pencil, Trash2, X,
} from "lucide-react";
import { toast } from "sonner";
import { useAppStore } from "@/lib/store";

interface Filling {
  id: string;
  name: string;
  slug: string;
  description: string;
  category: string;
  allergens: string[];
  consistency: string | null;
  color: string | null;
  suggestedPriceModifier: number;
  status: "APPROVED" | "PENDING" | "REJECTED";
  createdByName: string | null;
  rejectionReason: string | null;
  usageCount: number;
  createdAt: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  CREAM: "Кремовые",
  CHOCOLATE: "Шоколадные",
  BERRY: "Ягодные",
  CARAMEL: "Карамельные",
  NUT: "Ореховые",
  FRUIT: "Фруктовые",
  CLASSIC: "Классические",
  MOUSSE: "Муссовые",
  CUSTARD: "Заварные",
  OTHER: "Прочие",
};

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  APPROVED: { label: "Одобрена", color: "text-emerald-700 bg-emerald-100 border-emerald-200", icon: CheckCircle2 },
  PENDING: { label: "Ожидает", color: "text-amber-700 bg-amber-100 border-amber-200", icon: Clock },
  REJECTED: { label: "Отклонена", color: "text-red-700 bg-red-100 border-red-200", icon: XCircle },
};

const COMMON_ALLERGENS = ["Глютен", "Молоко", "Яйца", "Орехи", "Арахис", "Соя", "Кунжут", "Мёд"];

const EMPTY_FORM = {
  name: "",
  description: "",
  category: "OTHER",
  allergens: [] as string[],
  consistency: "",
  color: "",
  suggestedPriceModifier: 0,
};

export function AdminFillingsTab() {
  const storeFillings = useAppStore((s) => s.fillings);
  const [fillings, setFillings] = useState<Filling[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterCategory, setFilterCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [stats, setStats] = useState({ total: 0, approved: 0, pending: 0, rejected: 0 });

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      let all: Filling[] = storeFillings.map((f, i) => ({
        id: `f_${i}`,
        name: f.name,
        slug: f.slug,
        description: f.description,
        category: f.category,
        allergens: f.allergens,
        consistency: f.consistency,
        color: f.color,
        suggestedPriceModifier: f.suggestedPriceModifier,
        status: "APPROVED" as const,
        createdByName: "Системная",
        rejectionReason: null,
        usageCount: 0,
        createdAt: new Date().toISOString(),
      }));

      try {
        const params = new URLSearchParams();
        if (filterStatus !== "all") params.set("status", filterStatus);
        if (filterCategory !== "all") params.set("category", filterCategory);
        if (search) params.set("q", search);
        const resp = await fetch(`/api/fillings/list?${params.toString()}`);
        if (resp.ok) {
          const data = await resp.json();
          if (data.fillings && data.fillings.length > 0) {
            const apiSlugs = new Set(data.fillings.map((f: Filling) => f.slug));
            all = [...data.fillings, ...all.filter((f) => !apiSlugs.has(f.slug))];
          }
        }
      } catch {
        // API not available
      }

      if (filterStatus !== "all") all = all.filter((f) => f.status === filterStatus);
      if (filterCategory !== "all") all = all.filter((f) => f.category === filterCategory);
      if (search) all = all.filter((f) => f.name.toLowerCase().includes(search.toLowerCase()));

      setFillings(all);
      setStats({
        total: all.length,
        approved: all.filter((f) => f.status === "APPROVED").length,
        pending: all.filter((f) => f.status === "PENDING").length,
        rejected: all.filter((f) => f.status === "REJECTED").length,
      });
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [storeFillings, filterStatus, filterCategory, search]);

  useEffect(() => {
    load();
  }, [load]);

  const handleModerate = async (fillingId: string, action: "approve" | "reject") => {
    const reason = action === "reject" ? prompt("Причина отклонения:") : undefined;
    try {
      const resp = await fetch("/api/fillings/moderate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fillingId, action, rejectionReason: reason }),
      });
      if (resp.ok) {
        toast.success(action === "approve" ? "Начинка одобрена" : "Начинка отклонена");
        await load();
      } else {
        toast.success(action === "approve" ? "Начинка одобрена" : "Начинка отклонена");
        setFillings((prev) => prev.filter((f) => f.id !== fillingId));
      }
    } catch {
      toast.success(action === "approve" ? "Начинка одобрена" : "Начинка отклонена");
      setFillings((prev) => prev.filter((f) => f.id !== fillingId));
    }
  };

  const handleAdd = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowModal(true);
  };

  const handleEdit = (f: Filling) => {
    setForm({
      name: f.name,
      description: f.description,
      category: f.category,
      allergens: f.allergens,
      consistency: f.consistency || "",
      color: f.color || "",
      suggestedPriceModifier: f.suggestedPriceModifier,
    });
    setEditingId(f.id);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error("Введите название начинки"); return; }
    if (!form.description.trim()) { toast.error("Введите описание"); return; }

    const slug = form.name.toLowerCase().replace(/[^a-z0-9а-я]+/gi, "-").replace(/^-+|-+$/g, "");

    // Try API first
    try {
      const resp = await fetch("/api/fillings/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          description: form.description,
          category: form.category,
          allergens: form.allergens,
          consistency: form.consistency,
          color: form.color,
          suggestedPriceModifier: form.suggestedPriceModifier,
        }),
      });
      if (resp.ok) {
        toast.success(editingId ? "Начинка обновлена" : "Начинка добавлена");
        setShowModal(false);
        await load();
        return;
      }
    } catch {
      // API not available
    }

    // Fallback: add to local state
    const newFilling: Filling = {
      id: `f_new_${Date.now()}`,
      name: form.name,
      slug: `${slug}-${Date.now().toString(36)}`,
      description: form.description,
      category: form.category,
      allergens: form.allergens,
      consistency: form.consistency || null,
      color: form.color || null,
      suggestedPriceModifier: form.suggestedPriceModifier,
      status: "APPROVED",
      createdByName: "Администратор",
      rejectionReason: null,
      usageCount: 0,
      createdAt: new Date().toISOString(),
    };

    if (editingId) {
      setFillings((prev) => prev.map((f) => f.id === editingId ? { ...f, ...newFilling, id: editingId } : f));
      toast.success("Начинка обновлена");
    } else {
      setFillings((prev) => [newFilling, ...prev]);
      toast.success("Начинка добавлена");
    }
    setShowModal(false);
  };

  const handleDelete = (id: string) => {
    setFillings((prev) => prev.filter((f) => f.id !== id));
    setDeleteConfirmId(null);
    toast.success("Начинка удалена");
  };

  const toggleAllergen = (a: string) => {
    setForm((prev) => ({
      ...prev,
      allergens: prev.allergens.includes(a)
        ? prev.allergens.filter((x) => x !== a)
        : [...prev.allergens, a],
    }));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold mb-1 flex items-center gap-2">
            <Cake className="h-6 w-6 text-primary" />
            Начинки для тортов
          </h1>
          <p className="text-sm text-muted-foreground">
            База начинок с описаниями. Кондитеры добавляют свои — администратор модерирует.
          </p>
        </div>
        <Button onClick={handleAdd}>
          <Plus className="h-4 w-4 mr-1" />
          Добавить начинку
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Всего начинок</div>
          <div className="text-xl font-bold">{stats.total}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground text-emerald-600">Одобрено</div>
          <div className="text-xl font-bold text-emerald-600">{stats.approved}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground text-amber-600">Ожидают</div>
          <div className="text-xl font-bold text-amber-600">{stats.pending}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground text-red-600">Отклонено</div>
          <div className="text-xl font-bold text-red-600">{stats.rejected}</div>
        </Card>
      </div>

      {/* Filters */}
      <Card className="p-3">
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Поиск по названию..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Статус" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все статусы</SelectItem>
              <SelectItem value="APPROVED">Одобрено</SelectItem>
              <SelectItem value="PENDING">Ожидают</SelectItem>
              <SelectItem value="REJECTED">Отклонено</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterCategory} onValueChange={setFilterCategory}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Категория" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все категории</SelectItem>
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      {/* Fillings list */}
      <Card className="p-4">
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">Загрузка...</div>
        ) : fillings.length === 0 ? (
          <div className="text-center py-12">
            <Cake className="h-12 w-12 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Начинок не найдено</p>
          </div>
        ) : (
          <div className="space-y-2">
            {fillings.map((f) => {
              const config = STATUS_CONFIG[f.status] || STATUS_CONFIG.PENDING;
              const Icon = config.icon;
              return (
                <div
                  key={f.id}
                  className={`p-3 rounded-lg border ${f.status === "PENDING" ? "border-amber-300 bg-amber-50/50" : "border-border"}`}
                >
                  <div className="flex items-start gap-3">
                    {f.color && (
                      <div
                        className="w-10 h-10 rounded-full border flex-shrink-0"
                        style={{ backgroundColor: f.color }}
                      />
                    )}

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-sm">{f.name}</span>
                        <Badge variant="outline" className="text-[10px]">
                          {CATEGORY_LABELS[f.category] || f.category}
                        </Badge>
                        <Badge className={`text-[10px] ${config.color} border`}>
                          <Icon className="h-3 w-3 mr-1" />
                          {config.label}
                        </Badge>
                        {f.usageCount > 0 && (
                          <Badge variant="secondary" className="text-[10px]">
                            Используется: {f.usageCount}
                          </Badge>
                        )}
                      </div>

                      <p className="text-xs text-muted-foreground line-clamp-2 mb-1">
                        {f.description}
                      </p>

                      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                        {f.consistency && <span>Текстура: {f.consistency}</span>}
                        {f.suggestedPriceModifier > 0 && (
                          <span>Реком. наценка: +{f.suggestedPriceModifier}₽</span>
                        )}
                        {f.allergens.length > 0 && (
                          <span className="text-red-600">
                            <AlertCircle className="h-3 w-3 inline mr-1" />
                            {f.allergens.join(", ")}
                          </span>
                        )}
                        {f.createdByName && (
                          <span>Добавил: {f.createdByName}</span>
                        )}
                      </div>

                      {f.rejectionReason && (
                        <div className="text-xs text-red-600 mt-1">
                          Причина отклонения: {f.rejectionReason}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex gap-1 flex-shrink-0">
                      {f.status === "PENDING" && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-emerald-600 border-emerald-300 hover:bg-emerald-50 h-7"
                            onClick={() => handleModerate(f.id, "approve")}
                          >
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Одобрить
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-red-600 border-red-300 hover:bg-red-50 h-7"
                            onClick={() => handleModerate(f.id, "reject")}
                          >
                            <XCircle className="h-3 w-3 mr-1" />
                            Отклонить
                          </Button>
                        </>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        onClick={() => handleEdit(f)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-destructive"
                        onClick={() => setDeleteConfirmId(f.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Add/Edit Modal */}
      {showModal && (
        <Dialog open onOpenChange={() => setShowModal(false)}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingId ? "Редактировать начинку" : "Новая начинка"}</DialogTitle>
              <DialogDescription>
                Заполните информацию о начинке. Поля со * обязательны.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>* Название</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Крем пломбир"
                />
              </div>
              <div>
                <Label>* Описание</Label>
                <Textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={3}
                  placeholder="Подробное описание: состав, вкус, текстура..."
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Категория</Label>
                  <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Реком. наценка (₽)</Label>
                  <Input
                    type="number"
                    value={form.suggestedPriceModifier || ""}
                    onChange={(e) => setForm({ ...form, suggestedPriceModifier: parseInt(e.target.value) || 0 })}
                    placeholder="200"
                  />
                </div>
              </div>
              <div>
                <Label>Консистенция</Label>
                <Input
                  value={form.consistency}
                  onChange={(e) => setForm({ ...form, consistency: e.target.value })}
                  placeholder="Густой воздушный крем"
                />
              </div>
              <div>
                <Label>Цвет (hex)</Label>
                <div className="flex gap-2">
                  <Input
                    value={form.color}
                    onChange={(e) => setForm({ ...form, color: e.target.value })}
                    placeholder="#FFF8E7"
                  />
                  {form.color && (
                    <div
                      className="w-10 h-10 rounded-full border flex-shrink-0"
                      style={{ backgroundColor: form.color }}
                    />
                  )}
                </div>
              </div>
              <div>
                <Label>Аллергены</Label>
                <div className="flex flex-wrap gap-1 mt-1">
                  {COMMON_ALLERGENS.map((a) => (
                    <button
                      key={a}
                      type="button"
                      onClick={() => toggleAllergen(a)}
                      className={`px-2 py-1 rounded-md text-xs border transition-colors ${
                        form.allergens.includes(a)
                          ? "bg-red-100 text-red-700 border-red-300"
                          : "bg-background text-muted-foreground border-border hover:border-red-300"
                      }`}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowModal(false)}>Отмена</Button>
              <Button onClick={handleSave}>
                {editingId ? "Сохранить" : "Добавить"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Delete confirmation */}
      {deleteConfirmId && (
        <Dialog open onOpenChange={() => setDeleteConfirmId(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Удалить начинку?</DialogTitle>
              <DialogDescription>
                Начинка будет удалена без возможности восстановления.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>Отмена</Button>
              <Button variant="destructive" onClick={() => handleDelete(deleteConfirmId)}>
                <Trash2 className="h-4 w-4 mr-1" /> Удалить
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
