/**
 * src/lib/regression/secrets-scan.test.ts — unit-тесты чистой логики
 * secrets-сканера (ZV31-011, Z-v32 Пакет B1).
 *
 * Проверяются: детект структурных токенов (PEM/AWS/GitHub/OpenAI/Telegram/
 * JWT/Slack/Google/YooKassa), generic key=value с placeholder-фильтром,
 * url-credentials, REDACTION (значение секрета НИКОГДА не возвращается —
 * только категория и длина), allowlist-семантика {path, line=0|N}.
 *
 * Все «секреты» в этом файле — сфабрикованные safe-fixture для тестов
 * сканера (см. scripts/regression/secrets-allowlist.json).
 */
import { describe, expect, it } from "vitest";

// Синтетические токены собираются из частей во время выполнения: грубый
// source-grep CI не должен путать тестовые фикстуры с реальными секретами.
const fixture = (...parts: string[]) => parts.join("");

import {
  isAllowlisted,
  isExampleEnvPath,
  isPlaceholderValue,
  hasSecretStrength,
  isTestFixturePath,
  isTemplatePlaceholderValue,
  scanLineForSecrets,
} from "./secrets-meta";

const categories = (line: string, opts?: { isExampleFile?: boolean }) =>
  scanLineForSecrets(line, opts).map((m) => m.category);

describe("scanLineForSecrets — структурные токены", () => {
  it("PEM-заголовок приватного ключа", () => {
    expect(
      categories("crypto material -----BEGIN RSA PRIVATE KEY----- trailing")
    ).toContain("pem-private-key");
    expect(
      categories("-----BEGIN OPENSSH PRIVATE KEY-----b3BlbnNzaC1rZXk")
    ).toContain("pem-private-key");
  });

  it("AWS access key (AKIA + 18)", () => {
    const matches = scanLineForSecrets(fixture("AKIA", "IOSFODNN7", "EXAMPLE"));
    expect(matches.map((m) => m.category)).toEqual(["aws-access-key"]);
    expect(matches[0].valueLength).toBe(20);
  });

  it("GitHub token (ghp_)", () => {
    expect(categories(fixture("ghp_", "0123456789", "abcdefghijklmnopqrstuvwxyz"))).toEqual([
      "github-token",
    ]);
  });

  it("OpenAI-стиль ключ (sk- + 20)", () => {
    expect(categories("sk-fake0000000000000000000")).toEqual(["openai-key"]);
  });

  it("Telegram bot token (\\d+:AA...)", () => {
    expect(
      categories("1234567890:AAabcdefghijklmnopqrstuvwxyz0123456789AB")
    ).toEqual(["telegram-bot-token"]);
  });

  it("JWT (eyJ...eyJ...sig)", () => {
    expect(
      categories(
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
      )
    ).toEqual(["jwt"]);
  });

  it("Slack token (xoxb-)", () => {
    expect(categories("xoxb-123456789012-abcdefghijklmnopqrstuvwx")).toEqual([
      "slack-token",
    ]);
  });

  it("Google API key (AIza + 35)", () => {
    expect(
      categories("AIza0123456789abcdefghijklmnopqrstuvwzyz0123456")
    ).toEqual(["google-api-key"]);
  });

  it("YooKassa/Stripe-стиль токен (live_ + 20)", () => {
    expect(
      categories("live_0123456789abcdefghijklmnopqrstuv")
    ).toEqual(["payment-provider-token"]);
    expect(categories(fixture("sk_", "live_", "abcdefghijklmnopqrs"))).toEqual([
      "payment-provider-token",
    ]);
  });

  it("несколько паттернов на одной строке (generic + структурный)", () => {
    // UPPERCASE-значение: AWS-паттерн ([0-9A-Z]) требует верхний регистр,
    // и без placeholder-подстрок (например «example»/«5678») в значении.
    const cats = categories(fixture("AWS_SECRET=AKIA9F8E7", "D6C5B4A3F2E1D0C"));
    expect(cats).toContain("aws-access-key");
    expect(cats).toContain("generic-secret");
  });
});

