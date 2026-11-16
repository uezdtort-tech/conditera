/**
 * Тесты email-sanitize.ts — P0-1/R1 stored-XSS во входящих письмах.
 *
 * Контракт: sanitizeEmailHtml() на malicious-фикстурах (inline event handlers,
 * javascript:-URL, SVG, iframe/form/object, data:text/html) возвращает
 * HTML БЕЗ исполняемого содержимого, сохраняя безопасное форматирование.
 * Тесты гоняются в Node (jsdom через isomorphic-dompurify) — та же точка,
 * где санитизируется /api/email/inbound.
 */
import { describe, it, expect } from "vitest";
import {
  sanitizeEmailHtml,
  containsUnsafeHtml,
} from "./email-sanitize";

describe("sanitizeEmailHtml — malicious-фикстуры (R1/P0-1)", () => {
  it("inline event handlers удаляются (onerror/onload/onclick)", () => {
    const malicious = [
      '<img src="x" onerror="alert(1)">',
      '<body onload="steal()"><p>hi</p></body>',
      '<div onclick="document.location=\'https://evil\'">клик</div>',
      '<svg onload="alert(1)"><circle r="5"/></svg>',
      '<a href="#" onmouseover="alert(1)">ссылка</a>',
      '<video><source onerror="alert(1)"></video>',
    ];
    for (const html of malicious) {
      const out = sanitizeEmailHtml(html);
      expect(out, `input: ${html}`).not.toMatch(/\son\w+\s*=/i);
      expect(out).not.toMatch(/alert\(|steal\(|evil/);
      expect(containsUnsafeHtml(out)).toBe(false);
    }
  });

  it("script-теги и их содержимое удаляются", () => {
    const out = sanitizeEmailHtml(
      '<p>до</p><script>alert(document.cookie)</script><p>после</p>'
    );
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/alert\(document\.cookie\)/);
    expect(out).toContain("до");
    expect(out).toContain("после");
  });

  it("javascript:/vbscript:/data:text/html URL запрещены", () => {
    const malicious = [
      '<a href="javascript:alert(1)">x</a>',
      '<a href="JaVaScRiPt:alert(1)">x</a>',
      '<img src="javascript:alert(1)">',
      '<a href="vbscript:msgbox(1)">x</a>',
      '<iframe src="data:text/html,<script>alert(1)</script>"></iframe>',
      '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>',
    ];
    for (const html of malicious) {
      const out = sanitizeEmailHtml(html);
      expect(out, `input: ${html}`).not.toMatch(/javascript\s*:/i);
      expect(out).not.toMatch(/vbscript\s*:/i);
      expect(out).not.toMatch(/data:text\/html/i);
    }
  });

  it("активное содержимое (iframe/object/embed/form/base/meta/link) удаляется", () => {
    const malicious =
      '<iframe src="https://evil.example"></iframe>' +
      '<object data="https://evil.example"></object>' +
      '<embed src="https://evil.example.swf">' +
      '<form action="https://evil.example"><input type="password"></form>' +
      '<base href="https://evil.example/">' +
      '<meta http-equiv="refresh" content="0;url=https://evil.example">' +
      '<link rel="stylesheet" href="https://evil.example/x.css">';
    const out = sanitizeEmailHtml(malicious);
    expect(out).not.toMatch(/<(iframe|object|embed|form|base|meta|link)\b/i);
    expect(out).not.toMatch(/evil\.example/);
  });

  it("SVG без обработчиков: onload снят, содержимое нейтрализовано", () => {
    const out = sanitizeEmailHtml(
      '<svg onload="alert(1)" xmlns="http://www.w3.org/2000/svg"><script>alert(2)</script><circle r="4"/></svg>'
    );
    expect(out).not.toMatch(/\son\w+\s*=/i);
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/alert\(/);
  });

  it("srcdoc-атрибут запрещён", () => {
    const out = sanitizeEmailHtml(
      '<iframe srcdoc="<script>alert(1)</script>"></iframe>'
    );
    expect(out).not.toMatch(/srcdoc/i);
    expect(out).not.toMatch(/<iframe/i);
  });

  it("CSS expression / style с url(javascript:) нейтрализован", () => {
    const out = sanitizeEmailHtml(
      '<div style="width: expression(alert(1)); background:url(javascript:alert(2))">x</div>'
    );
    expect(out).not.toMatch(/expression\s*\(/i);
    expect(out).not.toMatch(/javascript\s*:/i);
  });
});

describe("sanitizeEmailHtml — сохранение легитимной вёрстки", () => {
  it("безопасное форматирование сохраняется (текст, ссылки, таблицы)", () => {
    const legit =
      "<h1>Заказ №123</h1>" +
      '<p>Здравствуйте, <b>Анна</b>! Ваш заказ <a href="https://conditera.ru/orders/123">готов к отслеживанию</a>.</p>' +
      "<table><tr><td>Торт</td><td>1 шт.</td></tr></table>" +
      "<ul><li>Пункт 1</li><li>Пункт 2</li></ul>";
    const out = sanitizeEmailHtml(legit);
    expect(out).toContain("<h1>Заказ №123</h1>");
    expect(out).toContain("<b>Анна</b>");
    expect(out).toContain('href="https://conditera.ru/orders/123"');
    expect(out).toContain("<table>");
    expect(out).toContain("<li>Пункт 1</li>");
    expect(containsUnsafeHtml(out)).toBe(false);
  });

  it("mailto: и tel: ссылки сохраняются", () => {
    const out = sanitizeEmailHtml(
      '<a href="mailto:support@conditera.ru">Написать</a> <a href="tel:+79990000000">Позвонить</a>'
    );
    expect(out).toContain("mailto:support@conditera.ru");
    expect(out).toContain("tel:+79990000000");
  });

  it("data:image сохраняется (inline-картинки писем)", () => {
    const out = sanitizeEmailHtml(
      '<img src="data:image/png;base64,iVBORw0KGgo=" alt="лого">'
    );
    expect(out).toContain("data:image/png");
  });

  it("ссылкам добавляются rel=noopener noreferrer nofollow", () => {
    const out = sanitizeEmailHtml(
      '<a href="https://example.com">внешняя</a>'
    );
    expect(out).toMatch(/rel="[^"]*noopener[^"]*"/);
    expect(out).toMatch(/rel="[^"]*noreferrer[^"]*"/);
  });

  it("пустой/непарсируемый вход → пустая строка", () => {
    expect(sanitizeEmailHtml("")).toBe("");
    expect(sanitizeEmailHtml(null as unknown as string)).toBe("");
    expect(sanitizeEmailHtml(undefined as unknown as string)).toBe("");
  });

  it("простой текст без HTML проходит как есть", () => {
    const out = sanitizeEmailHtml("Просто текст письма, без тегов");
    expect(out).toContain("Просто текст письма, без тегов");
  });
});

describe("containsUnsafeHtml — детектор (для тестов/диагностики)", () => {
  it("находит опасные паттерны", () => {
    expect(containsUnsafeHtml('<img src=x onerror="a()">')).toBe(true);
    expect(containsUnsafeHtml('<script>a()</script>')).toBe(true);
    expect(containsUnsafeHtml('<a href="javascript:a()">x</a>')).toBe(true);
    expect(containsUnsafeHtml("<iframe></iframe>")).toBe(true);
    expect(containsUnsafeHtml("<form></form>")).toBe(true);
  });

  it("не помечает безопасный HTML", () => {
    expect(containsUnsafeHtml("<p>Привет <b>мир</b></p>")).toBe(false);
    expect(containsUnsafeHtml('<a href="https://ok.ru">ok</a>')).toBe(false);
  });
});
