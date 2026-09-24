"use client";

/**
 * ModeratorDashboard — единая очередь модерации всех типов контента.
 *
 * Вкладки:
 *   - Обзор (KPI + последняя активность)
 *   - Отзывы (Review)
 *   - Начинки (Filling)
 *   - Рецепты (Recipe)
 *   - Кондитеры (верификация)
 *   - Организации (DaData)
 *   - Баннеры
 *
 * Каждая карточка: preview + кнопки approve/reject/request_revision
 */
import { useEffect, useState, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  ClipboardList, Check, X, AlertTriangle, Eye, Loader2,
  Star, ChefHat, Cake, Building2, Image as ImageIcon, FileText,
  Clock, Shield, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

interface ModerationItem {
  id: string;
  type: "review" | "filling" | "recipe" | "confectioner" | "organization" | "banner";
  title: string;
  author: string;
  status: string;
  createdAt: string;
  preview: string;
  meta: any;
  actions: string[];
}

interface QueueStats {
  total: number;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
}

const TYPE_CONFIG: Record<string, { label: string; icon: any; color: string }> = {
  review: { label: "Отзыв", icon: Star, color: "bg-amber-100 text-amber-800" },
  filling: { label: "Начинка", icon: Cake, color: "bg-purple-100 text-purple-800" },
  recipe: { label: "Рецепт", icon: ChefHat, color: "bg-blue-100 text-blue-800" },
  confectioner: { label: "Кондитер", icon: Shield, color: "bg-emerald-100 text-emerald-800" },
  organization: { label: "Организация", icon: Building2, color: "bg-indigo-100 text-indigo-800" },
  banner: { label: "Баннер", icon: ImageIcon, color: "bg-pink-100 text-pink-800" },
};

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending: { label: "Ожидает", color: "bg-amber-100 text-amber-800" },
  PENDING: { label: "Ожидает", color: "bg-amber-100 text-amber-800" },
  approved: { label: "Одобрено", color: "bg-emerald-100 text-emerald-800" },
  APPROVED: { label: "Одобрено", color: "bg-emerald-100 text-emerald-800" },
  rejected: { label: "Отклонено", color: "bg-red-100 text-red-800" },
  REJECTED: { label: "Отклонено", color: "bg-red-100 text-red-800" },
  published: { label: "Опубликовано", color: "bg-blue-100 text-blue-800" },
  needs_revision: { label: "Правки", color: "bg-orange-100 text-orange-800" },
  active: { label: "Активен", color: "bg-emerald-100 text-emerald-800" },
  inactive: { label: "Выключен", color: "bg-slate-100 text-slate-800" },
};

