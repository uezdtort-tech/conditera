/**
 * secrets-meta.ts — ЧИСТАЯ логика secrets-scan (Task ZV31-011, Z-v32 Пакет B1).
 *
 * Разделение слоёв:
 *   • этот модуль — только паттерны/классификация/allowlist-семантика,
 *     без node:fs и без side-effects → импортируется и из node-скрипта
 *     (scripts/regression/secrets-scan.mjs — Node ≥22.18 strip-types),
 *     и из vitest (src/lib/regression/secrets-scan.test.ts);
 *   • scripts/regression/secrets-scan.mjs — CLI-обёртка: выбор файлов
 *     (git diff + фикс-набор конфигов), binary/size-гварты, allowlist-файл,
 *     вывод и exit-коды.
 *
 * Инвариант (ZV31-011): наружу НИКОГДА не возвращается само значение
 * секрета — только категория и длина совпадения (см. LineMatch).
 * Контент-детект ВСЕВЕСТНО (не только .env-файлы): структурные паттерны
 * (PEM/AWS/GitHub/OpenAI/Telegram/JWT/Slack/Google/payment) работают в
 * любом тексте; generic key=value — с placeholder-фильтром.
 */

/** Категория находки (для вывода `{file}:{line} [CATEGORY] ...`). */
export type SecretCategory = string;

/**
 * Определение паттерна. re БЕЗ флага g: scanLineForSecrets создаёт свежий
 * RegExp с g на каждый вызов (устойчивость к lastIndex-глобальному стейту).
 * captureGroup: индекс capture-группы со «значением» (0 = всё совпадение).
 */
export interface SecretPatternDef {
  category: SecretCategory;
  re: RegExp;
  captureGroup: number;
  /**
   * Применять placeholder-фильтр (isPlaceholderValue) к найденному значению.
   * Структурные токены (JWT/AWS/...) — false: их форма сама по себе
   * доказательна; generic/url-категории — true (dev-плейсхолдеры легальны).
   */
  placeholderFiltered: boolean;
}

/** Находка в одной строке: БЕЗ значения секрета — только длина. */
export interface LineMatch {
  category: SecretCategory;
  /** Длина найденного секретного значения (символов). */
  valueLength: number;
  /** Индекс начала совпадения в строке (для дедупликации/отладки). */
  start: number;
}

/** Элемент allowlist: {path, line, reason}; line = 0 означает «весь файл». */
export interface SecretAllowlistEntry {
  path: string;
  /** 1-based номер строки; 0 — весь файл. */
  line: number;
  reason: string;
}

// ===== Паттерны =====

/** Универсальные placeholder-подстроки (case-insensitive) для generic-значений. */
export const PLACEHOLDER_TOKENS: readonly string[] = [
  "example",
  "changeme",
  "change_me",
  "change-me",
  "your_",
  "your-",
  "<",
  ">",
  "${",
  "{{",
  "placeholder",
  "test",
  "demo",
  "sample",
  "xxx",
  "dummy",
  "local",
  "localhost",
  "postgres",
  "5678",
  "54329",
  "file:",
  "echo",
  "openssl",
  "rand",
  "chars",
  "dev_",
  "dev-",
  "conditera",
  "strong_password",
  "strong-pass",
  "strongpass",
];

/**
 * Generic key=value: словарь ключей (спека ZV31-011 + расширения
 * master/signing/encryption/access key + множественное число) + значение
 * ≥12 символов без пробелов/кавычек/скобок/$ (чтобы ${VAR}-интерполяция
 * compose и кодовые вызовы не совпадали вовсе).
 *
 * Вместо \b ПЕРЕД ключом — lookbehind (?<![A-Za-z0-9]): ключи env-файлов
 * почти всегда с подчёркиванием (AWS_SECRET, MEILI_MASTER_KEY), а \b между
 * "_" и буквой не срабатывает (underscore — word char). Lookbehind при
 * этом всё ещё блокирует «monkey»/«tokenize» (ключ внутри слова).
 */
