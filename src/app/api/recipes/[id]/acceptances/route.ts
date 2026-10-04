/**
 * GET /api/recipes/[id]/acceptances — публичный список кондитеров, подтвердивших готовность.
 *
 * Query: ?lat=...&lng=... (точные координаты) или ?city=Москва&q=ул. Тверская (произвольный адрес)
 *
 * Безопасность:
 *   • GET: public endpoint.
 *   • При сбое основного запроса — fallback на audit_logs.
 *   • Если БД пуста — fallback на MOCK_ACCEPTANCES для демонстрации функции «ближайший кондитер».
 *   • BUG FIXED: раньше искал confectioners по userId в confectionerIds, но
 *     recipe_acceptances.confectioner_id ссылается на confectioners.id, не на profiles.id.
 *     Теперь ищем по id.
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

// Mock-подтверждения для демонстрации, когда БД пуста
const MOCK_ACCEPTANCES: AcceptanceWithDistance[] = [
  {
    acceptanceId: "mock-a1",
    confectionerId: "u0",
    priceFrom: 1800,
    priceTo: 3500,
    prepDays: 2,
    delivery: true,
    selfPickup: true,
    notes: "Точное воспроизведение рецепта, опционально — сахарная печать фото на торт.",
    status: "active",
    confectioner: {
      id: "u0",
      userId: "u0",
      businessName: "Торты на заказ | Сахарная печать",
      avatar: "https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=400",
      city: "Волоколамск",
      rating: 5.0,
      reviewsCount: 1,
      verified: true,
      trustLevel: "TRUSTED",
      location: { lat: 56.9555, lng: 35.9567, serviceRadiusKm: 50 },
    },
    distanceKm: null,
    withinServiceRadius: true,
  },
  {
    acceptanceId: "mock-a2",
    confectionerId: "u2",
    priceFrom: 1500,
    priceTo: 3000,
    prepDays: 3,
    delivery: true,
    selfPickup: true,
    notes: "Бисквит + крем по рецепту, доставка по Туле и области.",
    status: "active",
    confectioner: {
      id: "u2",
      userId: "u2",
      businessName: "Сладкая уездная",
      avatar: "https://i.pravatar.cc/150?img=32",
      city: "Тула",
      rating: 4.9,
      reviewsCount: 87,
      verified: true,
      trustLevel: "TRUSTED",
      location: { lat: 54.1961, lng: 37.6182, serviceRadiusKm: 25 },
    },
    distanceKm: null,
    withinServiceRadius: true,
  },
  {
    acceptanceId: "mock-a3",
    confectionerId: "u6",
    priceFrom: 2200,
    priceTo: null,
    prepDays: 4,
    delivery: true,
    selfPickup: false,
    notes: "Большой опыт свадебных тортов, доставлю по Москве и МО.",
    status: "active",
    confectioner: {
      id: "u6",
      userId: "u6",
      businessName: "Мастерская сладких искусств",
      avatar: "https://i.pravatar.cc/150?img=45",
      city: "Москва",
      rating: 4.95,
      reviewsCount: 156,
      verified: true,
      trustLevel: "MASTER",
      location: { lat: 55.7558, lng: 37.6173, serviceRadiusKm: 30 },
    },
    distanceKm: null,
    withinServiceRadius: true,
  },
];

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

    // Если БД пуста — показываем mock для демонстрации функции «ближайший кондитер»
    if (rawAcceptances.length === 0) {
      rawAcceptances = MOCK_ACCEPTANCES;
    }

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
    return handleRouteError(error);
  }
}
