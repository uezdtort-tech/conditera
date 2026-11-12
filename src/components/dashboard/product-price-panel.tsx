"use client";

/**
 * ProductPricePanel — «Цены и история стоимости» для кондитера (PR-3).
 *
 * Данные — РЕАЛЬНЫЕ API из PR-1B (owner-guarded на сервере):
 *   GET  /api/confectioner/products/{id}/price-history  — current/previous/items[]
 *   GET  /api/confectioner/products/{id}/cost-analysis  — себестоимость/маржа/warnings
 *   GET  /api/confectioner/products/{id}/price-at       — цена на дату
 *   POST /api/confectioner/products/{id}/price          — новая цена (csrfFetch!)
 *
 * Секции: текущая цена (+Запланировано), история (таблица с человекочитаемыми
 * reason/source), календарь изменений (react-day-picker, точки по дням
 * Europe/Moscow, клик = фильтр истории), форма новой цены с live-превью и
 * AlertDialog-подтверждением (idempotencyKey генерируется ОДИН раз при открытии
 * диалога и переиспользуется при повторах этой же отправки), цена на дату,
 * себестоимость с честными маркерами (NO auto price increase — display only).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DayButtonProps } from "react-day-picker";
import { ru } from "react-day-picker/locale";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { csrfFetch } from "@/lib/api-client";
import { toast } from "sonner";
import { Loader2, Info, TriangleAlert, X, RefreshCw } from "lucide-react";

// ==================== Контракты API (PR-1B) ====================

interface PriceHistoryItem {
  id: string;
  amount: number;
  currency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  reason: string;
  comment: string | null;
  source: string;
  deltaRub: number | null;
  deltaPercent: number | null;
}

interface PriceHistoryData {
  current: {
    versionId: string;
    amount: number;
    currency: string;
    effectiveFrom: string;
    planned: boolean;
  } | null;
  previous: { amount: number; effectiveFrom: string } | null;
  items: PriceHistoryItem[];
}

interface CostAnalysisData {
  currentCost: {
    available: boolean;
    amountRub: number | null;
    approximate: boolean;
    basis?: string;
    reason?: string;
  };
  currentPrice: {
    amount: number | null;
    currency: string;
    versionId: string | null;
    effectiveFrom: string;
    reason: string;
  } | null;
  margin: { amountRub: number; percent: number | null } | null;
  priceHistoryCosts: {
    items: { effectiveFrom: string; costRub: number; approximate: boolean }[];
    notice: string;
  };
  warnings: {
    costExceedsPrice: boolean;
    marginLow: boolean | null;
    costGrewWhilePriceStale: boolean;
  };
  ingredientDynamics: { available: boolean; reason: string };
}

interface PriceAtData {
  amount: number | null;
  currency: string;
  versionId: string | null;
  effectiveFrom: string;
  reason: string;
}

interface PostPriceResponse {
  versionId?: string;
  newAmount?: number;
  deltaRub?: number;
  deltaPercent?: number;
  planned?: boolean;
  idempotent?: boolean;
  error?: string;
  message?: string;
}

// ==================== Словари человекочитаемых меток ====================

export const REASON_LABELS: Record<string, string> = {
  initial: "Начальная цена",
  ingredients: "Ингредиенты",
  packaging: "Упаковка",
  decor: "Декор",
  logistics: "Логистика",
  fuel: "Топливо",
  electricity: "Электроэнергия",
  labor: "Оплата труда",
  composition_change: "Изменение комплектации",
  other: "Прочее",
};

export const SOURCE_LABELS: Record<string, string> = {
  confectioner_ui: "Кондитер",
  admin_api: "Администратор",
  admin_correction: "Админ-исправление",
  system: "Система",
  migration_seed: "Система",
};

/** Причины для POST /price — enum 0083 КРОМЕ 'initial' (резервирует сид/функция). */
export const SELECTABLE_REASONS = [
  "ingredients",
  "packaging",
  "decor",
  "logistics",
  "fuel",
  "electricity",
  "labor",
  "composition_change",
  "other",
] as const;

// ==================== Форматирование (Europe/Moscow) ====================

const MOSCOW_TZ = "Europe/Moscow";
const MOSCOW_DAY_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: MOSCOW_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** День (Europe/Moscow) в виде YYYY-MM-DD — для группировки/сравнения. */
export function moscowDayKey(value: string | Date): string {
  return MOSCOW_DAY_FMT.format(value instanceof Date ? value : new Date(value));
}