describe("scanLineForSecrets — generic key=value", () => {
  it("детект: api-key с реалистичным значением", () => {
    const matches = scanLineForSecrets("API_KEY=SuperSecretProdValue123");
    expect(matches.map((m) => m.category)).toEqual(["generic-secret"]);
    expect(matches[0].valueLength).toBe("SuperSecretProdValue123".length);
  });

  it("детект: quoted-значение в YAML-стиле", () => {
    expect(categories('secret: "abcdefgh918273"')).toEqual([
      "generic-secret",
    ]);
  });

  it("детект: url-credentials (postgres://user:pass@host)", () => {
    expect(
      categories("postgres://admin:s3cretpw@127.0.0.1:5432/db")
    ).toEqual(["url-credentials"]);
  });

  it("плейсхолдеры НЕ детектятся: your_, change_me, ${}, <>, changeme, test/local", () => {
    expect(categories("JWT_SECRET=your_secret_here_change_me")).toEqual([]);
    expect(categories("API_KEY=${DOCKER_SECRET}")).toEqual([]);
    expect(categories("password=<your-password-here>")).toEqual([]);
    expect(categories("SECRET=changeme")).toEqual([]);
    expect(categories("TOKEN=dev_local_postgres_value")).toEqual([]);
    expect(
      categories("DATABASE_URL=postgresql://postgres:CHANGE_ME_STRONG_PASSWORD@db:5432/db")
    ).toEqual([]);
  });

  it(".env*-example смягчение: литеральные 'secret'/'changeme' — плейсхолдер", () => {
    expect(categories("PASSWORD=secret", { isExampleFile: true })).toEqual([]);
    expect(categories("PASSWORD=changeme", { isExampleFile: true })).toEqual([]);
    expect(categories("IP_HASH_SALT=conditera")).toEqual([]);
    // вне example-файла пустое "secret" значение детектится (правило применено только к example)
    expect(categories('secret: "abcdefgh918273"', { isExampleFile: true })).toEqual([
      "generic-secret",
    ]);
  });

  it("кодовые значения НЕ детектятся (вызов функции / chain)", () => {
    expect(categories("const token = getAuthToken();")).toEqual([]);
    expect(categories("const config = { apiKey: env.API_KEY_VALUE };")).toEqual([]);
  });

  it("слабые значения (12–19 чистых букв без цифр/спецсимволов) не дают шума", () => {
    expect(categories("TOKEN=abcdefghijklmnop")).toEqual([]);
  });
});

describe("redaction — значение секрета не возвращается", () => {
  const SECRET = fixture("ghp_", "0123456789", "abcdefghijklmnopqrstuvwxyz");

  it("результат содержит только {category, valueLength, start}", () => {
    const matches = scanLineForSecrets(`GITHUB_TOKEN=${SECRET}`);
    expect(matches.length).toBeGreaterThan(0);
    for (const m of matches) {
      expect(Object.keys(m).sort()).toEqual(["category", "start", "valueLength"]);
    }
  });

  it("JSON находки не содержит значения", () => {
    const matches = scanLineForSecrets(`GITHUB_TOKEN=${SECRET}`);
    expect(JSON.stringify(matches)).not.toContain(SECRET);
    expect(JSON.stringify(matches)).not.toContain("0123456789abcdef");
  });

  it("valueLength отражает длину значения, а не всей строки", () => {
    const matches = scanLineForSecrets(`GITHUB_TOKEN=${SECRET}`);
    const github = matches.find((m) => m.category === "github-token");
    expect(github?.valueLength).toBe(SECRET.length);
  });
});

describe("isPlaceholderValue / hasSecretStrength", () => {
  it("токены-плейсхолдеры распознаются", () => {
    expect(isPlaceholderValue("CHANGE_ME_24CHARS", false)).toBe(true);
    expect(isPlaceholderValue("dev_n8n_key_32_chars", false)).toBe(true);
    expect(isPlaceholderValue("conditera", false)).toBe(true);
    expect(isPlaceholderValue("secret", true)).toBe(true);
    expect(isPlaceholderValue("secret", false)).toBe(false);
  });

  it("реалистичное значение — не плейсхолдер", () => {
    expect(isPlaceholderValue("9f86d081884c7d65", false)).toBe(false);
  });

  it("strength: цифра/спецсимвол/длина ≥20", () => {
    expect(hasSecretStrength("abcdefgh918273")).toBe(true);
    expect(hasSecretStrength("abcdefgh_1234")).toBe(true);
    expect(hasSecretStrength("abcdefghijklmnopqrst")).toBe(true);
    expect(hasSecretStrength("getAuthToken")).toBe(false);
  });
});

describe("isAllowlisted — {path, line, reason}", () => {
  const allowlist = [
    { path: "src/lib/x.test.ts", line: 22, reason: "fixture" },
    { path: "src/lib/y.ts", line: 0, reason: "whole file (patterns source)" },
  ];

  it("точная пара path+line подавляется", () => {
    expect(isAllowlisted("src/lib/x.test.ts", 22, allowlist)).toBe(true);
    expect(isAllowlisted("src/lib/x.test.ts", 23, allowlist)).toBe(false);
  });

  it("line=0 подавляет весь файл", () => {
    expect(isAllowlisted("src/lib/y.ts", 1, allowlist)).toBe(true);
    expect(isAllowlisted("src/lib/y.ts", 999, allowlist)).toBe(true);
  });

  it("другой путь не подавляется; нормализация путей", () => {
    expect(isAllowlisted("src/lib/z.ts", 22, allowlist)).toBe(false);
    expect(isAllowlisted(".\\src\\lib\\x.test.ts", 22, allowlist)).toBe(true);
    expect(isAllowlisted("./src/lib/x.test.ts", 22, allowlist)).toBe(true);
  });

  it("сквозной сценарий: находка в allowlisted-строке пропускается сканером", () => {
    const line = fixture("AKIA", "IOSFODNN7", "EXAMPLE"); // fixture для теста сканера
    const matches = scanLineForSecrets(line);
    expect(matches.length).toBe(1);
    const suppressed = isAllowlisted("src/lib/x.test.ts", 22, allowlist);
    const reported = suppressed
      ? []
      : matches.map((m) => ({ line: 22, category: m.category }));
    expect(reported).toEqual([]);
  });
});

