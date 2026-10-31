/**
 * cart-sync.ts — клиентский слой синхронизации корзины с сервером (P1 «серверная
 * корзина»). ЛОКАЛЬНАЯ корзина (Zustand persist) остаётся источником истины для
 * UI: НИ ОДНА мутация не блокируется сетью и не откатывается при сбое. Сервер —
 * durable-зеркало (cart_items, миграция 0062) для: перезагрузки, другого
 * устройства, guest→login объединения и повтора checkout.
 *
 * Почему НЕ fire-and-forget без защиты (риски из P1 §2):
 *   • очередь операций с ОДНОПОТОЧНОЙ обработкой (single-flight) — нет гонок
 *     параллельных запросов одного и того же ref;
 *   • ретраи с экспоненциальной паузой (3 попытки) на сетевых/5xx сбоях;
 *     4xx (валидация) — операция снимается с журналированием (серверный checkout
 *     всё равно валидирует финально);
 *   • операции НЕСОБЫТИЙНЫЕ, а СОСТОЯНИЕ-абсолютные (upsert с полным снимком,
 *     setQty с итоговым количеством) → повтор при ретрае идемпотентен,
 *     потеря промежуточной операции не портит итог;
 *   • слияние при reconcile — UNION/MAX по контент-ключу (lib/cart-merge.ts):
 *     повторная синхронизация того же состояния НЕ раздувает количество;
 *   • сменa пользователя: guest-корзина сливается при входе; корзина ДРУГОГО
 *     аккаунта (cart-owner в localStorage) — не сливается (нет утечки между
 *     пользователями), локальная корзина заменяется серверной нового аккаунта.
 *
 * Известное ограничение (документировано, не дефект текущей задачи): офлайн-
 * удаление на устройстве A может «воскреснуть» на устройстве B, которое ещё не
 * получило удаление и синхронизирует ПОЛНОЕ состояние (UNION). Полное решение —
 * tombstones; сознательно отложено (см. отчёт P1).
 */

import { useAppStore } from "@/lib/store";
import type { CartItem } from "@/lib/types";
import { getCsrfToken, getSessionAuthHeaders } from "@/lib/api-client";
import { calculateBuilderPrice, describeBuilderConfig, type CakeBuilderConfig } from "@/lib/cake-builder-pricing";

// ===== Типы =====

interface ItemSnapshot {
  product_id?: string;
  custom_config?: Record<string, unknown>;
  selected_attributes?: Record<string, string>;
  quantity: number;
  notes?: string;
}

type SyncOp =
  | { kind: "upsert"; ref: string; snapshot: ItemSnapshot; attempts: number }
  | { kind: "setQty"; ref: string; quantity: number; snapshot: ItemSnapshot; attempts: number }
  | { kind: "remove"; ref: string; attempts: number }
  | { kind: "clear"; attempts: number };

interface ServerCartItem {
  id: string;
  client_ref: string | null;
  product_id: string | null;
  quantity: number;
  selected_attributes: Record<string, string> | null;
  custom_config: Record<string, unknown> | null;
  notes: string | null;
  product: { id: string; title: string; price: number; images: unknown } | null;
}

const OWNER_KEY = "conditera:cart-owner";
const RETRY_LIMIT = 3;
const RETRY_BASE_MS = 600;
const FLUSH_INTERVAL_MS = 20_000;

// ===== Состояние модуля =====

let started = false;
let suppressDiff = false;
let processing = false;
let reconcileInFlight = false;
let lastUserId: string | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;
const queue: SyncOp[] = [];

// ===== Утилиты =====

/** Стабильный client_ref позиции: itemId, для легаси-строк — производная от productId. */
function refOf(item: { itemId?: string; productId: string }): string {
  return item.itemId || `legacy_${item.productId}`;
}

/** Снимок позиции для сервера (структура = CartItemInputSchema из cart-merge). */
function snapshotOf(item: CartItem): ItemSnapshot {
  const selected = item.customization
    ? (Object.fromEntries(
        Object.entries(item.customization).filter(([, v]) => typeof v === "string" && v.length > 0)
      ) as Record<string, string>)
    : undefined;
  return {
    product_id: item.productId || undefined,
    custom_config: (item.custom?.config as Record<string, unknown> | undefined) || undefined,
    selected_attributes: selected && Object.keys(selected).length > 0 ? selected : undefined,
    quantity: item.quantity,
  };
}

