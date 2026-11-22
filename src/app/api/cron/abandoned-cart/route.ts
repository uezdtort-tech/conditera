/**
 * GET /api/cron/abandoned-cart — register and return unsent abandoned-cart snapshots.
 * PATCH /api/cron/abandoned-cart — persist the notification delivery result.
 *
 * Called by the source-controlled n8n workflow. Every cart snapshot is
 * fingerprinted and stored before it is returned, so concurrent cron retries
 * cannot create duplicate notifications.
 */
import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyCronSecret, cronUnauthorized } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ABANDONED_HOURS = 2;
const RECENT_ORDER_HOURS = 24;
const REMINDER_CHANNELS = new Set(["email", "push", "telegram", "in_app"]);

interface AbandonedCartInfo {
  id: string;
  userId: string;
  userName: string | null;
  userEmail: string;
  itemsCount: number;
  total: number;
  lastActivity: string;
  notifiedAt: null;
}

function unauthorized(): NextResponse {
  const response = cronUnauthorized();
  return new NextResponse(response.body, {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

function isOptedOut(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const prefs = raw as Record<string, unknown>;
  return prefs.abandonedCart === false || prefs.abandoned_cart === false;
}

function hasAnyDeliveryChannel(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return true;
  const prefs = raw as Record<string, unknown>;
  return prefs.emailEnabled !== false || prefs.pushEnabled !== false || prefs.inAppEnabled !== false;
}

/**
 * GET /api/cron/abandoned-cart — register eligible snapshots and return only
 * those whose reminder has not been delivered yet.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!verifyCronSecret(req)) return unauthorized();

  try {
    const now = new Date();
    const cutoff = new Date(now.getTime() - ABANDONED_HOURS * 60 * 60 * 1000);
    const recentOrderCutoff = new Date(now.getTime() - RECENT_ORDER_HOURS * 60 * 60 * 1000);

    // First identify users with at least one stale item, then load their
    // complete cart. A recently changed item means the cart as a whole is not
    // abandoned, even if another line has been sitting untouched for hours.
    const { data: staleRows, error: staleErr } = await supabaseAdmin
      .from("cart_items")
      .select("user_id")
      .not("user_id", "is", null)
      .lt("updated_at", cutoff.toISOString());

    if (staleErr) {
      console.error("[cron/abandoned-cart] stale cart lookup failed:", staleErr.message);
      return NextResponse.json({ error: "Database query failed" }, { status: 500 });
    }
    const candidateUserIds = [...new Set((staleRows || []).map((row) => row.user_id).filter((id): id is string => Boolean(id)))];
    if (!candidateUserIds.length) {
      return NextResponse.json({ carts: [], total: 0, cutoff: cutoff.toISOString() });
    }

    const { data: cartItems, error: cartErr } = await supabaseAdmin
      .from("cart_items")
      .select("user_id, product_id, quantity, selected_attributes, created_at, updated_at")
      .in("user_id", candidateUserIds)
      .order("updated_at", { ascending: false });

    if (cartErr) {
      console.error("[cron/abandoned-cart] full cart lookup failed:", cartErr.message);
      return NextResponse.json({ error: "Database query failed" }, { status: 500 });
    }
    if (!cartItems?.length) {
      return NextResponse.json({ carts: [], total: 0, cutoff: cutoff.toISOString() });
    }

    const productIds = [...new Set(cartItems.map((item) => item.product_id).filter(Boolean))];
    const priceByProduct = new Map<string, number>();
    if (productIds.length) {
      const { data: products, error: productsErr } = await supabaseAdmin
        .from("products")
        .select("id, price")
        .in("id", productIds);
      if (productsErr) {
        console.error("[cron/abandoned-cart] product price lookup failed:", productsErr.message);
        return NextResponse.json({ error: "Product price lookup failed" }, { status: 500 });
      }
      for (const product of products || []) {
        priceByProduct.set(product.id, Number(product.price) || 0);
      }
    }

    type SnapshotItem = {
      product_id: string;
      quantity: number;
      unit_price: number;
      line_total: number;
      selected_attributes: unknown;
      updated_at: string;
    };
    const byUser = new Map<string, {
      items: SnapshotItem[];
      total: number;
      lastActivity: Date;
    }>();

    for (const item of cartItems) {
      if (!item.user_id) continue;
      const unitPrice = priceByProduct.get(item.product_id) || 0;
      const quantity = Number(item.quantity) || 1;
      const updatedAt = new Date(item.updated_at || item.created_at || now.toISOString());
      const snapshotItem: SnapshotItem = {
        product_id: item.product_id,
        quantity,
        unit_price: unitPrice,
        line_total: unitPrice * quantity,
        selected_attributes: item.selected_attributes ?? null,
        updated_at: updatedAt.toISOString(),
      };
      const existing = byUser.get(item.user_id);
      if (existing) {
        existing.items.push(snapshotItem);
        existing.total += snapshotItem.line_total;
        if (updatedAt > existing.lastActivity) existing.lastActivity = updatedAt;
      } else {
        byUser.set(item.user_id, {
          items: [snapshotItem],
          total: snapshotItem.line_total,
          lastActivity: updatedAt,
        });
      }
    }

    const cartsWithUserInfo = await Promise.all(
      Array.from(byUser.entries()).map(async ([userId, info]): Promise<AbandonedCartInfo | null> => {
        const { data: profile, error: profileErr } = await supabaseAdmin
          .from("profiles")
          .select("id, email, name, is_blocked, notify_prefs")
          .eq("id", userId)
          .maybeSingle();

        if (profileErr) throw new Error(`Profile lookup failed: ${profileErr.message}`);
        if (!profile || profile.is_blocked) return null;
        if (info.lastActivity >= cutoff) return null;
        if (isOptedOut(profile.notify_prefs) || !hasAnyDeliveryChannel(profile.notify_prefs)) return null;

        const { data: legacyPrefs, error: prefsErr } = await supabaseAdmin
          .from("notification_preferences")
          .select("abandoned_cart")
          .eq("user_id", userId)
          .maybeSingle();
        if (prefsErr) throw new Error(`Notification preference lookup failed: ${prefsErr.message}`);
        if (legacyPrefs?.abandoned_cart === false) return null;

        const { data: recentOrders, error: ordersErr } = await supabaseAdmin
          .from("orders")
          .select("id")
          .eq("user_id", userId)
          .gt("created_at", recentOrderCutoff.toISOString())
          .limit(1);
        if (ordersErr) throw new Error(`Recent order lookup failed: ${ordersErr.message}`);
        if (recentOrders?.length) return null;

        const snapshot = info.items.sort((a, b) =>
          a.product_id.localeCompare(b.product_id) ||
          a.updated_at.localeCompare(b.updated_at) ||
          a.quantity - b.quantity
        );
        const fingerprint = createHash("sha256")
          .update(JSON.stringify(snapshot))
          .digest("hex");

        const { error: registerErr } = await supabaseAdmin
          .from("abandoned_cart_logs")
          .upsert({
            user_id: userId,
            cart_fingerprint: fingerprint,
            cart_items: snapshot,
            cart_total: Math.round(info.total * 100),
            cart_items_count: snapshot.length,
            abandoned_at: info.lastActivity.toISOString(),
            metadata: { source: "n8n", currency: "RUB", fingerprint },
          }, {
            onConflict: "user_id,cart_fingerprint",
            ignoreDuplicates: true,
          });

        if (registerErr) throw new Error(`Abandoned cart registration failed: ${registerErr.message}`);

        const { data: log, error: logErr } = await supabaseAdmin
          .from("abandoned_cart_logs")
          .select("id, reminder_sent_at, reminder_status")
          .eq("user_id", userId)
          .eq("cart_fingerprint", fingerprint)
          .maybeSingle();

        if (logErr) throw new Error(`Abandoned cart log lookup failed: ${logErr.message}`);
        if (!log || log.reminder_sent_at ||
            ["sent", "clicked", "converted"].includes(log.reminder_status || "")) {
          return null;
        }

        return {
          id: log.id,
          userId: profile.id,
          userName: profile.name,
          userEmail: profile.email || "",
          itemsCount: snapshot.length,
          total: Number(info.total.toFixed(2)),
          lastActivity: info.lastActivity.toISOString(),
          notifiedAt: null,
        };
      })
    );

    const validCarts = cartsWithUserInfo.filter((cart): cart is AbandonedCartInfo => cart !== null);
    return NextResponse.json({
      carts: validCarts,
      total: validCarts.length,
      cutoff: cutoff.toISOString(),
    });
  } catch (error) {
    console.error("[cron/abandoned-cart] GET failed:", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * PATCH /api/cron/abandoned-cart — persist the n8n delivery outcome.
 * Failed/skipped attempts remain eligible for an idempotent retry.
 */
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  if (!verifyCronSecret(req)) return unauthorized();

  try {
    const body = await req.json() as {
      cartId?: string;
      action?: string;
      skipped?: boolean;
      channel?: string;
    };
    if (body.action !== "mark_notified" ||
        typeof body.cartId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.cartId)) {
      return NextResponse.json({ error: "Invalid action or cartId" }, { status: 400 });
    }

    const skipped = body.skipped === true;
    const channel = body.channel && REMINDER_CHANNELS.has(body.channel) ? body.channel : "email";
    const update = skipped
      ? { reminder_status: "failed" as const, reminder_sent_at: null, reminder_channel: null }
      : { reminder_status: "sent" as const, reminder_sent_at: new Date().toISOString(), reminder_channel: channel };

    const { data: updated, error } = await supabaseAdmin
      .from("abandoned_cart_logs")
      .update(update)
      .eq("id", body.cartId)
      .is("reminder_sent_at", null)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("[cron/abandoned-cart] reminder state update failed:", error.message);
      return NextResponse.json({ error: "Failed to persist reminder state" }, { status: 500 });
    }
    if (!updated) {
      const { data: existing, error: lookupErr } = await supabaseAdmin
        .from("abandoned_cart_logs")
        .select("id, reminder_sent_at")
        .eq("id", body.cartId)
        .maybeSingle();
      if (lookupErr) return NextResponse.json({ error: "Failed to confirm reminder state" }, { status: 500 });
      if (!existing) return NextResponse.json({ error: "Abandoned cart log not found" }, { status: 404 });
      if (existing.reminder_sent_at) {
        return NextResponse.json({ success: true, alreadyNotified: true, cartId: body.cartId });
      }
    }

    return NextResponse.json({
      success: true,
      skipped,
      cartId: body.cartId,
      status: skipped ? "failed" : "sent",
    });
  } catch (error) {
    console.error("[cron/abandoned-cart] PATCH failed:", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