export function ModeratorDashboardFull() {
  const [items, setItems] = useState<ModerationItem[]>([]);
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>("overview");
  const [rejectDialog, setRejectDialog] = useState<{ item: ModerationItem; action: string } | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [processing, setProcessing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/moderator/queue?status=pending");
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
        setStats(data.stats || null);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleAction = async (item: ModerationItem, action: string, reason?: string) => {
    setProcessing(`${item.id}-${action}`);
    try {
      const res = await fetch("/api/moderator/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: item.type, id: item.id, action, reason }),
      });
      if (res.ok) {
        const actionLabels: Record<string, string> = {
          approve: "одобрен",
          reject: "отклонён",
          request_revision: "запрошены правки",
          deactivate: "деактивирован",
          activate: "активирован",
        };
        toast.success(`Элемент ${actionLabels[action] || action}`);

        // Удаляем из списка (если действие завершающее)
        if (["approve", "reject", "request_revision", "deactivate"].includes(action)) {
          setItems((prev) => prev.filter((i) => i.id !== item.id));
        }
      } else {
        toast.error("Ошибка действия");
      }
    } catch {
      toast.error("Ошибка сети");
    } finally {
      setProcessing(null);
      setRejectDialog(null);
      setRejectReason("");
    }
  };

  const openRejectDialog = (item: ModerationItem, action: string) => {
    setRejectDialog({ item, action });
    setRejectReason("");
  };

  // Фильтрация по вкладке
  const filteredItems = activeTab === "overview" ? items : items.filter((i) => i.type === activeTab);

  // KPI
  const pendingCount = items.filter((i) => i.status === "pending" || i.status === "PENDING").length;
  const reviewCount = items.filter((i) => i.type === "review").length;
  const fillingCount = items.filter((i) => i.type === "filling").length;
  const recipeCount = items.filter((i) => i.type === "recipe").length;
  const confectionerCount = items.filter((i) => i.type === "confectioner").length;
  const orgCount = items.filter((i) => i.type === "organization").length;
  const bannerCount = items.filter((i) => i.type === "banner").length;

  const tabs = [
    { id: "overview", label: "Обзор", icon: ClipboardList, count: pendingCount },
    { id: "review", label: "Отзывы", icon: Star, count: reviewCount },
    { id: "filling", label: "Начинки", icon: Cake, count: fillingCount },
    { id: "recipe", label: "Рецепты", icon: ChefHat, count: recipeCount },
    { id: "confectioner", label: "Кондитеры", icon: Shield, count: confectionerCount },
    { id: "organization", label: "Организации", icon: Building2, count: orgCount },
    { id: "banner", label: "Баннеры", icon: ImageIcon, count: bannerCount },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2">
            <Shield className="h-6 w-6 text-amber-600" />
            Кабинет модератора
          </h1>
          <p className="text-sm text-muted-foreground">
            Единая очередь модерации: отзывы, начинки, рецепты, верификация, баннеры
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Обновить
        </Button>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        <Card className="p-3">
          <ClipboardList className="h-5 w-5 text-amber-600 mb-1" />
          <div className="font-display text-xl font-bold text-amber-600">{pendingCount}</div>
          <div className="text-xs text-muted-foreground">В очереди</div>
        </Card>
        <Card className="p-3">
          <Star className="h-5 w-5 text-amber-500 mb-1" />
          <div className="font-display text-xl font-bold">{reviewCount}</div>
          <div className="text-xs text-muted-foreground">Отзывы</div>
        </Card>
        <Card className="p-3">
          <Cake className="h-5 w-5 text-purple-500 mb-1" />
          <div className="font-display text-xl font-bold">{fillingCount}</div>
          <div className="text-xs text-muted-foreground">Начинки</div>
        </Card>
        <Card className="p-3">
          <ChefHat className="h-5 w-5 text-blue-500 mb-1" />
          <div className="font-display text-xl font-bold">{recipeCount}</div>
          <div className="text-xs text-muted-foreground">Рецепты</div>
        </Card>
        <Card className="p-3">
          <Shield className="h-5 w-5 text-emerald-500 mb-1" />
          <div className="font-display text-xl font-bold">{confectionerCount}</div>
          <div className="text-xs text-muted-foreground">Верификация</div>
        </Card>
        <Card className="p-3">
          <Building2 className="h-5 w-5 text-indigo-500 mb-1" />
          <div className="font-display text-xl font-bold">{orgCount}</div>
          <div className="text-xs text-muted-foreground">Организации</div>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 flex-wrap border-b">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === t.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
              {t.count > 0 && (
                <Badge variant="outline" className="text-[9px] h-4 px-1">
                  {t.count}
                </Badge>
              )}
            </button>
          );
        })}
      </div>

      {/* Queue */}
      {loading ? (
        <Card className="p-8 text-center">
          <Loader2 className="h-8 w-8 mx-auto animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground mt-2">Загрузка очереди...</p>
        </Card>
      ) : filteredItems.length === 0 ? (
        <Card className="p-8 text-center">
          <Check className="h-12 w-12 mx-auto mb-2 text-emerald-500 opacity-40" />
          <p className="text-sm font-medium">Очередь пуста</p>
          <p className="text-xs text-muted-foreground mt-1">
            Все элементы проверены. Хорошая работа!
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredItems.map((item) => {
            const typeConf = TYPE_CONFIG[item.type] || TYPE_CONFIG.review;
            const statusConf = STATUS_CONFIG[item.status] || STATUS_CONFIG.pending;
            const TypeIcon = typeConf.icon;
            const isProcessing = processing === `${item.id}-approve` || processing === `${item.id}-reject`;

            return (
              <Card key={`${item.type}-${item.id}`} className="p-4 hover:border-primary/30 transition-colors">
                <div className="flex items-start gap-3">
                  {/* Type icon */}
                  <div className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${typeConf.color}`}>
                    <TypeIcon className="h-5 w-5" />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <Badge variant="outline" className={`text-[10px] ${typeConf.color}`}>
                        {typeConf.label}
                      </Badge>
                      <Badge className={`text-[10px] ${statusConf.color}`}>
                        {statusConf.label}
                      </Badge>
                      {item.meta?.rating && (
                        <span className="flex items-center gap-0.5 text-xs">
                          <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                          {item.meta.rating}
                        </span>
                      )}
                      {item.meta?.category && (
                        <span className="text-[10px] text-muted-foreground">{item.meta.category}</span>
                      )}
                      {item.meta?.city && (
                        <span className="text-[10px] text-muted-foreground">📍 {item.meta.city}</span>
                      )}
                      <span className="text-[10px] text-muted-foreground ml-auto">
                        <Clock className="h-2.5 w-2.5 inline mr-0.5" />
                        {new Date(item.createdAt).toLocaleDateString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>

                    <div className="text-sm font-medium truncate">{item.title}</div>
                    <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.preview}</div>
                    <div className="text-[10px] text-muted-foreground mt-1">Автор: {item.author}</div>

                    {/* Actions */}
                    {item.actions.length > 0 && (
                      <div className="flex gap-1.5 mt-2">
                        {item.actions.includes("approve") && (
                          <Button
                            size="sm"
                            className="h-7 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700"
                            disabled={isProcessing}
                            onClick={() => handleAction(item, "approve")}
                          >
                            {processing === `${item.id}-approve` ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Check className="h-3 w-3" />
                            )}
                            Одобрить
                          </Button>
                        )}
                        {item.actions.includes("reject") && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1 text-red-600 border-red-200 hover:bg-red-50"
                            disabled={isProcessing}
                            onClick={() => openRejectDialog(item, "reject")}
                          >
                            <X className="h-3 w-3" />
                            Отклонить
                          </Button>
                        )}
                        {item.actions.includes("request_revision") && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1 text-orange-600 border-orange-200 hover:bg-orange-50"
                            disabled={isProcessing}
                            onClick={() => openRejectDialog(item, "request_revision")}
                          >
                            <AlertTriangle className="h-3 w-3" />
                            Запросить правки
                          </Button>
                        )}
                        {item.actions.includes("deactivate") && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1 text-amber-600 border-amber-200 hover:bg-amber-50"
                            disabled={isProcessing}
                            onClick={() => handleAction(item, "deactivate")}
                          >
                            <X className="h-3 w-3" />
                            Деактивировать
                          </Button>
                        )}
                        {item.actions.includes("activate") && (
                          <Button
                            size="sm"
                            className="h-7 text-xs gap-1"
                            disabled={isProcessing}
                            onClick={() => handleAction(item, "activate")}
                          >
                            <Check className="h-3 w-3" />
                            Активировать
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Reject dialog */}
      <Dialog open={!!rejectDialog} onOpenChange={(v) => !v && setRejectDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {rejectDialog?.action === "reject" ? (
                <X className="h-5 w-5 text-red-500" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-orange-500" />
              )}
              {rejectDialog?.action === "reject" ? "Отклонить элемент" : "Запросить правки"}
            </DialogTitle>
            <DialogDescription>
              {rejectDialog?.item.title}
            </DialogDescription>
          </DialogHeader>

          <Textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder={rejectDialog?.action === "reject"
              ? "Причина отклонения (видна автору)..."
              : "Что нужно исправить (видно автору)..."}
            className="min-h-[80px]"
            maxLength={500}
          />

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setRejectDialog(null)}>
              Отмена
            </Button>
            <Button
              variant={rejectDialog?.action === "reject" ? "destructive" : "default"}
              onClick={() => rejectDialog && handleAction(rejectDialog.item, rejectDialog.action, rejectReason)}
              disabled={!rejectReason.trim() || processing !== null}
              className="gap-1"
            >
              {processing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {rejectDialog?.action === "reject" ? "Отклонить" : "Запросить правки"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