/** YYYY-MM-DD → DD.MM.YYYY. */
export function dayKeyToDDMMYYYY(key: string): string {
  const [y, m, d] = key.split("-");
  return `${d}.${m}.${y}`;
}

/** ISO-строка → «DD.MM.YYYY» по цеховому часовому поясу. */
export function formatMoscowDate(iso: string): string {
  return dayKeyToDDMMYYYY(moscowDayKey(iso));
}

/** Локальная дата → YYYY-MM-DD (для календаря DayPicker). */
function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** YYYY-MM-DD → локальная дата-полночь (для DayPicker matchers). */
function keyToLocalDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Детерминированный формат ₽ (группировка ru-RU, обычные пробелы). */
export function formatRub(value: number): string {
  const grouped = Math.round(value)
    .toLocaleString("ru-RU")
    .replace(/[\u00A0\u202F]/g, " ");
  return `${grouped} ₽`;
}

function signedRub(diff: number): string {
  return `${diff > 0 ? "+" : diff < 0 ? "-" : "0"}${formatRub(Math.abs(diff))}`;
}

function percentText(pct: number): string {
  return `${pct > 0 ? "+" : pct < 0 ? "-" : ""}${Math.abs(pct)
    .toLocaleString("ru-RU")
    .replace(/[\u00A0\u202F]/g, " ")}%`;
}

/** Строка изменения для таблицы истории: «+500 ₽ (+33,3%)» | «—». */
function deltaText(item: PriceHistoryItem): string {
  if (item.deltaRub === null) return "—";
  const pct =
    item.deltaPercent === null ? "" : ` (${percentText(item.deltaPercent)})`;
  return `${signedRub(item.deltaRub)}${pct}`;
}

function reasonLabel(reason: string): string {
  return REASON_LABELS[reason] ?? reason;
}

function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

