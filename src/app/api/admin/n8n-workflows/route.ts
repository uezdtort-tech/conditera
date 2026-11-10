/**
 * GET /api/admin/n8n-workflows — отдаёт JSON n8n-воркфлоу из каталога
 * /n8n-workflows репозитория для скачивания из админ-панели.
 *
 * Ранее кнопка «Скачать JSON» в n8n-дашборде генерировала ПУСТОЙ workflow
 * (nodes: [], connections: {}) под именем реального файла — импорт такого
 * файла в n8n ломал воркфлоу. Теперь скачивается настоящий файл.
 *
 * Auth: ADMIN / SUPER_ADMIN (requireAnyRole).
 * Безопасность: имя файла валидируется по белому списку фактического
 * содержимого каталога (без path traversal — только имя, без разделителей).
 */
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";

export const runtime = "nodejs";

const WORKFLOWS_DIR = path.join(process.cwd(), "n8n-workflows");

function listWorkflowFiles(): string[] {
  try {
    return fs
      .readdirSync(WORKFLOWS_DIR)
      .filter((f) => f.endsWith(".json"))
      .sort();
  } catch {
    return [];
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  const guard = await requireAnyRole(user.id, ["ADMIN", "SUPER_ADMIN"]);
  if (guard) {
    return new NextResponse(guard.body, {
      status: guard.status,
      headers: guard.headers,
    });
  }

  const file = request.nextUrl.searchParams.get("file");

  // Без параметра — список доступных воркфлоу
  if (!file) {
    return NextResponse.json({ workflows: listWorkflowFiles() });
  }

  // Валидация имени: без разделителей пути, только белый список каталога
  if (
    file.includes("/") ||
    file.includes("\\") ||
    file.includes("..") ||
    !file.endsWith(".json")
  ) {
    return NextResponse.json({ error: "Недопустимое имя файла" }, { status: 400 });
  }

  if (!listWorkflowFiles().includes(file)) {
    return NextResponse.json({ error: "Файл не найден" }, { status: 404 });
  }

  try {
    const raw = fs.readFileSync(path.join(WORKFLOWS_DIR, file), "utf8");
    JSON.parse(raw); // гарантируем валидный JSON
    return new NextResponse(raw, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${file}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: unknown) {
    console.error("[admin/n8n-workflows] read failed:", (e as Error)?.message);
    return NextResponse.json({ error: "Ошибка чтения файла" }, { status: 500 });
  }
}
