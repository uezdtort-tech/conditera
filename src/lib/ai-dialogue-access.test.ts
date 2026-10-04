/**
 * pay4 IDOR-guard: негативные и позитивные тесты assertDialoguePairAccess.
 *
 * Прежде learn/respond/context принимали customerId/confectionerId из
 * body/query БЕЗ сверки с токеном (IDOR). Гвард должен:
 *   - пускать пользователя к СВОЕМУ customerId;
 *   - пускать кондитера к парам со СВОИМ confectionerId (обе конвенции id);
 *   - 403 на чужую пару (негативный сценарий подмены идентификатора);
 *   - 500 при ошибке БД (fail-closed, не leak содержимого);
 *   - 403 для не-кондитера, даже если confectionerId существует.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-helpers";

type ConfRow = { id: string; userId: string } | null;
type LookupResult = { data: ConfRow; error: { message: string } | null };

/** Результат поиска профиля кондитера ПО userId запрашивающего. */
const lookupByUserId = new Map<string, LookupResult>();
let fromCalls = 0;

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: vi.fn(() => {
      fromCalls++;
      return {
        select: vi.fn(() => ({
          eq: vi.fn((_col: string, userId: string) => ({
            maybeSingle: vi.fn(() =>
              Promise.resolve(
                lookupByUserId.get(userId) ?? { data: null, error: null }
              )
            ),
          })),
        })),
      };
    }),
  },
}));

import { assertDialoguePairAccess } from "@/lib/ai-dialogue-access";

const USER_A = "11111111-1111-1111-1111-111111111111";
const USER_B = "22222222-2222-2222-2222-222222222222";
const CONF_A_ID = "conf_a_cuid";
const CONF_B_ID = "conf_b_cuid";

describe("assertDialoguePairAccess (IDOR-guard ai-dialogue)", () => {
  beforeEach(() => {
    lookupByUserId.clear();
    fromCalls = 0;
  });

  it("покупатель к СВОЕМУ customerId — доступ без запроса к БД", async () => {
    await expect(
      assertDialoguePairAccess({ userId: USER_A }, USER_A, "conf_someone")
    ).resolves.toBeUndefined();
    expect(fromCalls).toBe(0);
  });

  it("кондитер к паре со СВОИМ confectioners.id (cuid) — доступ", async () => {
    lookupByUserId.set(USER_B, { data: { id: CONF_B_ID, userId: USER_B }, error: null });
    await expect(
      assertDialoguePairAccess({ userId: USER_B }, "customer_1", CONF_B_ID)
    ).resolves.toBeUndefined();
  });

  it("кондитер к паре со СВОИМ auth-UUID userId — доступ (вторая конвенция)", async () => {
    lookupByUserId.set(USER_B, { data: { id: CONF_B_ID, userId: USER_B }, error: null });
    await expect(
      assertDialoguePairAccess({ userId: USER_B }, "customer_1", USER_B)
    ).resolves.toBeUndefined();
  });

  it("НЕГАТИВНОЕ: пользователь A подменяет confectionerId чужого кондитера → 403", async () => {
    // Профиль кондитера B есть, но у запрашивающего A его НЕТ — owns=false
    lookupByUserId.set(USER_B, { data: { id: CONF_B_ID, userId: USER_B }, error: null });
    await expect(
      assertDialoguePairAccess({ userId: USER_A }, USER_B, CONF_B_ID)
    ).rejects.toMatchObject({ status: 403 } as Partial<HttpError>);
  });

  it("НЕГАТИВНОЕ: не-кондитер обращается к чужому customerId → 403 (профиль не найден)", async () => {
    // lookupByUserId пуст — профиль кондитера ни у кого не найден
    await expect(
      assertDialoguePairAccess({ userId: USER_A }, "customer_2", CONF_B_ID)
    ).rejects.toMatchObject({ status: 403 } as Partial<HttpError>);
  });

  it("НЕГАТИВНОЕ: несуществующий/некорректный confectionerId → 403", async () => {
    lookupByUserId.set(USER_A, { data: { id: CONF_A_ID, userId: USER_A }, error: null });
    await expect(
      assertDialoguePairAccess({ userId: USER_A }, USER_A + "x", "does-not-exist")
    ).rejects.toMatchObject({ status: 403 } as Partial<HttpError>);
  });

  it("FAIL-CLOSED: ошибка БД при проверке → 500 (не 403 и не пропуск)", async () => {
    lookupByUserId.set(USER_B, { data: null, error: { message: "connection refused" } });
    await expect(
      assertDialoguePairAccess({ userId: USER_B }, "customer_1", CONF_B_ID)
    ).rejects.toMatchObject({ status: 500 } as Partial<HttpError>);
  });
});