const GENERIC_SECRET_RE =
  /(?<![A-Za-z0-9])(?:api[_-]?keys?|apikeys?|client[_-]?secrets?|private[_-]?keys?|master[_-]?keys?|signing[_-]?keys?|encryption[_-]?keys?|access[_-]?keys?|auth[_-]?tokens?|authorization|credentials?|secrets?|tokens?|passwords?|passwd|pwd)\b[ \t]*[=:][ \t]*["'`]?([^\s"'`;(),{}\[\]<>$]{12,})/gi;

/**
 * URL с паролем в authority (scheme://user:pass@host) — DATABASE_URL-стиль.
 * Пароль ≥8 символов до @; дальнейшие фильтры: strength + placeholder.
 */
const URL_CREDENTIALS_RE =
  /\b[a-z][a-z0-9+.-]{1,31}:\/\/[^\s/:@]{1,64}:([^\s/@]{8,})@/gi;

/**
 * Каталог паттернов. Порядок не значим (все паттерны применяются к строке);
 * структурные паттерны не проходят placeholder-фильтр.
 */
export const SECRET_PATTERNS: readonly SecretPatternDef[] = [
  {
    category: "pem-private-key",
    re: /-----BEGIN[ \tA-Z0-9]*PRIVATE KEY[ \tA-Z0-9]*-----/i,
    captureGroup: 0,
    placeholderFiltered: false,
  },
  {
    // {16,}\b (а не ровно {16}\b): ключ, вклеенный в более длинный
    // алфавитно-цифровой run, иначе не проходит граничную проверку \b.
    category: "aws-access-key",
    re: /\bAKIA[0-9A-Z]{16,}\b/,
    captureGroup: 0,
    placeholderFiltered: false,
  },
  {
    category: "github-token",
    re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
    captureGroup: 0,
    placeholderFiltered: false,
  },
  {
    category: "openai-key",
    re: /\bsk-[A-Za-z0-9]{20,}\b/,
    captureGroup: 0,
    placeholderFiltered: false,
  },
  {
    category: "slack-token",
    re: /\bxox[bp]-[A-Za-z0-9-]{10,}\b/,
    captureGroup: 0,
    placeholderFiltered: false,
  },
  {
    category: "google-api-key",
    // {35,}\b: Google-ключ — ровно AIza+35, но хвост-ран длиннее не должен
    // ломать граничную проверку (см. aws-access-key).
    re: /\bAIza[0-9A-Za-z_-]{35,}\b/,
    captureGroup: 0,
    placeholderFiltered: false,
  },
  {
    category: "telegram-bot-token",
    re: /\b\d{8,10}:AA[A-Za-z0-9_-]{30,}/,
    captureGroup: 0,
    placeholderFiltered: false,
  },
  {
    category: "jwt",
    re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/,
    captureGroup: 0,
    placeholderFiltered: false,
  },
  {
    // YooKassa shop secret (live_/test_ + ≥20 base62) и Stripe-стиль
    // (sk|pk|rk)_(live|test)_ + ≥16. Часть после префикса — без "_",
    // чтобы не ловить test_-именованные идентификаторы кода.
    category: "payment-provider-token",
    re: /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b|\b(?:live|test)_[A-Za-z0-9]{20,}\b/,
    captureGroup: 0,
    placeholderFiltered: false,
  },
  {
    category: "generic-secret",
    re: GENERIC_SECRET_RE,
    captureGroup: 1,
    placeholderFiltered: true,
  },
  {
    category: "url-credentials",
    re: URL_CREDENTIALS_RE,
    captureGroup: 1,
    placeholderFiltered: true,
  },
];

// ===== Placeholder-логика =====

/**
 * isExampleEnvPath(path) — является ли путь .env*-example шаблоном
 * (.env.production.example, .env.local.example, *.example). Для таких
 * файлов «secret»/«changeme» как literal-значение — легальный placeholder.
 */
export function isExampleEnvPath(path: string): boolean {
  const p = String(path ?? "").replace(/\\/g, "/");
  return /(^|\/)\.env[^/]*example$/i.test(p) || /(^|\/)[^/]*\.example$/i.test(p);
}

/**
 * isPlaceholderValue(value, isExampleFile) — значение generic-секрета
 * является легальным dev-плейсхолдером (не утечка).
 *
 * Правила: подстроки из PLACEHOLDER_TOKENS (case-insensitive); литерал
 * «conditera» — известный dev-дефолт (IP_HASH_SALT || "conditera");
 * «secret»/«changeme» целиком — только в .env*-example шаблонах.
 */
export function isPlaceholderValue(value: string, isExampleFile: boolean): boolean {
  const v = String(value ?? "").toLowerCase();
  if (!v) return true;
  if (v === "conditera") return true;
  if (isExampleFile && (v === "secret" || v === "changeme")) return true;
  for (const token of PLACEHOLDER_TOKENS) {
    if (v.includes(token)) return true;
  }
  return false;
}

/**
 * Цепочка свойств/идентификаторов кода (form.password, env.JWT_SECRET) —
 * не литеральный секрет.
 */
const CODE_VALUE_CHAIN_RE = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z0-9_$]+)+$/;

