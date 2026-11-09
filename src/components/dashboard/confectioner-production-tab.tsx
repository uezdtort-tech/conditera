"use client";

/**
 * ConfectionerProductionTab — производственный контур кондитера (RECIPE-02/05):
 *
 *   A. «Производственные карты» — нормы сырья: список, создание, правка черновика
 *      (PATCH с полной заменой норм), утверждение (POST /approve — сервер считает
 *      себестоимость и создаёт версию), архив/возврат в черновик.
 *   B. «Партии» — создание от утверждённой версии карты, статусы по автомату RB.15,
 *      списание сырья (batch-режим POST /api/inventory/write-off) с серверным
 *      prefill expected_qty.
 *
 * Самодостаточная вкладка: НЕ монтируется в этом файле — подключает главный агент.
 * Данные — только живые API (csrfFetch, TanStack Query); количеств/цен клиент
 * не придумывает. Ошибки сервера показываются дословно.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Ban,
  CheckCheck,
  CheckCircle2,
  ClipboardList,
  PackageOpen,
  PackagePlus,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  ScrollText,
  Undo2,
  Boxes,
} from "lucide-react";

import { csrfFetch } from "@/lib/api-client";
import { useAppStore } from "@/lib/store";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
  CardFormDialog,
  CreateBatchDialog,
  WriteOffDialog,
} from "./production-dialogs";
import type {
  ApproveResponse,
  BatchStatus,
  BatchDetail,
  CardStatus,
  InventoryItemLite,
  RecipeLite,
  SerializedBatch,
  SerializedCard,
} from "./production-dialogs";

// ============================================================================
// Хелперы (числа/даты/ids — только отображение серверных значений)
// ============================================================================

async function parseJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Текст ошибки сервера — показываем как есть */
async function apiError(res: Response): Promise<string> {
  const json = await parseJson<{ error?: string }>(res);
  return json?.error || `HTTP ${res.status}`;
}

function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function fmtRub(n: number): string {
  return n.toLocaleString("ru-RU");
}

const CARD_STATUS_BADGE: Record<CardStatus, { label: string; className: string }> = {
  draft: { label: "Черновик", className: "border-amber-200 bg-amber-100 text-amber-800" },
  approved: { label: "Утверждена", className: "border-emerald-200 bg-emerald-100 text-emerald-800" },
  archived: { label: "В архиве", className: "border-stone-200 bg-stone-100 text-stone-500" },
};

const BATCH_STATUS_BADGE: Record<
  BatchStatus,
  { label: string; variant: "secondary" | "default" | "destructive" | "outline"; className?: string }
> = {
  planned: { label: "Запланирована", variant: "secondary" },
  in_progress: { label: "В работе", variant: "default" },
  completed: {
    label: "Завершена",
    variant: "outline",
    className: "border-emerald-200 bg-emerald-100 text-emerald-800",
  },
  cancelled: { label: "Отменена", variant: "destructive" },
};

/** Себестоимость, полученная ТОЛЬКО из ответа approve (на клиенте не вычисляется) */
interface ApproveInfo {
  versionNo: number;
  costPerUnitRub: number;
}

// ============================================================================
// ConfectionerProductionTab
// ============================================================================

