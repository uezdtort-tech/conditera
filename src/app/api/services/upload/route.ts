/**
 * POST /api/services/upload — загрузка фотографий услуг (совместимость).
 *
 * ТЗ P0.5 §3: endpoint отсутствовал, но реально вызывался services-manager'ом
 * (FormData поле `files`, ожидается {urls: string[]}) — обеспечена совместимость.
 *
 * multipart/form-data: files (file[], 1..8)
 * Ответ: { urls: string[] }
 * Auth: любой аутентифицированный (свои услуги добавляют в своих маршрутах).
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import {
  saveUploadedFiles,
  UploadServiceError,
  MAX_UPLOAD_FILES,
} from "@/lib/upload-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json(
        { error: "UNAUTHORIZED", message: "Требуется аутентификация" },
        { status: 401 }
      );
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "Ожидается multipart/form-data" },
        { status: 400 }
      );
    }

    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    if (files.length === 0) {
      return NextResponse.json(
        { error: "NO_FILES", message: "Не передано файлов (поле 'files')" },
        { status: 400 }
      );
    }
    if (files.length > MAX_UPLOAD_FILES) {
      return NextResponse.json(
        { error: "TOO_MANY_FILES", message: `Максимум ${MAX_UPLOAD_FILES} файлов за запрос` },
        { status: 400 }
      );
    }

    try {
      const urls = await saveUploadedFiles(files, "services");
      return NextResponse.json({ urls }, { status: 201 });
    } catch (err) {
      if (err instanceof UploadServiceError) {
        return NextResponse.json(
          { error: err.code, message: err.message },
          { status: err.status }
        );
      }
      throw err;
    }
  } catch (err) {
    console.error("[services/upload] POST failed:", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: "INTERNAL", message: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
