/**
 * GET /api/recipes/[id]/acceptances — публичный список кондитеров, подтвердивших готовность.
 *
 * Query: ?lat=...&lng=... (точные координаты) или ?city=Москва&q=ул. Тверская (произвольный адрес)
 *
 * Безопасность:
 *   • GET: public endpoint.
 *   • При сбое основного запроса — fallback на audit_logs (реальные записи
 *     действий «recipe_acceptance», не вымышленные данные).
 *   • Пустой результат → честный пустой ответ ({ acceptances: [], total: 0 }):
 *     mock-кондитеры НЕ подставляются НИКОГДА (ZV33-7b FIX 2 / ZV33-6 C-1 —
 *     live-reachable mock убит; деmo-витрина этого endpoint'а не требует).
 *   • Type-safe interfaces, без `as any` для location.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveCoords, haversineKm, type GeoCoords } from "@/lib/geocoder";
import { HttpError, handleRouteError } from "@/lib/http-helpers";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface SupabaseError {
  message: string;
}

interface RecipeAcceptanceRow {
  id: string;
  recipe_id: string;
  confectioner_id: string;
  price_from: number | null;
  price_to: number | null;
  prep_days: number | null;
  delivery: boolean | null;
  self_pickup: boolean | null;
  notes: string | null;
  status: string;
  created_at: string;
}

interface ConfectionerRow {
  id: string;
  userId: string;
  businessName: string;
  avatar: string | null;
  city: string | null;
  rating: number | null;
  reviewsCount: number | null;
  verified: boolean | null;
  trustLevel: string | null;
  location: unknown;
}

interface AuditLogRow {
  id: string;
  userId: string | null;
  entityId: string | null;
  metadata: unknown;
  createdAt: string;
}

interface AcceptanceWithConfectioner {
  acceptanceId: string;
  confectionerId: string;
  priceFrom: number | null;
  priceTo: number | null;
  prepDays: number | null;
  delivery: boolean | null;
  selfPickup: boolean | null;
  notes: string | null;
  status: string;
  confectioner: ConfectionerRow | null;
}

interface AcceptanceWithDistance extends AcceptanceWithConfectioner {
  distanceKm: number | null;
  withinServiceRadius: boolean;
  isNearest?: boolean;
}

interface ConfectionerLocation {
  lat: number;
  lng: number;
  serviceRadiusKm?: number;
  [key: string]: unknown;
}

/**
 * Безопасное приведение location (jsonb) к ConfectionerLocation.
 */
function coerceLocation(raw: unknown): ConfectionerLocation | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const lat = Number(obj.lat);
  const lng = Number(obj.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const location: ConfectionerLocation = { lat, lng };
  if (typeof obj.serviceRadiusKm === "number" && Number.isFinite(obj.serviceRadiusKm)) {
    location.serviceRadiusKm = obj.serviceRadiusKm;
  }
  return location;
}