describe("isExampleEnvPath", () => {
  it("распознаёт .env*-example шаблоны", () => {
    expect(isExampleEnvPath(".env.production.example")).toBe(true);
    expect(isExampleEnvPath(".env.local.example")).toBe(true);
    expect(isExampleEnvPath("config/settings.example")).toBe(true);
    expect(isExampleEnvPath("src/app/page.tsx")).toBe(false);
    expect(isExampleEnvPath(".env.local")).toBe(false);
  });
});

// ===========================================================================
// ZV31-011 (Z-v32 Пакет B2): template-плейсхолдеры, test-fixture правило,
// JWT «не в известном шаблоне», isTestFixturePath.
// Все «секреты» ниже — сфабрикованные safe-fixture (слова fake/example/test).
// ===========================================================================

const DEMO_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.FAKEfakeFAKEfakeFAKEfakeFAKEfakeFAKEfake";

describe("scanLineForSecrets B2 — templateValues (значения из env-шаблонов)", () => {
  // Как в сканере: template-дефолты хранятся в lowercase (buildTemplatePlaceholderValues)
  const templates = [
    DEMO_JWT.toLowerCase(),
    "change_me_strong_password",
    "dev_jwt_secret_change_me_in_production_32chars",
  ];

  it("JWT, совпадающий с template-значением, подавляется", () => {
    const cats = scanLineForSecrets(`ANON_KEY=${DEMO_JWT}`, {
      templateValues: templates,
    }).map((m) => m.category);
    expect(cats).toEqual([]);
  });

  it("тот же JWT БЕЗ template-значений — находка (файл не известный шаблон)", () => {
    expect(scanLineForSecrets(`ANON_KEY=${DEMO_JWT}`).map((m) => m.category)).toEqual(["jwt"]);
  });

  it("другой JWT (не из шаблона) остаётся находкой даже с templateValues", () => {
    const otherJwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlLXVzZXItNDIifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const cats = scanLineForSecrets(`TOKEN=${otherJwt}`, {
      templateValues: templates,
    }).map((m) => m.category);
    expect(cats).toContain("jwt");
  });

  it("JWT в .env*-example подавляется (известный шаблон)", () => {
    expect(
      scanLineForSecrets(`ANON_KEY=${DEMO_JWT}`, { isExampleFile: true }).map((m) => m.category)
    ).toEqual([]);
  });

  it("generic-значение, точно совпавшее с template-дефолтом, подавляется", () => {
    expect(
      scanLineForSecrets("JWT_SECRET=dev_jwt_secret_change_me_in_production_32chars", {
        templateValues: templates,
      }).map((m) => m.category)
    ).toEqual([]);
  });

  it("isTemplatePlaceholderValue — точное совпадение, case-insensitive", () => {
    expect(isTemplatePlaceholderValue("CHANGE_ME_STRONG_PASSWORD", ["change_me_strong_password"])).toBe(true);
    expect(isTemplatePlaceholderValue("real-secret-9f86d081", ["change_me_strong_password"])).toBe(false);
    expect(isTemplatePlaceholderValue("anything", undefined)).toBe(false);
  });
});

describe("scanLineForSecrets B2 — test-fixture правило", () => {
  it("*.test.* файл: значение с fixture-токеном подавляется", () => {
    expect(
      scanLineForSecrets("API_KEY=fake0000000000000000", { isTestFixture: true }).map((m) => m.category)
    ).toEqual([]);
    // fabricated github-подобный токен со словом Fake — fixture-токен в значении
    expect(
      scanLineForSecrets(fixture("ghp_", "FakeFake", "FakeFake", "FakeFake", "1234"), { isTestFixture: true }).map(
        (m) => m.category
      )
    ).toEqual([]);
  });

  it("*.test.* файл: структурное значение БЕЗ fixture-токенов — НАХОДКА", () => {
    const cats = scanLineForSecrets(fixture("AKIA9F8E7", "D6C5B4A3F2E1D0C"), {
      isTestFixture: true,
    }).map((m) => m.category);
    expect(cats).toEqual(["aws-access-key"]);
  });

  it("__tests__/ путь распознаётся как fixture", () => {
    expect(isTestFixturePath("src/lib/__tests__/x.ts")).toBe(true);
    expect(isTestFixturePath("src/lib/x.test.ts")).toBe(true);
    expect(isTestFixturePath("src/lib/x.spec.tsx")).toBe(true);
    expect(isTestFixturePath("src/lib/x.ts")).toBe(false);
    expect(isTestFixturePath("src/lib/testing-utils.ts")).toBe(false);
  });

  it("вне тестового файла fixture-токены НЕ подавляют структурные находки", () => {
    // AKIAIOSFODNN7EXAMPLE — канонический AWS docs-пример, содержит EXAMPLE,
    // но вне тестового файла структурный паттерн срабатывает безусловно
    expect(scanLineForSecrets(fixture("AKIA", "IOSFODNN7", "EXAMPLE")).map((m) => m.category)).toEqual([
      "aws-access-key",
    ]);
  });
});