function newIdempotencyKey(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  // Fallback для окружений без crypto.randomUUID (jsdom и т.п.)
  return `price-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ==================== Календарь: день с изменением = точка ====================

function DayButtonDot({ day, modifiers, children, ...props }: DayButtonProps) {
  return (
    <button
      type="button"
      {...props}
      aria-label={dayKeyToDDMMYYYY(localDateKey(day.date))}
      className={cn(props.className, "relative")}
    >
      {children}
      {modifiers.changed ? (
        <span
          aria-hidden="true"
          data-testid="calendar-change-dot"
          className="absolute bottom-0 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-primary"
        />
      ) : null}
    </button>
  );
}

// ==================== Live-превью новой цены ====================

function PricePreviewBlock({
  currentAmount,
  newAmount,
  effectiveKey,
}: {
  currentAmount: number;
  newAmount: number;
  effectiveKey: string;
}) {
  const diff = newAmount - currentAmount;
  const pct =
    currentAmount > 0 ? Math.round((diff / currentAmount) * 1000) / 10 : null;
  return (
    <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1" data-testid="price-preview">
      <div>
        Сейчас: <span className="font-medium">{formatRub(currentAmount)}</span>
      </div>
      <div>
        Новая цена: <span className="font-medium">{formatRub(newAmount)}</span>
      </div>
      <div
        className={cn(
          diff > 0 && "text-emerald-600",
          diff < 0 && "text-red-600"
        )}
      >
        Изменение: <span className="font-medium">{signedRub(diff)}{pct !== null ? ` (${percentText(pct)})` : ""}</span>
      </div>
      <div className="text-muted-foreground">
        Начало действия: {dayKeyToDDMMYYYY(effectiveKey)}
      </div>
    </div>
  );
}

// ==================== Основной компонент ====================

export function ProductPricePanel({
  productId,
  currentPrice,
  inline = false,
  onClose,
}: {
  productId: string;
  /** Цена из карточки товара — честный fallback, пока история не загружена/пуста. */
  currentPrice: number;
  /** Inline-режим: собственная шапка с крестиком (вне Dialog). */
  inline?: boolean;
  onClose?: () => void;
}) {
  // --- История цен ---
  const [history, setHistory] = useState<PriceHistoryData | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const res = await fetch(
        `/api/confectioner/products/${encodeURIComponent(productId)}/price-history`,
        { credentials: "include" }
      );
      const data = (await res.json()) as PriceHistoryData & { error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setHistory(data);
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : "Не удалось загрузить историю");
    } finally {
      setHistoryLoading(false);
    }
  }, [productId]);

  // --- Себестоимость ---
  const [cost, setCost] = useState<CostAnalysisData | null>(null);
  const [costLoading, setCostLoading] = useState(true);
  const [costError, setCostError] = useState<string | null>(null);

  const loadCost = useCallback(async () => {
    setCostLoading(true);
    setCostError(null);
    try {
      const res = await fetch(
        `/api/confectioner/products/${encodeURIComponent(productId)}/cost-analysis`,
        { credentials: "include" }
      );
      const data = (await res.json()) as CostAnalysisData & { error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setCost(data);
    } catch (e) {
      setCostError(e instanceof Error ? e.message : "Не удалось загрузить себестоимость");
    } finally {
      setCostLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    void loadHistory();
    void loadCost();
  }, [loadHistory, loadCost]);

  // --- Календарь ---
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
  const [calMonth, setCalMonth] = useState<Date>(new Date());
  const calMonthAutoSet = useRef(false);

  const changedDates = useMemo(
    () =>
      (history?.items ?? []).map((i) => keyToLocalDate(moscowDayKey(i.effectiveFrom))),
    [history]
  );

  // Календарь открывается на месяце последнего изменения (однократно)
  useEffect(() => {
    if (calMonthAutoSet.current || !history || history.items.length === 0) return;
    calMonthAutoSet.current = true;
    setCalMonth(keyToLocalDate(moscowDayKey(history.items[0].effectiveFrom)));
  }, [history]);

  // --- Форма новой цены ---
  const [amountStr, setAmountStr] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(() => moscowDayKey(new Date()));
  const [reason, setReason] = useState<string>("ingredients");
  const [comment, setComment] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // idempotencyKey живёт ПОКА ОТКРЫТ диалог подтверждения: повторные попытки
  // этой же отправки (даблклик/таймаут) переиспользуют его; новое открытие
  // диалога = новый ключ.
  const idempotencyKeyRef = useRef<string | null>(null);

  const currentAmount = history?.current?.amount ?? currentPrice;
  const newAmount = Number.isFinite(parseInt(amountStr, 10))
    ? parseInt(amountStr, 10)
    : NaN;
  const formValid =
    Number.isInteger(newAmount) &&
    newAmount > 0 &&
    newAmount <= 10_000_000 &&
    /^\d{4}-\d{2}-\d{2}$/.test(effectiveDate);
  const isFuture = formValid && effectiveDate > moscowDayKey(new Date());

  const openConfirm = () => {
    if (!formValid || submitting) return;
    idempotencyKeyRef.current = newIdempotencyKey();
    setFormError(null);
    setConfirmOpen(true);
  };

  const submitPrice = async () => {
    if (submitting || !formValid) return; // анти-даблсабмит
    const idempotencyKey =
      idempotencyKeyRef.current ?? (idempotencyKeyRef.current = newIdempotencyKey());
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await csrfFetch(
        `/api/confectioner/products/${encodeURIComponent(productId)}/price`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: newAmount,
            effectiveFrom: effectiveDate,
            reason,
            ...(comment.trim() ? { comment: comment.trim() } : {}),
            idempotencyKey,
          }),
        }
      );
      const data = (await res.json().catch(() => ({}))) as PostPriceResponse;
      if (res.ok) {
        toast.success(
          data.planned || isFuture
            ? "Цена запланирована — покупатели увидят её с даты начала действия"
            : "Цена сохранена"
        );
        setConfirmOpen(false);
        idempotencyKeyRef.current = null;
        setAmountStr("");
        setComment("");
        void loadHistory();
        void loadCost();
      } else if (res.status === 409) {
        toast.error("Конфликт периодов цен — обновите историю");
        void loadHistory();
      } else {
        const msg = data.message || data.error || `Не удалось сохранить цену (HTTP ${res.status})`;
        setFormError(msg);
        toast.error(msg);
      }
    } catch {
      const msg = "Не удалось отправить запрос — проверьте соединение";
      setFormError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // --- Цена на дату ---
  const [priceAtDate, setPriceAtDate] = useState("");
  const [priceAt, setPriceAt] = useState<(PriceAtData & { queryKey: string }) | null>(null);
  const [priceAtLoading, setPriceAtLoading] = useState(false);
  const [priceAtError, setPriceAtError] = useState<string | null>(null);

  const lookupPriceAt = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(priceAtDate)) return;
    setPriceAtLoading(true);
    setPriceAtError(null);
    try {
      const res = await fetch(
        `/api/confectioner/products/${encodeURIComponent(productId)}/price-at?date=${priceAtDate}`,
        { credentials: "include" }
      );
      const data = (await res.json()) as PriceAtData & { error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setPriceAt({ ...data, queryKey: priceAtDate });
    } catch (e) {
      setPriceAtError(e instanceof Error ? e.message : "Не удалось получить цену");
    } finally {
      setPriceAtLoading(false);
    }
  };

  // --- Производные для отображения ---
  const current = history?.current ?? null;
  const previous = history?.previous ?? null;
  const items = history?.items ?? [];
  const visibleItems = selectedDayKey
    ? items.filter((i) => moscowDayKey(i.effectiveFrom) === selectedDayKey)
    : items;

  const changeDiff =
    current && previous ? current.amount - previous.amount : null;
  const changePct =
    changeDiff !== null && previous && previous.amount > 0
      ? Math.round((changeDiff / previous.amount) * 1000) / 10
      : null;

  return (
    <div className="space-y-6" data-testid="product-price-panel">
      {inline && (
        <div className="flex items-center justify-between">
          <h3 className="font-display font-semibold">Цены и история стоимости</h3>
          {onClose && (
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onClose} aria-label="Закрыть панель цен">
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}

      {/* ============ 1. Текущая цена ============ */}
      <section className="space-y-2" data-testid="section-current-price">
        <h3 className="text-sm font-semibold">Текущая цена</h3>
        {historyLoading && !history ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Загрузка истории…
          </div>
        ) : current ? (
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-lg font-semibold">{formatRub(current.amount)}</span>
              <span className="text-xs text-muted-foreground">
                действует с {formatMoscowDate(current.effectiveFrom)}
              </span>
              {current.planned && <Badge className="bg-amber-100 text-amber-700">Запланировано</Badge>}
            </div>
            {previous && changeDiff !== null && (
              <div
                className={cn(
                  "text-xs",
                  changeDiff > 0 && "text-emerald-600",
                  changeDiff < 0 && "text-red-600"
                )}
              >
                Предыдущая цена: {formatRub(previous.amount)} (с{" "}
                {formatMoscowDate(previous.effectiveFrom)}) · Изменение:{" "}
                <span className="font-medium">
                  {signedRub(changeDiff)}
                  {changePct !== null ? ` (${percentText(changePct)})` : ""}
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm">
            <span className="font-medium">{formatRub(currentPrice)}</span>{" "}
            <span className="text-xs text-muted-foreground">
              (цена из карточки; история цен недоступна{historyError ? `: ${historyError}` : ""})
            </span>
          </div>
        )}
      </section>

      {/* ============ 2. История изменений ============ */}
      <section className="space-y-2" data-testid="section-history">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-sm font-semibold">История изменений</h3>
          <div className="flex items-center gap-2">
            {selectedDayKey && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => setSelectedDayKey(null)}
              >
                Показать всю историю
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              aria-label="Обновить историю"
              onClick={() => void loadHistory()}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        {historyError && !history ? (
          <div className="text-sm text-destructive">
            {historyError}{" "}
            <Button size="sm" variant="outline" className="ml-2" onClick={() => void loadHistory()}>
              Повторить
            </Button>
          </div>
        ) : (
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Дата начала</TableHead>
                  <TableHead className="text-right">Цена</TableHead>
                  <TableHead className="text-right">Изменение ₽/%</TableHead>
                  <TableHead>Причина</TableHead>
                  <TableHead>Источник</TableHead>
                  <TableHead>Комментарий</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {historyLoading && items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                      <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                      Загрузка истории…
                    </TableCell>
                  </TableRow>
                ) : visibleItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-6" data-testid="history-empty">
                      {selectedDayKey
                        ? `Изменений за ${dayKeyToDDMMYYYY(selectedDayKey)} нет`
                        : "Истории пока нет"}
                    </TableCell>
                  </TableRow>
                ) : (
                  visibleItems.map((item) => {
                    const key = moscowDayKey(item.effectiveFrom);
                    return (
                      <TableRow
                        key={item.id}
                        data-testid="history-row"
                        data-day={key}
                        className={cn(selectedDayKey === key && "bg-primary/5")}
                      >
                        <TableCell className="whitespace-nowrap">
                          {formatMoscowDate(item.effectiveFrom)}
                        </TableCell>
                        <TableCell className="text-right font-medium whitespace-nowrap">
                          {formatRub(item.amount)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right whitespace-nowrap",
                            item.deltaRub !== null && item.deltaRub > 0 && "text-emerald-600",
                            item.deltaRub !== null && item.deltaRub < 0 && "text-red-600"
                          )}
                        >
                          {deltaText(item)}
                        </TableCell>
                        <TableCell>{reasonLabel(item.reason)}</TableCell>
                        <TableCell>{sourceLabel(item.source)}</TableCell>
                        <TableCell className="max-w-[16rem] break-words text-muted-foreground">
                          {item.comment || "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* ============ 3. Календарь изменения цен ============ */}
      <section className="space-y-2" data-testid="section-calendar">
        <h3 className="text-sm font-semibold">Календарь изменения цен</h3>
        <p className="text-xs text-muted-foreground">
          Точка — в этот день менялась цена (Europe/Moscow). Клик по дню фильтрует историю.
        </p>
        <div className="rounded-md border w-fit">
          <Calendar
            mode="single"
            locale={ru}
            month={calMonth}
            onMonthChange={setCalMonth}
            selected={selectedDayKey ? keyToLocalDate(selectedDayKey) : undefined}
            onSelect={(d) => setSelectedDayKey(d ? localDateKey(d) : null)}
            modifiers={{ changed: changedDates }}
            components={{ DayButton: DayButtonDot }}
          />
        </div>
      </section>

      {/* ============ 4. Новая цена ============ */}
      <section className="space-y-3" data-testid="section-new-price">
        <h3 className="text-sm font-semibold">Новая цена</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-price-amount">Новая цена, ₽</Label>
            <Input
              id="new-price-amount"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value.replace(/[^\d]/g, "").slice(0, 7))}
              placeholder="2500"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-price-date">Дата начала действия</Label>
            <Input
              id="new-price-date"
              type="date"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Будущая дата = планирование (цена вступит в силу автоматически)
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Причина изменения</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger aria-label="Причина изменения">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SELECTABLE_REASONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {reasonLabel(r)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-price-comment">Комментарий (необязательно)</Label>
          <Textarea
            id="new-price-comment"
            rows={2}
            maxLength={500}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Например: выросла цена сливок у поставщика"
          />
        </div>

        {formValid ? (
          <PricePreviewBlock
            currentAmount={currentAmount}
            newAmount={newAmount}
            effectiveKey={effectiveDate}
          />
        ) : (
          <p className="text-xs text-muted-foreground">
            Укажите цену (целое число ₽ больше 0) — превью рассчитается автоматически.
          </p>
        )}
        {isFuture && formValid && (
          <Badge className="bg-amber-100 text-amber-700">Запланировано</Badge>
        )}

        <Button type="button" disabled={!formValid} onClick={openConfirm}>
          Изменить цену
        </Button>

        <AlertDialog
          open={confirmOpen}
          onOpenChange={(open) => {
            if (!open) {
              setConfirmOpen(false);
              idempotencyKeyRef.current = null; // новое открытие = новый ключ
            }
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Подтвердите изменение цены</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-3">
                  {formValid ? (
                    <PricePreviewBlock
                      currentAmount={currentAmount}
                      newAmount={newAmount}
                      effectiveKey={effectiveDate}
                    />
                  ) : null}
                  {isFuture && (
                    <p>Покупатели увидят новую цену с этой даты.</p>
                  )}
                  {formError && (
                    <p role="alert" className="text-destructive font-medium" data-testid="price-form-error">
                      {formError}
                    </p>
                  )}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={submitting}>Отмена</AlertDialogCancel>
              <Button
                type="button"
                onClick={() => void submitPrice()}
                disabled={submitting}
                data-testid="confirm-price-button"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" /> Сохранение…
                  </>
                ) : (
                  "Подтвердить"
                )}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </section>

      {/* ============ 5. Цена на дату ============ */}
      <section className="space-y-2" data-testid="section-price-at">
        <h3 className="text-sm font-semibold">Цена на дату</h3>
        <div className="flex items-end gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="price-at-date">Дата</Label>
            <Input
              id="price-at-date"
              type="date"
              className="w-44"
              value={priceAtDate}
              onChange={(e) => setPriceAtDate(e.target.value)}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={!/^\d{4}-\d{2}-\d{2}$/.test(priceAtDate) || priceAtLoading}
            onClick={() => void lookupPriceAt()}
          >
            {priceAtLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Проверить цену"}
          </Button>
        </div>
        {priceAtError && <p className="text-sm text-destructive">{priceAtError}</p>}
        {priceAt && priceAt.amount !== null && (
          <p className="text-sm" data-testid="price-at-result">
            Цена на {dayKeyToDDMMYYYY(priceAt.queryKey)}:{" "}
            <span className="font-medium">{formatRub(priceAt.amount)}</span>
            {priceAt.reason !== "initial" && (
              <span className="text-muted-foreground"> · причина: {reasonLabel(priceAt.reason)}</span>
            )}
            {priceAt.versionId === null && (
              <span className="text-muted-foreground"> (истории нет — цена из карточки)</span>
            )}
          </p>
        )}
      </section>

      {/* ============ 6. Себестоимость (приблизительно) ============ */}
      <section className="space-y-2" data-testid="section-cost">
        <h3 className="text-sm font-semibold">Себестоимость (приблизительно)</h3>
        {costLoading && !cost ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Расчёт себестоимости…
          </div>
        ) : costError ? (
          <p className="text-sm text-destructive">
            {costError}{" "}
            <Button size="sm" variant="outline" className="ml-2" onClick={() => void loadCost()}>
              Повторить
            </Button>
          </p>
        ) : cost ? (
          <div className="space-y-3">
            {cost.currentCost.available && cost.currentCost.amountRub !== null ? (
              <div className="space-y-1">
                <div className="text-sm">
                  <span className="font-medium">{formatRub(cost.currentCost.amountRub)}</span>{" "}
                  <span className="text-xs text-muted-foreground">
                    приблизительно (рецепт × текущие закупочные цены)
                  </span>
                </div>
                {cost.margin && (
                  <div
                    className={cn(
                      "text-xs",
                      cost.margin.amountRub >= 0 ? "text-emerald-600" : "text-red-600"
                    )}
                  >
                    Маржа: {signedRub(cost.margin.amountRub)}
                    {cost.margin.percent !== null
                      ? ` (${percentText(cost.margin.percent)})`
                      : ""}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Себестоимость недоступна
                {cost.currentCost.reason ? `: ${cost.currentCost.reason}` : ""}
              </p>
            )}

            {/* Честные предупреждения (display only — авто-повышение цены НЕ предусмотрено) */}
            {cost.warnings.costExceedsPrice && (
              <Alert variant="destructive" data-testid="cost-warning-exceeds">
                <TriangleAlert className="h-4 w-4" />
                <AlertTitle>Себестоимость не ниже цены продажи</AlertTitle>
                <AlertDescription>
                  Продажа по текущей цене убыточна — проверьте рецепт или цену.
                </AlertDescription>
              </Alert>
            )}
            {cost.warnings.marginLow && (
              <Alert data-testid="cost-warning-margin" className="border-amber-400 text-amber-700">
                <TriangleAlert className="h-4 w-4" />
                <AlertTitle>Маржинальность ниже 20%</AlertTitle>
                <AlertDescription>Низкая маржа при текущей себестоимости.</AlertDescription>
              </Alert>
            )}
            {cost.warnings.costGrewWhilePriceStale && (
              <Alert data-testid="cost-warning-stale" className="border-amber-400 text-amber-700">
                <TriangleAlert className="h-4 w-4" />
                <AlertTitle>
                  Себестоимость выросла при прежней цене — рассмотрите пересмотр
                </AlertTitle>
                <AlertDescription>
                  Последние два снимка себестоимости показывают рост более 10%.
                </AlertDescription>
              </Alert>
            )}

            {/* Честные оговорки о данных */}
            <div className="rounded-md border bg-muted/30 p-3 space-y-1.5" data-testid="cost-notices">
              <div className="flex gap-2 text-xs text-muted-foreground">
                <Info className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                <span>
                  Исторические закупочные цены ингредиентов не сохранялись — историческая
                  себестоимость недоступна; снимки приблизительные
                  {cost.priceHistoryCosts.items.length > 0
                    ? ` (в истории: ${cost.priceHistoryCosts.items.length})`
                    : ""}
                  .
                </span>
              </div>
              <div className="flex gap-2 text-xs text-muted-foreground">
                <Info className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                <span>
                  Динамика цен ингредиентов: недоступна (закупочные цены исторически не
                  отслеживались).
                </span>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
