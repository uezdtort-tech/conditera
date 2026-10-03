/**
 * REST /rest/v1/[...path] — PostgREST-совместимый шим.
 * Сюда ходит supabase-js (createClient с нашими собственными HS256-ключами).
 */

import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/postgrest/pool";
import { resolveClaims, type PgrstClaims } from "@/lib/postgrest/jwt";
import { getIntrospection, invalidateIntrospection } from "@/lib/postgrest/introspect";
import { withClaims } from "@/lib/postgrest/execute";
import {
  handleSelect,
  handleInsert,
  handleUpdate,
  handleDelete,
  handleRpc,
  type PgrstContext,
  type PgrstResult,
} from "@/lib/postgrest/translate";
import { pgrstErrorResponse, PgrstError } from "@/lib/postgrest/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, prefer, accept, accept-profile, content-profile, x-client-info, x-supabase-api-version, range",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, HEAD, OPTIONS",
  "Access-Control-Expose-Headers": "Content-Range, X-Total-Count",
  "Access-Control-Max-Age": "86400",
};

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204, headers: CORS });
}

type Ctx = { params: Promise<{ path?: string[] }> };

async function handle(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const started = Date.now();
  const { path } = await ctx.params;
  const segments = (path ?? []).map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  });

  try {
    if (!segments.length) {
      throw new PgrstError(404, "PGRST102", "Missing table or rpc path: use /rest/v1/{table} or /rest/v1/rpc/{fn}");
    }

    const claims = await resolveClaims(req);
    let body: unknown = null;
    if (req.method === "POST" || req.method === "PATCH" || req.method === "PUT") {
      const text = await req.text();
      if (text) {
        const contentType = req.headers.get("content-type") || "";
        if (contentType.includes("application/x-www-form-urlencoded")) {
          body = Object.fromEntries(new URLSearchParams(text));
        } else {
          try {
            body = JSON.parse(text);
          } catch {
            throw new PgrstError(400, "PGRST102", "Could not parse JSON body");
          }
        }
      } else {
        body = {};
      }
    }

    const pool = getPool();
    const intro = await getIntrospection(pool);
    const baseCtx: Omit<PgrstContext, "pool"> = {
      intro,
      method: req.method,
      segments,
      searchParams: req.nextUrl.searchParams,
      body,
      headers: req.headers,
    };

    let result: PgrstResult;
    try {
      result = await runWithClaims(claims, baseCtx, segments);
    } catch (err) {
      // 42P01 — кэш интроспекции устарел (миграции применились после старта
      // dev-сервера): сбросить и повторить один раз
      const code = (err as { code?: string }).code;
      const pgrstCode = (err as { pgrstCode?: string }).pgrstCode;
      if (code === "42P01" || pgrstCode === "PGRST205") {
        invalidateIntrospection();
        const fresh = await getIntrospection(pool);
        result = await runWithClaims(claims, { ...baseCtx, intro: fresh }, segments);
      } else {
        throw err;
      }
    }

    const ms = Date.now() - started;
    console.log(
      `[pgrst] ${req.method} /rest/v1/${segments.join("/")} → ${result.status} (${ms}ms, role=${claims.role})`
    );

    const headers = { ...CORS, ...result.headers };
    if (result.json === undefined) {
      return new NextResponse(null, { status: result.status, headers });
    }
    return new NextResponse(JSON.stringify(result.json), {
      status: result.status,
      headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (err) {
    const { status, body: errBody } = pgrstErrorResponse(err);
    const ms = Date.now() - started;
    console.warn(`[pgrst] ${req.method} /rest/v1/${segments.join("/")} → ${status} (${ms}ms): ${errBody.message}`);
    return new NextResponse(JSON.stringify(errBody), {
      status,
      headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
    });
  }
}

async function runWithClaims(
  claims: PgrstClaims,
  baseCtx: Omit<PgrstContext, "pool">,
  segments: string[]
): Promise<PgrstResult> {
  return withClaims(claims, async (client) => {
    const ctx: PgrstContext = { ...baseCtx, pool: client };
    if (segments[0].toLowerCase() === "rpc") {
      const fnName = segments[1];
      if (!fnName) throw new PgrstError(404, "PGRST202", "Missing function name after /rpc/");
      return handleRpc(ctx, fnName);
    }
    if (segments.length > 1) {
      throw new PgrstError(404, "PGRST205", `Unknown resource path /rest/v1/${segments.join("/")}`);
    }
    const tableName = segments[0];
    switch (ctx.method) {
      case "GET":
      case "HEAD":
        return handleSelect(ctx, tableName);
      case "POST":
        return handleInsert(ctx, tableName);
      case "PATCH":
      case "PUT":
        return handleUpdate(ctx, tableName);
      case "DELETE":
        return handleDelete(ctx, tableName);
      default:
        throw new PgrstError(405, "PGRST101", `Method ${ctx.method} is not supported`);
    }
  });
}

export const GET = handle;
export const HEAD = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
export const PUT = handle;