/**
 * hasSecretStrength(value) — эвристика «похоже на настоящий секрет»:
 * есть цифра ИЛИ не-буквенный символ ИЛИ длина ≥20. Отсекает кодовые
 * значения вида getAuthToken / formValues.secret (чистые буквы 12–19).
 */
export function hasSecretStrength(value: string): boolean {
  if (value.length >= 20) return true;
  if (/[0-9]/.test(value)) return true;
  return /[^A-Za-z0-9]/.test(value);
}

/**
 * isLikelyCodeValue(value, line, matchEnd) — значение выглядит кодом,
 * а не литералом: вызов функции сразу после совпадения (`token = getX()`)
 * или цепочка свойств без цифр (`password: form.password`).
 */
function isLikelyCodeValue(value: string, line: string, matchEnd: number): boolean {
  if (line.charAt(matchEnd) === "(") return true;
  if (!/[0-9]/.test(value) && CODE_VALUE_CHAIN_RE.test(value)) return true;
  return false;
}

// ===== Ядро сканирования =====

/**
 * scanLineForSecrets(line, opts) — применить все паттерны к одной строке.
 * Возвращает уникальные находки (category+start), НИКОГДА не включает
 * само значение — только valueLength (redaction by design).
 *
 * @param line — текст одной строки файла.
 * @param opts.isExampleFile — .env*-example шаблон (смягчение плейсхолдеров).
 */
export function scanLineForSecrets(
  line: string,
  opts: { isExampleFile?: boolean } = {}
): LineMatch[] {
  const text = String(line ?? "");
  if (!text) return [];
  const isExampleFile = opts.isExampleFile === true;
  const matches: LineMatch[] = [];
  const seen = new Set<string>();

  for (const def of SECRET_PATTERNS) {
    const re = new RegExp(def.re.source, def.re.flags.includes("g") ? def.re.flags : `${def.re.flags}g`);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex += 1; // защита от нулевого совпадения (бесконечный цикл)
        continue;
      }
      const rawValue = m[def.captureGroup] ?? m[0];
      if (def.placeholderFiltered) {
        if (isPlaceholderValue(rawValue, isExampleFile)) continue;
        if (!hasSecretStrength(rawValue)) continue;
        if (isLikelyCodeValue(rawValue, text, m.index + m[0].length)) continue;
        // Совпадение внутри ${...}-интерполяции (docker-compose
        // `${VAR:?required}` / кодовые шаблоны) — это не литеральный секрет:
        // ключ в этом случае совпал ВНУТРИ ${VAR}-имени.
        const prefix = text.slice(0, m.index);
        if (prefix.lastIndexOf("${") > prefix.lastIndexOf("}")) continue;
      }
      const key = `${def.category}@${m.index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push({
        category: def.category,
        valueLength: rawValue.length,
        start: m.index,
      });
    }
  }
  return matches;
}

// ===== Allowlist =====

/** Нормализовать путь к POSIX-виду для сравнения с allowlist. */
export function normalizeSecretPath(path: string): string {
  return String(path ?? "").replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * isAllowlisted(path, line, allowlist) — подавляется ли находка
 * path+line комбинацией (line=0 в элементе allowlist = весь файл).
 */
export function isAllowlisted(
  path: string,
  line: number,
  allowlist: readonly SecretAllowlistEntry[]
): boolean {
  const p = normalizeSecretPath(path);
  const n = Number(line) || 0;
  return (allowlist ?? []).some(
    (e) =>
      normalizeSecretPath(e?.path ?? "") === p &&
      (Number(e?.line) === 0 || Number(e?.line) === n)
  );
}
