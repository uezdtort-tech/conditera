/**
 * email-sanitize.ts — санитизация HTML-тел входящих писем (P0-1 / R1).
 *
 * Проблема (ENGINEERING_RISKS.md R1): внешние провайдеры (Mailgun/SendGrid/
 * Postmark Inbound Parse) передают произвольный HTML произвольного отправителя.
 * Раньше он сохранялся в БД и рендерился в админке через
 * dangerouslySetInnerHTML без санитизации — stored XSS: inline-обработчики
 * (`<img src=x onerror=…>`, `<svg onload=…>`), `javascript:`-URL, активное
 * содержимое (iframe/object/embed/form). CSP страницы содержит `unsafe-inline`
 * и не блокирует inline-обработчики.
 *
 * Решение: изomorphic-dompurify (проверенная санитизация, OWASP-рекомендация)
 * с ОГРАНИЧИТЕЛЬНОЙ конфигурацией:
 *   • whitelist тегов — только форматирование/структура письма;
 *   • whitelist атрибутов — безопасное подмножество (стили/ссылки/таблицы);
 *   • запрещены все data-атрибуты и event-handlers (DOMPurify снимает
 *     on*-атрибуты по умолчанию — фиксируем явно для читаемости);
 *   • URI-схемы: http(s), mailto, tel; data: только для изображений;
 *     javascript:/vbscript: запрещены;
 *   • ссылкам принудительно target="_blank" rel="noopener noreferrer nofollow"
 *     (hook) — чтобы открытие письма не могло навигировать админ-вкладку.
 *
 * Применяется В ДВУХ точках (defence in depth):
 *   1. Серверная граница: /api/email/inbound — санитизация ПЕРЕД записью в БД
 *      (новые письма попадают в БД уже чистыми);
 *   2. Клиент: admin-email-tab — санитизация ПЕРЕД dangerouslySetInnerHTML
 *      (защита от легаси-строк в БД, записанных до фикса).
 *
 * isomorphic-dompurify работает и в Node (jsdom), и в браузере — один модуль
 * для обеих точек.
 */
import DOMPurify from "isomorphic-dompurify";

/** Whitelist тегов: структура и форматирование письма, без активного содержимого. */
const ALLOWED_TAGS = [
  // структура
  "p", "div", "span", "br", "hr", "blockquote", "pre",
  // текст
  "b", "strong", "i", "em", "u", "s", "strike", "sub", "sup", "small",
  "mark", "abbr", "code", "kbd",
  // заголовки
  "h1", "h2", "h3", "h4", "h5", "h6",
  // списки
  "ul", "ol", "li", "dl", "dt", "dd",
  // таблицы
  "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "col", "colgroup",
  // ссылки и медиа
  "a", "img", "picture", "source", "figure", "figcaption",
  // прочее безопасное
  "font", "center",
];

/** Whitelist атрибутов: без on*-обработчиков и data-* (DOMPurify бы снял их и так).
 *  `style` НЕ в whitelist (ограничительная конфигурация): DOMPurify не парсит CSS
 *  глубоко — expression()/url(javascript:) могли бы выжить в inline-стилях;
 *  без style письмо рендерится структурой/текстом — безопасно и читаемо. */
const ALLOWED_ATTR = [
  "href", "src", "srcset", "alt", "title", "width", "height",
  "class", "id", "name", "dir", "lang",
  "colspan", "rowspan", "align", "valign", "bgcolor", "border", "cellpadding",
  "cellspacing", "target", "rel", "loading",
];

/**
 * Разрешённые URI-схемы для URL-атрибутов:
 *   • http(s), mailto, tel — обычные ссылки;
 *   • data:image/ — только изображения (data:text/html и прочий data: — запрет);
 *   • относительные URL (не начинаются с буквы-схемы) — сохраняются.
 * javascript:, vbscript:, file:, blob:, data:text/html — запрещены.
 */
const ALLOWED_URI_RE =
  /^(?:(?:https?|mailto|tel):|data:image\/|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

/** Hook добавляется один раз на бандл (сервер/клиент — разные бандлы). */
let hookInstalled = false;

function installLinksHook(): void {
  if (hookInstalled) return;
  hookInstalled = true;
  // Внешним ссылкам — target=_blank + rel=noopener noreferrer nofollow:
  // открытие письма не может навигировать админ-вкладку и не передаёт window.opener.
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (!node || (node as Element).tagName?.toLowerCase() !== "a") return;
    const el = node as Element;
    if (!el.getAttribute("href")) return;
    el.setAttribute("target", "_blank");
    el.setAttribute("rel", "noopener noreferrer nofollow");
  });
}

/**
 * Санитизировать HTML-тело письма. Возвращает безопасный HTML-фрагмент
 * (без <html>/<body> — только содержимое). Пустой/непарсируемый вход → "".
 */
export function sanitizeEmailHtml(html: string): string {
  if (!html || typeof html !== "string") return "";

  installLinksHook();

  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: true,
    ALLOWED_URI_REGEXP: ALLOWED_URI_RE,
    // Обрезаем до фрагмента: отбрасываем <script>/<style>/комментарии
    // (входят в FORBID по умолчанию, здесь фиксируем поведение явно)
    KEEP_CONTENT: true,
    // Возврат строки вместо TrustedHTML
    RETURN_TRUSTED_TYPE: false,
  });

  return clean;
}

/**
 * Проверить, остались ли в HTML потенциально опасные элементы
 * (для тестов и диагностики, не для рантайм-решений).
 */
export function containsUnsafeHtml(html: string): boolean {
  if (!html) return false;
  const patterns = [
    /<script/i,
    /\son\w+\s*=/i, // inline-обработчики (onclick/onerror/onload/…)
    /javascript\s*:/i,
    /vbscript\s*:/i,
    /<iframe/i,
    /<object/i,
    /<embed/i,
    /<form/i,
    /<meta/i,
    /<link/i,
    /<base/i,
    /data:text\/html/i,
    /srcdoc\s*=/i,
  ];
  return patterns.some((re) => re.test(html));
}
