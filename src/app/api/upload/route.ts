/**
 * POST /api/upload — универсальная загрузка одного файла (совместимость).
 *
 * ТЗ P0.5 §3: endpoint отсутствовал, но реально вызывался фронтендом
 * (confectioner-atelier-tab: category=portfolio, confectioner-lessons-tab:
 * category=recipe) — обеспечена совместимость, вызовы не мигрировали.
 *
 * multipart/form-data: file (обяз.), ownerType?, category?
 * Ответ: { url }
 * Auth: любой аутентифицированный.
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { saveUploadedFile, UploadServiceError } from "@/lib/upload-service";

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

    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "NO_FILE", message: "Не передан файл (поле 'file')" },
        { status: 400 }
      );
    }

    const category = String(form.get("category") ?? "misc");
    const ownerType = String(form.get("ownerType") ?? "");

    try {
      // каталог: <ownerType>/<category> для изоляции по типу владельца
      const url = await saveUploadedFile(
        file,
        ownerType ? `${ownerType}/${category}` : category
      );
      return NextResponse.json({ url }, { status: 201 });
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
    console.error("[upload] POST failed:", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: "INTERNAL", message: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