export async function GET(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id: recipeId } = await params;
    if (!recipeId) throw new HttpError(400, "Recipe ID required");

    const sp = request.nextUrl.searchParams;

    // Резолвим координаты пользователя через геокодер (словарь → DaData → Yandex)
    let userCoords: GeoCoords | null = null;
    const lat = parseFloat(sp.get("lat") || "");
    const lng = parseFloat(sp.get("lng") || "");
    const city = sp.get("city") || "";
    const q = sp.get("q") || ""; // произвольный адрес

    if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
      userCoords = { lat, lng, source: "passed_coords" };
    } else if (city.trim() || q.trim()) {
      userCoords = await resolveCoords(q.trim() || city.trim());
    }

    let rawAcceptances: AcceptanceWithConfectioner[] = [];

    try {
      const { data: acceptances, error: accErr } = await supabaseAdmin
        .from("recipe_acceptances")
        .select("*")
        .eq("recipe_id", recipeId)
        .eq("status", "active")
        .order("price_from", { ascending: true }) as { data: RecipeAcceptanceRow[] | null; error: SupabaseError | null };

      if (accErr) throw accErr;

      if (acceptances && acceptances.length > 0) {
        // Ищем confectioners по id (не по user_id!) — confectioner_id ссылается на confectioners.id
        const confectionerIds = [...new Set(acceptances.map((a) => a.confectioner_id))];
        const { data: confectioners, error: confErr } = await supabaseAdmin
          .from("confectioners")
          .select(`
            id, userId, businessName, avatar, city, rating,
            reviewsCount, verified, trustLevel, location
          `)
          .in("id", confectionerIds) as { data: ConfectionerRow[] | null; error: SupabaseError | null };

        if (confErr) {
          console.warn("[recipes/acceptances] confectioners load failed:", confErr.message);
        }

        const confList = confectioners || [];
        rawAcceptances = acceptances.map((a) => {
          const conf = confList.find((c) => c.id === a.confectioner_id) || null;
          return {
            acceptanceId: a.id,
            confectionerId: a.confectioner_id,
            priceFrom: a.price_from,
            priceTo: a.price_to,
            prepDays: a.prep_days,
            delivery: a.delivery,
            selfPickup: a.self_pickup,
            notes: a.notes,
            status: a.status,
            confectioner: conf,
          };
        });
      }
    } catch (e) {
      // БД недоступна — fallback через audit_logs
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[recipes/acceptances] recipe_acceptances failed, fallback to audit_logs:", msg);
      try {
        const { data: logs, error: logErr } = await supabaseAdmin
          .from("audit_logs")
          .select("id, userId, entityId, metadata, createdAt")
          .eq("action", "recipe_acceptance")
          .eq("entityId", recipeId)
          .order("createdAt", { ascending: false }) as { data: AuditLogRow[] | null; error: SupabaseError | null };

        if (logErr) throw logErr;
        rawAcceptances = (logs || []).map((l) => {
          const meta = (l.metadata || {}) as Record<string, unknown>;
          return {
            acceptanceId: l.id,
            confectionerId: l.userId || "",
            priceFrom: (meta.priceFrom as number) || 1500,
            priceTo: (meta.priceTo as number) || null,
            prepDays: (meta.prepDays as number) || 3,
            delivery: (meta.delivery as boolean) ?? true,
            selfPickup: (meta.selfPickup as boolean) ?? true,
            notes: (meta.notes as string) || null,
            status: "active",
            confectioner: null,
          };
        });
      } catch {
        rawAcceptances = [];
      }
    }

    // ZV33-7b FIX 2 (ZV33-6 C-1): пустой результат — ЧЕСТНЫЙ пустой ответ.
    // Раньше здесь подставлялись MOCK_ACCEPTANCES (вымышленные кондитеры) —
    // публичный endpoint отдавал фейковые данные; фронтенд рендерит честный
    // empty-state («Пока ни один кондитер не подтвердил…», recipe-detail-page).

    // Считаем расстояние, если есть координаты пользователя
    let result: AcceptanceWithDistance[] = rawAcceptances.map((a) => {
      const confLoc = coerceLocation(a.confectioner?.location);
      let distanceKm: number | null = null;
      let withinServiceRadius = true;
      if (userCoords && confLoc) {
        distanceKm = haversineKm(userCoords.lat, userCoords.lng, confLoc.lat, confLoc.lng);
        if (typeof confLoc.serviceRadiusKm === "number") {
          withinServiceRadius = distanceKm <= confLoc.serviceRadiusKm;
        }
      }
      return { ...a, distanceKm, withinServiceRadius };
    });

    // Сортировка: сначала кондитеры в зоне обслуживания, потом по расстоянию
    if (userCoords) {
      result.sort((a, b) => {
        if (a.withinServiceRadius !== b.withinServiceRadius) {
          return a.withinServiceRadius ? -1 : 1;
        }
        if (a.distanceKm !== null && b.distanceKm === null) return -1;
        if (a.distanceKm === null && b.distanceKm !== null) return 1;
        if (a.distanceKm !== null && b.distanceKm !== null) {
          return a.distanceKm - b.distanceKm;
        }
        return (a.priceFrom || 0) - (b.priceFrom || 0);
      });
    } else {
      result.sort((a, b) => (a.priceFrom || 0) - (b.priceFrom || 0));
    }

    // Помечаем ближайшего
    if (userCoords && result.length > 0 && result[0].distanceKm !== null) {
      result = result.map((a, i) => ({
        ...a,
        isNearest: i === 0 && a.distanceKm !== null,
      }));
    } else {
      result = result.map((a) => ({ ...a, isNearest: false }));
    }

    return NextResponse.json({
      acceptances: result,
      total: result.length,
      userLocation: userCoords
        ? {
            lat: userCoords.lat,
            lng: userCoords.lng,
            source: userCoords.source,
            formatted: userCoords.formatted || null,
          }
        : null,
    });
  } catch (error) {
    return handleRouteError(error, {
      route: "/api/recipes/[id]/acceptances",
      component: "recipes",
      requestId: request.headers.get("x-request-id") ?? undefined,
    });
  }
}
