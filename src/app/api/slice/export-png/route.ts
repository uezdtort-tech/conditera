/**
 * POST /api/slice/export-png
 *
 * Конвертирует SVG-строку в PNG через headless Chromium (Playwright).
 * Используется для маркетинговых материалов: скачивание PNG среза торта,
 * генерация изображений для соцсетей, каталога, печати.
 *
 * Тело: { svg: string, width?: number, height?: number, scale?: number }
 * Возвращает: image/png (binary)
 *
 * Альтернатива для клиента: canvas.toDataURL() — но это требует рендеринга
 * в браузере, что не подходит для серверной генерации.
 */
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const { svg, width = 600, height = 600, scale = 2 } = await request.json();

    if (!svg || typeof svg !== "string") {
      return NextResponse.json({ error: "svg обязательна" }, { status: 400 });
    }

    if (!svg.includes("<svg") || !svg.includes("</svg>")) {
      return NextResponse.json({ error: "Невалидный SVG" }, { status: 400 });
    }

    // Безопасность: проверяем размер SVG (защита от DoS)
    if (svg.length > 100_000) {
      return NextResponse.json({ error: "SVG слишком большой (макс 100 КБ)" }, { status: 400 });
    }

    // Пробуем Playwright (через dynamic import — если не установлен, упадёт в catch)
    try {
      let chromium: any;
      try {
        const playwright = await import("playwright");
        chromium = playwright.chromium;
      } catch (importErr) {
        throw new Error("playwright не установлен");
      }

      const browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({
        viewport: { width, height },
        deviceScaleFactor: scale,
      });
      const page = await context.newPage();

      // Устанавливаем SVG как содержимое страницы
      const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { margin: 0; padding: 0; background: transparent; }
    svg { display: block; width: ${width}px; height: ${height}px; }
  </style>
</head>
<body>
${svg}
</body>
</html>`;

      await page.setContent(html, { waitUntil: "networkidle" });
      // Небольшая задержка для рендера
      await page.waitForTimeout(100);

      const pngBuffer = await page.screenshot({
        type: "png",
        omitBackground: true,
        clip: { x: 0, y: 0, width, height },
      });

      await browser.close();

      return new NextResponse(pngBuffer, {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Content-Disposition": `attachment; filename="cake-slice-${Date.now()}.png"`,
          "Cache-Control": "no-cache",
        },
      });
    } catch (playwrightErr: any) {
      console.warn("[export-png] Playwright failed:", playwrightErr?.message);

      // Fallback: если Playwright недоступен, возвращаем SVG с инструкцией
      // (клиент может использовать canvas в браузере)
      return NextResponse.json({
        error: "Серверный рендеринг недоступен (Playwright не установлен)",
        fallback: "client",
        svg,
        instructions: "Используйте canvas.toDataURL() в браузере для конвертации",
      }, { status: 501 });
    }
  } catch (error) {
    console.error("[export-png] error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// GET — для проверки доступности endpoint
export async function GET() {
  return NextResponse.json({
    endpoint: "/api/slice/export-png",
    method: "POST",
    body: { svg: "string", width: "number?", height: "number?", scale: "number?" },
    returns: "image/png (binary) или { error, fallback: 'client', svg } если Playwright недоступен",
  });
}