async function cartFetch(
  path: string,
  init: { method: string; body?: unknown }
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const csrf = await getCsrfToken();
  const headers = await getSessionAuthHeaders(csrf);
  const res = await fetch(path, {
    method: init.method,
    headers: { ...headers, "Content-Type": "application/json" },
    credentials: "include",
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const data = (await res.json().catch(() => null)) as unknown;
  return { ok: res.ok, status: res.status, data };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isRetriable(status: number): boolean {
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

// ===== Очередь (single-flight + ретраи) =====

/** Сжатие очереди: последний op по ref побеждает; remove отменяет pending-мутации ref. */
function enqueue(op: SyncOp): void {
  if (op.kind === "clear") {
    queue.length = 0;
    queue.push(op);
    return;
  }
  const idx = queue.findIndex((q) => "ref" in q && q.ref === op.ref);
  if (idx >= 0) {
    const existing = queue[idx];
    if (op.kind === "remove") {
      queue.splice(idx, 1); // удаление отменяет pending upsert/setQty
      queue.push(op);
      return;
    }
    // upsert/setQty для того же ref: последний снимок/количество побеждают
    queue[idx] = { ...op, attempts: existing.attempts };
    return;
  }
  queue.push(op);
}

async function runOp(op: SyncOp): Promise<boolean> {
  // true = операция завершена (успех или снята), false = нужен ретрай
  try {
    if (op.kind === "clear") {
      const r = await cartFetch("/api/cart", { method: "DELETE" });
      if (r.ok) return true;
      if (!isRetriable(r.status)) return true; // 4xx — снимаем (сервер валиден)
      return false;
    }
    if (op.kind === "remove") {
      const r = await cartFetch(`/api/cart/${encodeURIComponent(op.ref)}`, { method: "DELETE" });
      // 404 — уже удалена (идемпотентный успех)
      return r.ok || r.status === 404;
    }
    if (op.kind === "upsert") {
      const r = await cartFetch("/api/cart", {
        method: "POST",
        body: { client_ref: op.ref, ...op.snapshot },
      });
      if (r.ok) return true;
      if (!isRetriable(r.status)) return true; // 4xx — валидация, снимаем
      return false;
    }
    // setQty: PATCH по ref; 404 (строки ещё нет на сервере — add не дошёл)
    // → конвертируем в абсолютный upsert
    const r = await cartFetch(`/api/cart/${encodeURIComponent(op.ref)}`, {
      method: "PATCH",
      body: { quantity: op.quantity },
    });
    if (r.ok) return true;
    if (r.status === 404) {
      const up: SyncOp = {
        kind: "upsert",
        ref: op.ref,
        snapshot: { ...op.snapshot, quantity: op.quantity },
        attempts: op.attempts,
      };
      queue.unshift(up);
      return true;
    }
    return !isRetriable(r.status);
  } catch {
    return false; // сеть — ретрай
  }
}

async function flushQueue(): Promise<void> {
  if (processing || queue.length === 0) return;
  processing = true;
  try {
    while (queue.length > 0) {
      const op = queue[0];
      const done = await runOp(op);
      if (done) {
        queue.shift();
      } else {
        op.attempts += 1;
        if (op.attempts >= RETRY_LIMIT) {
          // Деградация: оставляем op во главе очереди — локальное состояние НЕ
          // трогаем (UI консистентен), сервер догонит при следующем flush
          // (online/интервал/следующая мутация). Данные не теряются.
          console.warn("[cart-sync] op degraded, keep queued:", op.kind, "ref" in op ? op.ref : "");
          break;
        }
        await sleep(RETRY_BASE_MS * Math.pow(2, op.attempts - 1));
      }
    }
  } finally {
    processing = false;
  }
}

// ===== Adoption: серверное состояние → локальная корзина =====

function firstImage(images: unknown): string {
  if (typeof images === "string" && images) return images;
  if (Array.isArray(images)) {
    const first = images[0];
    if (typeof first === "string" && first) return first;
    if (first && typeof first === "object") {
      const url = (first as { url?: unknown }).url;
      if (typeof url === "string" && url) return url;
    }
  }
  return "";
}

/** DTO сервера → CartItem локальной корзины (client_ref становится itemId). */
function dtoToCartItem(dto: ServerCartItem): CartItem | null {
  const ref = dto.client_ref || `srv_${dto.id.slice(0, 8)}`;
  if (dto.custom_config) {
    const config = dto.custom_config as unknown as CakeBuilderConfig;
    return {
      itemId: ref,
      productId: "",
      title: describeBuilderConfig(config),
      image: "/builder-bg.png",
      price: calculateBuilderPrice(config) ?? 0,
      quantity: dto.quantity,
      confectionerId: "",
      custom: { config },
    };
  }
  if (!dto.product_id) return null; // битая строка (нет ни товара, ни конфига)
  const attrs = dto.selected_attributes || {};
  const customization = {
    filling: attrs.filling || undefined,
    coating: attrs.coating || undefined,
    decoration: attrs.decoration || undefined,
    inscription: attrs.inscription || undefined,
  } as CartItem["customization"];
  const hasAttrs = Boolean(attrs.filling || attrs.coating || attrs.decoration || attrs.inscription);
  return {
    itemId: ref,
    productId: dto.product_id,
    title: dto.product?.title || "Товар",
    image: firstImage(dto.product?.images),
    price: dto.product?.price ?? 0,
    quantity: dto.quantity,
    confectionerId: "",
    customization: hasAttrs ? customization : undefined,
  };
}

/** Заменить локальную корзину серверным состоянием (без triggering diff). */
function adoptServerItems(items: ServerCartItem[]): void {
  const mapped = items
    .map(dtoToCartItem)
    .filter((x): x is NonNullable<typeof x> => x !== null);
  suppressDiff = true;
  try {
    useAppStore.setState({ cart: mapped });
  } finally {
    suppressDiff = false;
  }
}

// ===== Reconcile (boot / login / другое устройство) =====

async function reconcile(): Promise<void> {
  const state = useAppStore.getState();
  const user = state.user;
  if (!user || reconcileInFlight) return;
  reconcileInFlight = true;
  try {
    await flushQueue(); // очередь важнее слияния: сервер должен увидеть актуальное состояние

    const localCart = useAppStore.getState().cart;

    if (localCart.length === 0) {
      // Локально пусто (новое устройство / после чужой сессии) → восстановить с сервера
      const r = await cartFetch("/api/cart", { method: "GET" });
      if (r.ok) {
        const items = ((r.data as { items?: ServerCartItem[] })?.items || []) as ServerCartItem[];
        if (items.length > 0) adoptServerItems(items);
      }
      return;
    }

    // Локально не пусто → UNION-слияние (guest→login, офлайн-изменения, другое устройство)
    const payloadItems = localCart.map((item) => ({
      client_ref: refOf(item),
      ...snapshotOf(item),
    }));
    const r = await cartFetch("/api/cart", { method: "PUT", body: { items: payloadItems } });
    if (r.ok) {
      const items = ((r.data as { items?: ServerCartItem[] })?.items || []) as ServerCartItem[];
      adoptServerItems(items); // серверное merged-состояние канонично
    }
    // сбой сети → локальная корзина нетронута, следующий reconcile повторит
  } finally {
    reconcileInFlight = false;
  }
}

// ===== Смена пользователя: защита от утечки корзины между аккаунтами =====

function handleUserTransition(prevUserId: string | null, nextUserId: string | null): void {
  if (prevUserId === nextUserId) return;
  // Смена сессии → все pending-op предыдущего пользователя недействительны
  queue.length = 0;

  if (!nextUserId) {
    lastUserId = null;
    return; // logout: локальная корзина остаётся (существующее поведение гостя)
  }

  const prevOwner = typeof localStorage !== "undefined" ? localStorage.getItem(OWNER_KEY) : null;
  lastUserId = nextUserId;
  localStorage.setItem(OWNER_KEY, nextUserId);

  if (prevOwner && prevOwner !== nextUserId) {
    // В localStorage корзина ДРУГОГО аккаунта — сливать НЕЛЬЗЯ (утечка между
    // пользователями). Локальная корзина очищается, серверная нового аккаунта
    // будет принята в reconcile.
    suppressDiff = true;
    try {
      useAppStore.setState({ cart: [] });
    } finally {
      suppressDiff = false;
    }
  }
  void reconcile();
}

// ===== Запуск =====

export function startCartSync(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  const store = useAppStore;
  const currentUser = store.getState().user;
  lastUserId = currentUser?.id ?? null;
  if (currentUser && typeof localStorage !== "undefined") {
    localStorage.setItem(OWNER_KEY, currentUser.id);
  }

  // Первичный reconcile: восстанавливает корзину с сервера / сливает локальную
  setTimeout(() => void reconcile(), 400);

  store.subscribe((state, prevState) => {
    // Смена пользователя (login/logout/аккаунт)
    const prevUid = prevState.user?.id ?? null;
    const nextUid = state.user?.id ?? null;
    if (prevUid !== nextUid) {
      handleUserTransition(prevUid, nextUid);
    }
    if (suppressDiff || !state.user) return;

    const cart = state.cart;
    const prevCart = prevState.cart;

    if (cart.length === 0 && prevCart.length > 0) {
      enqueue({ kind: "clear", attempts: 0 });
      void flushQueue();
      return;
    }

    const prevByRef = new Map(prevCart.map((i) => [refOf(i), i]));
    const nextByRef = new Map(cart.map((i) => [refOf(i), i]));

    for (const item of cart) {
      const ref = refOf(item);
      const prev = prevByRef.get(ref);
      if (!prev) {
        enqueue({
          kind: "upsert",
          ref,
          snapshot: snapshotOf(item),
          attempts: 0,
        });
      } else if (prev.quantity !== item.quantity) {
        enqueue({
          kind: "setQty",
          ref,
          quantity: item.quantity,
          snapshot: snapshotOf(item),
          attempts: 0,
        });
      }
    }
    for (const prevItem of prevCart) {
      if (!nextByRef.has(refOf(prevItem))) {
        enqueue({ kind: "remove", ref: refOf(prevItem), attempts: 0 });
      }
    }
    if (queue.length > 0) void flushQueue();
  });

  // Сеть вернулась / периодический дого́н — данные из очереди не теряются
  window.addEventListener("online", () => void flushQueue());
  flushTimer = setInterval(() => {
    if (queue.length > 0) void flushQueue();
  }, FLUSH_INTERVAL_MS);

  if (typeof window !== "undefined") {
    (window as unknown as { __cartSync?: unknown }).__cartSync = {
      get pendingOps() {
        return queue.length;
      },
      flush: () => flushQueue(),
    };
  }
}

export function stopCartSyncForTests(): void {
  if (flushTimer) clearInterval(flushTimer);
  flushTimer = null;
  queue.length = 0;
  started = false;
}
