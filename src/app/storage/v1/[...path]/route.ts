/**
 * /storage/v1/[...path] — минимальный Storage-шим (локальное файловое хранилище).
 *
 * Покрывает фактическое использование supabase-js storage в проекте:
 *   • upload(path, file, {contentType})      → PUT/POST /storage/v1/object/{bucket}/{path}
 *   • getPublicUrl(path)                     → GET /storage/v1/object/public/{bucket}/{path}
 *   • remove(paths)                          → DELETE /storage/v1/object/{bucket}/{path}
 * Файлы лежат в <project>/upload/storage/{bucket}/{path}; метаданные — в
 * storage.objects (stub из supabase/compat/0000_supabase_compat.sql).
 */

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { getPool } from "@/lib/postgrest/pool";
import { resolveClaims } from "@/lib/postgrest/jwt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPLOAD_ROOT = path.join(process.cwd(), "upload", "storage");

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

type Ctx = { params: Promise<{ path?: string[] }> };

/** Безопасный путь: без '..' и абсолютных сегментов. */
function safeJoin(parts: string[]): string {
  const clean = parts.filter((p) => p && p !== "." && p !== ".." && !p.includes("/") && !p.includes("\\"));
  if (clean.length !== parts.length) throw new Error("unsafe path");
  return path.join(...clean);
}

async function objectRow(bucket: string, objectPath: string, size: number, mime: string): Promise<void> {
  try {
    const pool = getPool();
    await pool.query(
      `INSERT INTO storage.objects (bucket_id, name, metadata) VALUES ($1, $2, $3::jsonb)`,
      [bucket, objectPath, JSON.stringify({ size, mimetype: mime })]
    );
  } catch {
    // метаданные некритичны — не валим upload
  }
}

async function handle(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { path: rawPath } = await ctx.params;
  const segments = (rawPath ?? []).map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  });

  try {
    // /storage/v1/object/public/{bucket}/{path...} | /storage/v1/object/{bucket}/{path...}
    if (segments[0]?.toLowerCase() !== "object") {
      return NextResponse.json({ code: "NOT_IMPLEMENTED", message: `Unsupported storage path: /${segments.join("/")}` }, { status: 501 });
    }
    const rest = segments.slice(1);
    const isPublicRead = rest[0]?.toLowerCase() === "public";
    const bucketAndPath = isPublicRead ? rest.slice(1) : rest;
    if (bucketAndPath.length < 2) {
      return NextResponse.json({ code: "BAD_PATH", message: "Expected /object/{bucket}/{path}" }, { status: 400 });
    }
    const bucket = bucketAndPath[0];
    const objectParts = bucketAndPath.slice(1);
    let objectPath: string;
    let absPath: string;
    try {
      objectPath = objectParts.join("/");
      absPath = path.join(UPLOAD_ROOT, safeJoin([bucket, ...objectParts]));
    } catch {
      return NextResponse.json({ code: "BAD_PATH", message: "Unsafe object path" }, { status: 400 });
    }

    if (req.method === "GET" || req.method === "HEAD") {
      if (!isPublicRead) {
        const claims = await resolveClaims(req);
        if (claims.role === "anon") {
          return NextResponse.json({ code: "UNAUTHORIZED", message: "Auth required for non-public objects" }, { status: 401 });
        }
      }
      const data = await fs.readFile(absPath);
      const ext = path.extname(absPath).toLowerCase();
      const mime = MIME[ext] || "application/octet-stream";
      return new NextResponse(isPublicRead || req.method === "GET" ? new Uint8Array(data) : null, {
        status: 200,
        headers: { "Content-Type": mime, "Content-Length": String(data.length), "Cache-Control": "public, max-age=3600" },
      });
    }

    if (req.method === "POST" || req.method === "PUT") {
      const claims = await resolveClaims(req);
      if (claims.role === "anon") {
        return NextResponse.json({ code: "UNAUTHORIZED", message: "Auth required to upload" }, { status: 401 });
      }
      const buf = Buffer.from(await req.arrayBuffer());
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      await fs.writeFile(absPath, buf);
      const ext = path.extname(absPath).toLowerCase();
      const mime = req.headers.get("content-type")?.split(";")[0] || MIME[ext] || "application/octet-stream";
      await objectRow(bucket, objectPath, buf.length, mime);
      return NextResponse.json({ Key: `${bucket}/${objectPath}`, Id: `${bucket}/${objectPath}`, path: objectPath, fullPath: `${bucket}/${objectPath}` }, { status: 200 });
    }

    if (req.method === "DELETE") {
      const claims = await resolveClaims(req);
      if (claims.role === "anon") {
        return NextResponse.json({ code: "UNAUTHORIZED", message: "Auth required to delete" }, { status: 401 });
      }
      try {
        await fs.unlink(absPath);
      } catch {
        /* уже нет — ок для идемпотентности */
      }
      return NextResponse.json([{ name: objectPath }], { status: 200 });
    }

    return NextResponse.json({ code: "METHOD_NOT_ALLOWED", message: `Method ${req.method} not supported` }, { status: 405 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "storage error";
    const status = message.includes("unsafe path") ? 400 : 500;
    return NextResponse.json({ code: "STORAGE_ERROR", message }, { status });
  }
}

export const GET = handle;
export const HEAD = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