export function ConfectionerProductionTab() {
  const user = useAppStore((s) => s.user);
  const qc = useQueryClient();

  // --- Диалоги ---
  const [cardDialogOpen, setCardDialogOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<SerializedCard | null>(null);
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [batchDialogCardId, setBatchDialogCardId] = useState<string | null>(null);
  const [writeOffOpen, setWriteOffOpen] = useState(false);
  const [writeOffBatchId, setWriteOffBatchId] = useState<string | null>(null);

  // --- Клиентские отображения серверных фактов (не вычисления!) ---
  // Себестоимость приходит только из ответа approve → храним для показа в строке.
  const [approveInfo, setApproveInfo] = useState<Record<string, ApproveInfo>>({});
  // «Списание: есть/нет» — lazy-проба деталей партий + трекинг после списания.
  const [writeOffKnown, setWriteOffKnown] = useState<Record<string, boolean>>({});

  const userId = user?.id ?? null;

  // --- Чтения (TanStack Query) ---
  const cardsQuery = useQuery({
    queryKey: ["production-cards", userId],
    queryFn: async (): Promise<{ cards: SerializedCard[]; total: number }> => {
      const res = await csrfFetch("/api/production/cards?limit=100");
      if (!res.ok) throw new Error(await apiError(res));
      const json = await parseJson<{ cards?: SerializedCard[]; total?: number }>(res);
      return { cards: json?.cards ?? [], total: json?.total ?? 0 };
    },
    enabled: !!user,
    staleTime: 15_000,
    retry: 1,
  });

  const batchesQuery = useQuery({
    queryKey: ["production-batches", userId],
    queryFn: async (): Promise<{ batches: SerializedBatch[]; total: number }> => {
      const res = await csrfFetch("/api/production/batches?limit=100");
      if (!res.ok) throw new Error(await apiError(res));
      const json = await parseJson<{ batches?: SerializedBatch[]; total?: number }>(res);
      return { batches: json?.batches ?? [], total: json?.total ?? 0 };
    },
    enabled: !!user,
    staleTime: 15_000,
    retry: 1,
  });

  const recipesQuery = useQuery({
    queryKey: ["recipes-mine", userId],
    queryFn: async (): Promise<RecipeLite[]> => {
      const res = await csrfFetch("/api/recipes?scope=mine&limit=100");
      if (!res.ok) throw new Error(await apiError(res));
      const json = await parseJson<{ data?: Array<{ id: string; title: string }> }>(res);
      return (json?.data ?? []).map((r) => ({ id: r.id, title: r.title }));
    },
    enabled: !!user,
    staleTime: 60_000,
    retry: 1,
  });

  // Склад — для редактора норм (селект позиций name+unit)
  const inventoryQuery = useQuery({
    queryKey: ["production-inventory-items", userId],
    queryFn: async (): Promise<InventoryItemLite[]> => {
      const res = await csrfFetch("/api/inventory/items?limit=200");
      if (!res.ok) throw new Error(await apiError(res));
      const json = await parseJson<{
        items?: Array<{ id: string; name: string; unit: string | null; quantity: number }>;
      }>(res);
      return (json?.items ?? []).map((i) => ({
        id: i.id,
        name: i.name,
        unit: i.unit || "шт",
        quantity: Number(i.quantity) || 0,
      }));
    },
    enabled: !!user,
    staleTime: 60_000,
    retry: 1,
  });

  const cards = useMemo(() => cardsQuery.data?.cards ?? [], [cardsQuery.data]);
  const batches = useMemo(() => batchesQuery.data?.batches ?? [], [batchesQuery.data]);
  const recipes = useMemo(() => recipesQuery.data ?? [], [recipesQuery.data]);
  const inventoryItems = useMemo(() => inventoryQuery.data ?? [], [inventoryQuery.data]);
  const recipeTitleById = useMemo(() => new Map(recipes.map((r) => [r.id, r.title])), [recipes]);
  const approvedCards = useMemo(
    () => cards.filter((c) => c.status === "approved" && !!c.latest_card_version_id),
    [cards]
  );

  // --- Lazy-проба «списание: есть/нет» для активных партий (детали GET) ---
  const probedBatches = useRef<Set<string>>(new Set());
  useEffect(() => {
    const pending = batches.filter(
      (b) =>
        (b.status === "in_progress" || b.status === "planned") &&
        !probedBatches.current.has(b.id)
    );
    if (pending.length === 0) return;
    pending.forEach((b) => probedBatches.current.add(b.id));
    let cancelled = false;
    void Promise.allSettled(
      pending.map(async (b) => {
        const res = await csrfFetch(`/api/production/batches/${b.id}`);
        if (!res.ok) return;
        const json = await parseJson<BatchDetail>(res);
        if (!cancelled && json) {
          setWriteOffKnown((prev) => ({ ...prev, [b.id]: !!json.write_off }));
        }
      })
    );
    return () => {
      cancelled = true;
    };
  }, [batches]);

  // --- Мутации ---
  const approveMutation = useMutation({
    mutationFn: async (cardId: string): Promise<{ cardId: string; data: ApproveResponse }> => {
      const res = await csrfFetch(`/api/production/cards/${cardId}/approve`, { method: "POST" });
      const json = await parseJson<ApproveResponse & { error?: string }>(res);
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      return { cardId, data: json as ApproveResponse };
    },
    onSuccess: ({ cardId, data }) => {
      const rub = data.cost?.cost_per_unit_rub;
      if (typeof rub === "number") {
        setApproveInfo((prev) => ({
          ...prev,
          [cardId]: { versionNo: data.cardVersionNo, costPerUnitRub: rub },
        }));
      }
      const costPart =
        typeof rub === "number" ? `, себестоимость ${fmtRub(rub)} ₽/ед.` : "";
      if (data.idempotent) {
        toast.info(`Версия №${data.cardVersionNo} без изменений${costPart}`, {
          description: data.message,
        });
      } else {
        toast.success(`Карта утверждена — версия №${data.cardVersionNo}${costPart}`);
      }
      void qc.invalidateQueries({ queryKey: ["production-cards"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const patchCardStatus = useMutation({
    mutationFn: async (input: { cardId: string; status: "draft" | "archived" }) => {
      const res = await csrfFetch(`/api/production/cards/${input.cardId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: input.status }),
      });
      if (!res.ok) throw new Error(await apiError(res));
      return input.status;
    },
    onSuccess: (status) => {
      toast.success(
        status === "draft" ? "Карта в черновике — правки доступны" : "Карта перенесена в архив"
      );
      void qc.invalidateQueries({ queryKey: ["production-cards"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const patchBatchStatus = useMutation({
    mutationFn: async (input: {
      batchId: string;
      status: "in_progress" | "completed" | "cancelled";
    }) => {
      const res = await csrfFetch(`/api/production/batches/${input.batchId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: input.status }),
      });
      if (!res.ok) throw new Error(await apiError(res));
    },
    onSuccess: (_d, vars) => {
      toast.success(
        vars.status === "in_progress"
          ? "Партия начата"
          : vars.status === "completed"
            ? "Партия завершена"
            : "Партия отменена"
      );
      void qc.invalidateQueries({ queryKey: ["production-batches"] });
    },
    onError: (e: Error) => {
      if (e.message.includes("партия без списания")) {
        toast.error("Партия без списания", {
          description:
            "Завершение требует выполненного списания. Сначала нажмите «Списание сырья…» и спишите ингредиенты.",
        });
      } else {
        toast.error(e.message);
      }
    },
  });

  const handleWrittenOff = (batchId: string) => {
    setWriteOffKnown((prev) => ({ ...prev, [batchId]: true }));
    void qc.invalidateQueries({ queryKey: ["production-batches"] });
    void qc.invalidateQueries({ queryKey: ["production-batch-detail", batchId] });
    void qc.invalidateQueries({ queryKey: ["production-inventory-items"] });
    void qc.invalidateQueries({ queryKey: ["inventory-real"] });
  };

  const openCreateCard = () => {
    setEditingCard(null);
    setCardDialogOpen(true);
  };
  const openEditCard = (card: SerializedCard) => {
    setEditingCard(card);
    setCardDialogOpen(true);
  };
  const openCreateBatch = (cardId: string | null) => {
    setBatchDialogCardId(cardId);
    setBatchDialogOpen(true);
  };

  // ==========================================================================
  // Гость
  // ==========================================================================
  if (!user) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ScrollText className="h-5 w-5" /> Производственный контур
          </CardTitle>
          <CardDescription>Производственные карты, партии и списание сырья.</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertTitle>Требуется вход</AlertTitle>
            <AlertDescription>
              Войдите в кабинет кондитера, чтобы работать с производственными картами и партиями.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Tabs defaultValue="cards">
        <TabsList className="grid h-12 w-full max-w-md grid-cols-2">
          <TabsTrigger value="cards" className="h-11 gap-2">
            <ScrollText className="h-4 w-4" /> Карты
          </TabsTrigger>
          <TabsTrigger value="batches" className="h-11 gap-2">
            <Boxes className="h-4 w-4" /> Партии
          </TabsTrigger>
        </TabsList>

        {/* ================================================================
            A. Производственные карты
            ================================================================ */}
        <TabsContent value="cards" className="mt-4">
          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2">
                  <ScrollText className="h-5 w-5" /> Производственные карты
                </CardTitle>
                <CardDescription>
                  Нормы сырья на единицу продукта. Утверждение фиксирует версию и себестоимость
                  (считает сервер).
                  {cardsQuery.data ? ` Всего: ${cardsQuery.data.total}.` : ""}
                </CardDescription>
              </div>
              <Button className="h-11" onClick={openCreateCard}>
                <Plus className="h-4 w-4" /> Создать карту
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {cardsQuery.isLoading && (
                <div className="space-y-2">
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-14 w-full" />
                </div>
              )}

              {cardsQuery.isError && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Не удалось загрузить карты</AlertTitle>
                  <AlertDescription>
                    {cardsQuery.error instanceof Error ? cardsQuery.error.message : "Ошибка сервера"}
                    <div className="mt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-11"
                        onClick={() => void cardsQuery.refetch()}
                      >
                        <RefreshCw className="h-4 w-4" /> Повторить
                      </Button>
                    </div>
                  </AlertDescription>
                </Alert>
              )}

              {!cardsQuery.isLoading && !cardsQuery.isError && cards.length === 0 && (
                <div className="flex flex-col items-center gap-2 rounded-md border border-dashed py-10 text-center">
                  <PackageOpen className="h-8 w-8 text-muted-foreground" />
                  <p className="text-sm font-medium">Производственных карт пока нет</p>
                  <p className="max-w-md text-xs text-muted-foreground">
                    Создайте карту из своего рецепта, привяжите нормы к позициям склада и утвердите —
                    после утверждения можно планировать партии.
                  </p>
                </div>
              )}

              {cards.length > 0 && (
                <div className="max-h-96 overflow-y-auto rounded-md border">
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-card">
                      <TableRow>
                        <TableHead>Карта</TableHead>
                        <TableHead>Статус</TableHead>
                        <TableHead>Версия</TableHead>
                        <TableHead>Себестоимость</TableHead>
                        <TableHead>Обновлена</TableHead>
                        <TableHead className="text-right">Действия</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {cards.map((card) => {
                        const unbound = (card.ingredients ?? []).filter(
                          (n) => !n.inventory_item_id
                        ).length;
                        const cost = approveInfo[card.id];
                        return (
                          <TableRow key={card.id}>
                            <TableCell className="min-w-56 max-w-72">
                              <div className="truncate font-medium">{card.title}</div>
                              <div className="truncate text-xs text-muted-foreground">
                                Рецепт:{" "}
                                {recipeTitleById.get(card.recipe_id) ?? shortId(card.recipe_id)}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {card.batch_yield_qty !== null
                                  ? `Выход: ${card.batch_yield_qty}${
                                      card.batch_yield_unit ? ` ${card.batch_yield_unit}` : ""
                                    } · `
                                  : ""}
                                Норм: {card.ingredients?.length ?? 0}
                                {card.status === "draft" && unbound > 0 && (
                                  <span className="text-amber-700"> · не привязано: {unbound}</span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={CARD_STATUS_BADGE[card.status]?.className}
                              >
                                {CARD_STATUS_BADGE[card.status]?.label ?? card.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="tabular-nums">
                              {card.latest_version_no !== null ? `№${card.latest_version_no}` : "—"}
                            </TableCell>
                            <TableCell className="tabular-nums">
                              {cost ? `${fmtRub(cost.costPerUnitRub)} ₽/ед.` : "—"}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-sm">
                              {fmtDate(card.updated_at)}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap justify-end gap-2">
                                {card.status === "draft" && (
                                  <>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-11"
                                      onClick={() => openEditCard(card)}
                                    >
                                      <Pencil className="h-4 w-4" /> Редактировать
                                    </Button>
                                    <Button
                                      size="sm"
                                      className="h-11"
                                      onClick={() => approveMutation.mutate(card.id)}
                                      disabled={approveMutation.isPending}
                                    >
                                      <CheckCircle2 className="h-4 w-4" /> Утвердить
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-11"
                                      onClick={() =>
                                        patchCardStatus.mutate({
                                          cardId: card.id,
                                          status: "archived",
                                        })
                                      }
                                      disabled={patchCardStatus.isPending}
                                    >
                                      <Archive className="h-4 w-4" /> В архив
                                    </Button>
                                  </>
                                )}
                                {card.status === "approved" && (
                                  <>
                                    <Button
                                      size="sm"
                                      className="h-11"
                                      onClick={() => openCreateBatch(card.id)}
                                    >
                                      <PackagePlus className="h-4 w-4" /> Создать партию
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-11"
                                      onClick={() =>
                                        patchCardStatus.mutate({ cardId: card.id, status: "draft" })
                                      }
                                      disabled={patchCardStatus.isPending}
                                    >
                                      <Undo2 className="h-4 w-4" /> В черновик
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-11"
                                      onClick={() =>
                                        patchCardStatus.mutate({
                                          cardId: card.id,
                                          status: "archived",
                                        })
                                      }
                                      disabled={patchCardStatus.isPending}
                                    >
                                      <Archive className="h-4 w-4" /> В архив
                                    </Button>
                                  </>
                                )}
                                {card.status === "archived" && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-11"
                                    onClick={() =>
                                      patchCardStatus.mutate({ cardId: card.id, status: "draft" })
                                    }
                                    disabled={patchCardStatus.isPending}
                                  >
                                    <ArchiveRestore className="h-4 w-4" /> Восстановить
                                  </Button>
                                )}
                                {!card.is_owner && (
                                  <span className="self-center text-xs text-muted-foreground">
                                    —
                                  </span>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ================================================================
            B. Партии
            ================================================================ */}
        <TabsContent value="batches" className="mt-4">
          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2">
                  <Boxes className="h-5 w-5" /> Партии
                </CardTitle>
                <CardDescription>
                  Производственные партии от утверждённых версий карт. Завершение требует списания
                  сырья.
                  {batchesQuery.data ? ` Всего: ${batchesQuery.data.total}.` : ""}
                </CardDescription>
              </div>
              <Button className="h-11" onClick={() => openCreateBatch(null)}>
                <Plus className="h-4 w-4" /> Создать партию
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {batchesQuery.isLoading && (
                <div className="space-y-2">
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-14 w-full" />
                </div>
              )}

              {batchesQuery.isError && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Не удалось загрузить партии</AlertTitle>
                  <AlertDescription>
                    {batchesQuery.error instanceof Error
                      ? batchesQuery.error.message
                      : "Ошибка сервера"}
                    <div className="mt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-11"
                        onClick={() => void batchesQuery.refetch()}
                      >
                        <RefreshCw className="h-4 w-4" /> Повторить
                      </Button>
                    </div>
                  </AlertDescription>
                </Alert>
              )}

              {!batchesQuery.isLoading && !batchesQuery.isError && batches.length === 0 && (
                <div className="flex flex-col items-center gap-2 rounded-md border border-dashed py-10 text-center">
                  <PackageOpen className="h-8 w-8 text-muted-foreground" />
                  <p className="text-sm font-medium">Партий пока нет</p>
                  <p className="max-w-md text-xs text-muted-foreground">
                    Создайте партию от утверждённой производственной карты, затем начните работу и
                    выполните списание сырья.
                  </p>
                </div>
              )}

              {batches.length > 0 && (
                <div className="max-h-96 overflow-y-auto rounded-md border">
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-card">
                      <TableRow>
                        <TableHead>Партия</TableHead>
                        <TableHead>Объём</TableHead>
                        <TableHead>Статус</TableHead>
                        <TableHead>Списание</TableHead>
                        <TableHead>Создана</TableHead>
                        <TableHead className="text-right">Действия</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {batches.map((batch) => {
                        const badge = BATCH_STATUS_BADGE[batch.status];
                        const woKnown =
                          batch.status === "completed" || writeOffKnown[batch.id] === true;
                        return (
                          <TableRow key={batch.id}>
                            <TableCell className="min-w-44 max-w-64">
                              <div className="font-mono text-sm">{shortId(batch.id)}</div>
                              {batch.notes && (
                                <div className="truncate text-xs text-muted-foreground">
                                  {batch.notes}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="whitespace-nowrap tabular-nums">
                              {batch.planned_qty} {batch.planned_unit}
                            </TableCell>
                            <TableCell>
                              <Badge variant={badge?.variant ?? "secondary"} className={badge?.className}>
                                {badge?.label ?? batch.status}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={
                                  woKnown
                                    ? "border-emerald-200 bg-emerald-100 text-emerald-800"
                                    : "border-stone-200 bg-stone-100 text-stone-500"
                                }
                              >
                                {woKnown ? "есть" : "нет"}
                              </Badge>
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-sm">
                              {fmtDate(batch.created_at)}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap justify-end gap-2">
                                {batch.status === "planned" && (
                                  <>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-11"
                                      onClick={() =>
                                        patchBatchStatus.mutate({
                                          batchId: batch.id,
                                          status: "in_progress",
                                        })
                                      }
                                      disabled={patchBatchStatus.isPending}
                                    >
                                      <Play className="h-4 w-4" /> Начать
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-11 text-destructive"
                                      onClick={() =>
                                        patchBatchStatus.mutate({
                                          batchId: batch.id,
                                          status: "cancelled",
                                        })
                                      }
                                      disabled={patchBatchStatus.isPending}
                                    >
                                      <Ban className="h-4 w-4" /> Отменить
                                    </Button>
                                  </>
                                )}
                                {batch.status === "in_progress" && (
                                  <>
                                    <Button
                                      size="sm"
                                      className="h-11"
                                      onClick={() => {
                                        setWriteOffBatchId(batch.id);
                                        setWriteOffOpen(true);
                                      }}
                                    >
                                      <ClipboardList className="h-4 w-4" /> Списание сырья…
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-11"
                                      onClick={() =>
                                        patchBatchStatus.mutate({
                                          batchId: batch.id,
                                          status: "completed",
                                        })
                                      }
                                      disabled={patchBatchStatus.isPending}
                                    >
                                      <CheckCheck className="h-4 w-4" /> Завершить
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-11 text-destructive"
                                      onClick={() =>
                                        patchBatchStatus.mutate({
                                          batchId: batch.id,
                                          status: "cancelled",
                                        })
                                      }
                                      disabled={patchBatchStatus.isPending}
                                    >
                                      <Ban className="h-4 w-4" /> Отменить
                                    </Button>
                                  </>
                                )}
                                {(batch.status === "completed" ||
                                  batch.status === "cancelled") && (
                                  <span className="self-center text-xs text-muted-foreground">
                                    —
                                  </span>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* --- Диалоги (управляются секциями A/B) --- */}
      <CardFormDialog
        open={cardDialogOpen}
        onOpenChange={setCardDialogOpen}
        mode={editingCard ? "edit" : "create"}
        card={editingCard}
        recipes={recipes}
        inventoryItems={inventoryItems}
        recipesLoading={recipesQuery.isLoading}
        onSaved={() => void qc.invalidateQueries({ queryKey: ["production-cards"] })}
      />
      <CreateBatchDialog
        open={batchDialogOpen}
        onOpenChange={setBatchDialogOpen}
        approvedCards={approvedCards}
        initialCardId={batchDialogCardId}
        onCreated={() => void qc.invalidateQueries({ queryKey: ["production-batches"] })}
      />
      <WriteOffDialog
        batchId={writeOffBatchId}
        open={writeOffOpen}
        onOpenChange={setWriteOffOpen}
        onWrittenOff={handleWrittenOff}
      />
    </div>
  );
}
