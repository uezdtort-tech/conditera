// GET /api/crm/customers/[id] — карточка клиента с timeline всех взаимодействий
//
// Auth: ADMIN / SUPPORT / MODERATOR
//
// Безопасность:
//   • Загружаем только публичные поля пользователя (без passwordHash, tfaSecret).
//   • Все 5 timeline-запросов параллельны через Promise.all.
//   • При сбое БД возвращаем 500 с общим сообщением.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { HttpError, handleRouteError } from "@/lib/http-helpers";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface SupabaseError {
  message: string;
}

interface OrderRow {
  id: string;
  number: string;
  total: number;
  status: string;
  payment_status: string;
  created_at: string;
  confectioner_name: string | null;
}

interface TicketRow {
  id: string;
  number: string;
  subject: string | null;
  status: string;
  priority: string | null;
  created_at: string;
  resolved_at: string | null;
}

interface ReviewRow {
  id: string;
  rating: number;
  text: string | null;
  created_at: string;
  product_id: string | null;
}

interface LeadRow {
  id: string;
  name: string;
  status: string;
  stage: string;
  budget: number | null;
  created_at: string;
}

interface CustomerRow {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  avatar: string | null;
  city: string | null;
  account_type: string | null;
  loyalty_level: string | null;
  bonus_balance: number | null;
  created_at: string;
}

const STAFF_ROLES = ["ADMIN", "SUPPORT", "MODERATOR"] as const;
const PUBLIC_FIELDS = "id, name, email, phone, avatar, city, account_type, loyalty_level, bonus_balance, created_at";

export async function GET(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id: customerId } = await params;
    if (!customerId) throw new HttpError(400, "Customer ID required");

    const user = await getUserFromRequest(request);
    if (!user) throw new HttpError(401, "Не авторизован");

    const isAdmin = user.roles.some((r) => (STAFF_ROLES as readonly string[]).includes(r));
    if (!isAdmin) {
      throw new HttpError(403, "Только для персонала");
    }

    // Загружаем пользователя с публичными полями
    const { data: customer, error: customerErr } = await supabaseAdmin
      .from("profiles")
      .select(PUBLIC_FIELDS)
      .eq("id", customerId)
      .maybeSingle() as { data: CustomerRow | null; error: SupabaseError | null };

    if (customerErr) {
      console.error("[crm/customers] lookup failed:", customerErr.message);
      throw new HttpError(500, "Не удалось загрузить клиента");
    }
    if (!customer) throw new HttpError(404, "Клиент не найден");

    // Параллельно загружаем все взаимодействия (5 запросов)
    const [ordersResult, ticketsResult, interactionsResult, reviewsResult, leadsResult] = await Promise.all([
      supabaseAdmin
        .from("orders")
        .select("id, number, total, status, payment_status, created_at, confectioner_name")
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false })
        .limit(20),
      supabaseAdmin
        .from("support_tickets")
        .select("id, number, subject, status, priority, created_at, resolved_at")
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false })
        .limit(20),
      supabaseAdmin
        .from("customer_interactions")
        .select("*")
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false })
        .limit(50),
      supabaseAdmin
        .from("reviews")
        .select("id, rating, text, created_at, product_id")
        .eq("author_id", customerId)
        .order("created_at", { ascending: false })
        .limit(10),
      supabaseAdmin
        .from("leads")
        .select("id, name, status, stage, budget, created_at")
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

    const orders = (ordersResult.data || []) as OrderRow[];
    const tickets = (ticketsResult.data || []) as TicketRow[];
    const interactions = interactionsResult.data || [];
    const reviews = (reviewsResult.data || []) as ReviewRow[];
    const leads = (leadsResult.data || []) as LeadRow[];

    // Считаем статистику
    const paidOrders = orders.filter(
      (o) => o.payment_status === "succeeded" || o.payment_status === "released"
    );
    const totalSpent = paidOrders.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
    const openTickets = tickets.filter(
      (t) => t.status === "open" || t.status === "in_progress"
    ).length;
    const avgRating = reviews.length > 0
      ? reviews.reduce((sum, r) => sum + (Number(r.rating) || 0), 0) / reviews.length
      : 0;

    const stats = {
      totalOrders: orders.length,
      totalSpent,
      openTickets,
      avgRating,
      lastOrderDate: orders[0]?.created_at || null,
      lastInteractionDate: interactions[0]?.created_at || null,
    };

    return NextResponse.json({
      customer,
      stats,
      timeline: {
        orders,
        tickets,
        interactions,
        reviews,
        leads,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
