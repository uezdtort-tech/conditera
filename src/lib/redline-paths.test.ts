/**
 * redline-paths.test.ts — Drift guard для красной зоны (v4.8).
 *
 * Контекст: за историю релиза 4 раза фиксировался ОДИН и тот же класс drift
 * (#8 v4.4, #10 v4.6, #11 v4.6-resume, #12 v4.7): оба upload-маршрута и их
 * тесты удалялись из рабочего дерева авто-процессами среды. Каждый раз
 * восстановление выполнялось точечно по патчу. Этот тест — структурная
 * регрессия: suite падает, если ЛЮБОЙ обязательный путь (1) удалён с диска
 * или (2) перестал отслеживаться Git (git rm --cached / удаление из индекса).
 *
 * Запрещено ослаблять/удалять этот тест без решения владельца:
 * он является частью red-line протокола (см. RELEASE-GATE-v4.6-REPORT.md §1,
 * RELEASE-GATE-v4.7-REPORT.md §1).
 */
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, it, expect } from "vitest";

/** Красная зона: эти пути не должны удаляться/отвязываться от Git. */
const MANDATORY_PATHS = [
  "src/app/api/upload/route.ts",
  "src/app/api/upload/route.test.ts",
  "src/app/api/services/upload/route.ts",
  "src/app/api/services/upload/route.test.ts",
] as const;

/** Найти корень репозитория (содержит .git) — от process.cwd() вверх. */
function findRepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    "Не найден корень репозитория (.git) от process.cwd()=" + process.cwd()
  );
}

/** Путь отслеживается Git? git ls-files --error-unmatch: exit 0 = tracked. */
function isTracked(repoRoot: string, relPath: string): boolean {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", relPath], {
      cwd: repoRoot,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

describe("red-line drift guard: обязательные пути upload-маршрутов (v4.8)", () => {
  const repoRoot = findRepoRoot();

  it.each(MANDATORY_PATHS)(
    "файл существует на диске: %s",
    (relPath) => {
      // Отдельная диагностика: если файла нет — падаем с точной причиной,
      // а не каскадом ошибок последующих проверок.
      expect(
        existsSync(path.join(repoRoot, relPath)),
        `ОБЯЗАТЕЛЬНЫЙ ПУТЬ УДАЛЁН С ДИСКА: ${relPath}. ` +
          `Известный класс drift (#8/#10/#11/#12). Восстановление — только ` +
          `точечное: git restore -- ${relPath} (патч дрейфа сохранить ДО).`
      ).toBe(true);
    }
  );

  it.each(MANDATORY_PATHS)(
    "файл отслеживается Git (index): %s",
    (relPath) => {
      expect(
        isTracked(repoRoot, relPath),
        `ОБЯЗАТЕЛЬНЫЙ ПУТЬ НЕ ОТСЛЕЖИВАЕТСЯ GIT: ${relPath}. ` +
          `Проверить git status; восстановить индекс точечно ` +
          `(git add -- ${relPath} при наличии файла, иначе git restore).`
      ).toBe(true);
    }
  );

  it("набор красной зоны полон (4 пути — защита от тихого сужения списка)", () => {
    // Если кто-то сократит MANDATORY_PATHS, тест напомнит о полном наборе.
    expect(MANDATORY_PATHS).toHaveLength(4);
  });
});
