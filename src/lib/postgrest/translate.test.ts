/**
 * Регрессионные тесты PostgREST-шима translate.ts — сохранение PK базовой
 * таблицы при resource-embedding (DEV-19, U-08 fix, HEAD bbe286b).
 *
 * Дефект (до фикса): select=*,rel(...) добавлял join-колонку базовой таблицы
 * (для one-to-many это PK `id`) в hidden даже при явном `*` — SQL её выбирал
 * (`SELECT *, "id"`), но после присоединения embed'ов колонка удалялась из
 * вывода (translate.ts:519-525). Строки списков приходили без `id`.
 *
 * Контракт (PostgREST-семантика):
 *   • `*` покрывает ВСЕ колонки базовой таблицы — базовый PK/FK остаются
 *     top-level, embed'ы — под ключом связи;
 *   • join-колонка, НЕ выбранная пользователем (без `*`), по-прежнему скрыта;
 *   • PK связанной таблицы живёт ТОЛЬКО внутри embed-объекта: если базовая
 *     таблица имеет собственный `id` — побеждает базовый (никаких дублей
 *     join-PK на верхнем уровне).
 *
 * Тесты герметичны: handleSelect вызывается напрямую с фейковым
 * QueryExecutor (правдоподобно проецирует колонки SQL-запроса) и
 * hand-собранной интроспекцией (без сети/БД).
 */
import { describe, it, expect } from "vitest";
import { handleSelect, type PgrstContext, type QueryExecutor } from "./translate";
import type {
  IntrospectedColumn,
  IntrospectedTable,
  SchemaIntrospection,
} from "./introspect";

// ============================================================================
// Фикстуры интроспекции (по supabase/migrations/0005_crm_cms.sql)
// ============================================================================

function col(name: string, opts: Partial<IntrospectedColumn> = {}): IntrospectedColumn {
  return {
    name,
    dataType: opts.dataType ?? "text",
    udtName: opts.udtName ?? opts.dataType ?? "text",
    nullable: opts.nullable ?? true,
  };
}

function makeTable(name: string, cols: IntrospectedColumn[], pks: string[]): IntrospectedTable {
  const columns = new Map<string, IntrospectedColumn>();
  for (const c of cols) columns.set(c.name.toLowerCase(), c);
  return { name, columns, pks };
}

const supportTickets = makeTable(
  "support_tickets",
  [
    col("id", { dataType: "uuid", udtName: "uuid", nullable: false }),
    col("number", { nullable: false }),
    col("user_id", { dataType: "uuid", udtName: "uuid", nullable: false }),
    col("assigned_to", { dataType: "uuid", udtName: "uuid" }),
    col("subject", { nullable: false }),
    col("category", { nullable: false }),
    col("priority", { nullable: false }),
    col("status", { nullable: false }),
    col("order_id", { dataType: "uuid", udtName: "uuid" }),
    col("created_at", { dataType: "timestamp with time zone", udtName: "timestamptz" }),
  ],
  ["id"]
);

const ticketMessages = makeTable(
  "ticket_messages",
  [
    col("id", { dataType: "uuid", udtName: "uuid", nullable: false }),
    col("ticket_id", { dataType: "uuid", udtName: "uuid", nullable: false }),
    col("sender_id", { dataType: "uuid", udtName: "uuid", nullable: false }),
    col("text", { nullable: false }),
    col("is_internal"),
    col("is_system"),
    col("attachments", { dataType: "jsonb", udtName: "jsonb" }),
    col("created_at", { dataType: "timestamp with time zone", udtName: "timestamptz" }),
  ],
  ["id"]
);

const intro: SchemaIntrospection = {
  ts: Date.now(),
  tables: new Map([
    ["support_tickets", supportTickets],
    ["ticket_messages", ticketMessages],
  ]),
  fks: [
    // ticket_messages.ticket_id → support_tickets.id
    { table: "ticket_messages", column: "ticket_id", refTable: "support_tickets", refColumn: "id" },
  ],
  funcs: new Map(),
};

// ============================================================================
// Фейковый executor: правдоподобно проецирует колонки SQL (как реальный PG)
// ============================================================================

type Row = Record<string, unknown>;

/** Распарсить список колонок из "SELECT … FROM <table>" → имена | "*" */
function selectedFields(sql: string, tableName: string): string[] | "*" {
  const m = sql.match(new RegExp(`SELECT (.+?) FROM "${tableName}"`));
  if (!m) return "*";
  const fields: string[] = [];
  for (const item of m[1].split(", ")) {
    if (item.endsWith(` AS "__link__"`)) continue; // служебная join-колонка
    if (item.trim() === "*" || item.trim() === `"${tableName}".*`) return "*";
    const prefixed = item.match(new RegExp(`^"${tableName}"\\."(\\w+)"$`));
    const plain = item.match(/^"(\w+)"$/);
    const f = prefixed?.[1] ?? plain?.[1];
    if (f) fields.push(f);
  }
  return fields;
}

function project(row: Row, fields: string[] | "*"): Row {
  if (fields === "*") return { ...row };
  const out: Row = {};
  for (const f of fields) if (f in row) out[f] = row[f];
  return out;
}

/**
 * Фейковый пул: base-запрос → baseRows; embed-подзапрос (с "__link__") →
 * relRows, отфильтрованные по link-значениям из $1 (= ANY($1)).
 */
function makePool(baseRows: Row[], relRows: Row[], relTable = "ticket_messages", linkKey = "ticket_id"): QueryExecutor {
  return {
    async query(sql: string, params: unknown[] = []): Promise<{ rows: Row[] }> {
      if (sql.includes(`FROM "${relTable}"`) && sql.includes("__link__")) {
        const linkVals = (params[0] as unknown[]) ?? [];
        const fields = selectedFields(sql, relTable);
        return {
          rows: relRows
            .filter((r) => linkVals.includes(r[linkKey]))
            .map((r) => ({ ...project(r, fields), __link__: r[linkKey] })),
        };
      }
      if (sql.includes(`FROM "${relTable}"`)) {
        const fields = selectedFields(sql, relTable);
        return { rows: relRows.map((r) => project(r, fields)) };
      }
      const fields = selectedFields(sql, "support_tickets");
      return { rows: baseRows.map((r) => project(r, fields)) };
    },
  };
}

function makeCtx(table: string, search: string, pool: QueryExecutor): PgrstContext {
  const url = new URL(`http://pgrst.test/rest/v1/${table}?${search}`);
  return {
    pool,
    intro,
    method: "GET",
    segments: [table],
    searchParams: url.searchParams,
    body: null,
    headers: new Headers(),
  };
}

// ============================================================================
// Строки-фикстуры
// ============================================================================

const TK_A: Row = {
  id: "tk-aaaa-1",
  number: "TKT-2026-0001",
  user_id: "user-1",
  assigned_to: null,
  subject: "Тикет A",
  category: "order_issue",
  priority: "medium",
  status: "open",
  order_id: "ord-1",
  created_at: "2026-01-01T10:00:00Z",
};
const TK_B: Row = {
  ...TK_A,
  id: "tk-bbbb-2",
  number: "TKT-2026-0002",
  user_id: "user-2",
  subject: "Тикет B",
  created_at: "2026-01-02T10:00:00Z",
};

const MSG_A1: Row = {
  id: "msg-1",
  ticket_id: "tk-aaaa-1",
  sender_id: "user-1",
  text: "Сообщение владельца",
  is_internal: false,
  is_system: false,
  attachments: null,
  created_at: "2026-01-01T10:01:00Z",
};
const MSG_A2: Row = { ...MSG_A1, id: "msg-2", text: "Внутренняя заметка", is_internal: true };
const MSG_B1: Row = { ...MSG_A1, id: "msg-3", ticket_id: "tk-bbbb-2", text: "Чужое сообщение" };

// ============================================================================
// one-to-many: support_tickets ← ticket_messages (join-колонка базовой
// таблицы = PK `id`) — основной регресс U-08
// ============================================================================

describe("translate.handleSelect — PK базовой таблицы при embedding (DEV-19)", () => {
  it("select=* + embed: строки несут базовый PK id top-level, embed-поля целы", async () => {
    const pool = makePool([TK_A, TK_B], [MSG_A1, MSG_A2, MSG_B1]);
    const res = await handleSelect(
      makeCtx("support_tickets", "select=*,messages:ticket_messages(id,sender_id,text,is_internal,created_at)", pool),
      "support_tickets"
    );

    expect(res.status).toBe(200);
    const rows = res.json as Row[];
    expect(rows).toHaveLength(2);

    for (const row of rows) {
      // ГЛАВНЫЙ РЕГРЕСС: id присутствует и это именно id БАЗОВОЙ строки
      expect(typeof row.id).toBe("string");
      expect(["tk-aaaa-1", "tk-bbbb-2"]).toContain(row.id);
      // Никаких дублей/утечек: ровно колонки базовой таблицы + ключ embed
      expect([...Object.keys(row)].sort()).toEqual(
        [...Object.keys(TK_A), "messages"].sort()
      );
    }

    const a = rows.find((r) => r.id === "tk-aaaa-1")!;
    const b = rows.find((r) => r.id === "tk-bbbb-2")!;
    // embed-поля целы: one-to-many сгруппирован по базовому id
    expect((a.messages as Row[]).map((m) => m.id).sort()).toEqual(["msg-1", "msg-2"]);
    expect((b.messages as Row[]).map((m) => m.id)).toEqual(["msg-3"]);
    // rel-select: только выбранные поля сообщения
    expect(Object.keys((a.messages as Row[])[0]).sort()).toEqual(
      ["id", "sender_id", "text", "is_internal", "created_at"].sort()
    );
  });

  it("select=* + rel(*): FK связанной таблицы (ticket_id) остаётся ВНУТРИ embed-объектов", async () => {
    const pool = makePool([TK_A], [MSG_A1, MSG_A2]);
    const res = await handleSelect(
      makeCtx("support_tickets", "select=*,messages:ticket_messages(*)", pool),
      "support_tickets"
    );

    expect(res.status).toBe(200);
    const rows = res.json as Row[];
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.id).toBe("tk-aaaa-1"); // базовый PK выжил
    // ticket_id НЕ утекает на верхний уровень базовой строки
    expect("ticket_id" in row).toBe(false);
    const msgs = row.messages as Row[];
    expect(msgs).toHaveLength(2);
    for (const m of msgs) {
      expect(m.ticket_id).toBe("tk-aaaa-1"); // FK — внутри embed-объекта
      expect(Object.keys(m).sort()).toEqual(
        ["id", "ticket_id", "sender_id", "text", "is_internal", "is_system", "attachments", "created_at"].sort()
      );
    }
  });

  it("select=*,id + embed: id остаётся (явный выбор тоже покрывает join-колонку)", async () => {
    const pool = makePool([TK_A], [MSG_A1]);
    const res = await handleSelect(
      makeCtx("support_tickets", "select=*,id,messages:ticket_messages(id)", pool),
      "support_tickets"
    );
    expect(res.status).toBe(200);
    const rows = res.json as Row[];
    expect(rows[0].id).toBe("tk-aaaa-1");
    expect((rows[0].messages as Row[])[0].id).toBe("msg-1");
  });

  it("select=id + embed: явный select=id возвращает id (как реальный PostgREST)", async () => {
    const pool = makePool([TK_A], [MSG_A1]);
    const res = await handleSelect(
      makeCtx("support_tickets", "select=id,messages:ticket_messages(id)", pool),
      "support_tickets"
    );
    expect(res.status).toBe(200);
    const rows = res.json as Row[];
    expect(rows[0].id).toBe("tk-aaaa-1");
    expect(Object.keys(rows[0]).sort()).toEqual(["id", "messages"].sort());
  });

  it("select=subject + embed (БЕЗ *): невыбранная join-колонка по-прежнему скрыта (семантика не расширена)", async () => {
    const pool = makePool([TK_A], [MSG_A1]);
    const res = await handleSelect(
      makeCtx("support_tickets", "select=subject,messages:ticket_messages(id)", pool),
      "support_tickets"
    );
    expect(res.status).toBe(200);
    const rows = res.json as Row[];
    // join-колонка не выбрана → скрыта из вывода (join при этом работает)
    expect(Object.keys(rows[0]).sort()).toEqual(["subject", "messages"].sort());
    expect((rows[0].messages as Row[])[0].id).toBe("msg-1");
  });

  // ============================================================================
  // many-to-one: ticket_messages → support_tickets (join-колонка базовой
  // таблицы = FK ticket_id; PK связанной таблицы не должен утекать top-level)
  // ============================================================================

  it("many-to-one select=* + embed: FK базовой таблицы top-level, PK связанной — только внутри embed-объекта (базовый PK побеждает)", async () => {
    // base = ticket_messages, rel = support_tickets
    const msgRows = [MSG_A1];
    const ticketRows = [TK_A];
    // пере-используем makePool наоборот: base-ветка здесь для rel-таблицы не нужна,
    // поэтому собираем executor вручную
    const executor: QueryExecutor = {
      async query(sql: string, params: unknown[] = []) {
        if (sql.includes(`FROM "support_tickets"`)) {
          const linkVals = (params[0] as unknown[]) ?? [];
          const fields = selectedFields(sql, "support_tickets");
          return {
            rows: ticketRows
              .filter((t) => linkVals.includes(t.id))
              .map((t) => ({ ...project(t, fields), __link__: t.id })),
          };
        }
        const fields = selectedFields(sql, "ticket_messages");
        return { rows: msgRows.map((m) => project(m, fields)) };
      },
    };

    const res = await handleSelect(
      makeCtx("ticket_messages", "select=*,ticket:support_tickets(id,subject)", executor),
      "ticket_messages"
    );

    expect(res.status).toBe(200);
    const rows = res.json as Row[];
    expect(rows).toHaveLength(1);
    const row = rows[0];
    // базовый PK сообщения побеждает на верхнем уровне
    expect(row.id).toBe("msg-1");
    // join-колонка базовой таблицы (FK) выживает при `*`
    expect(row.ticket_id).toBe("tk-aaaa-1");
    // связанный PK — только внутри embed-объекта
    expect((row.ticket as Row).id).toBe("tk-aaaa-1");
    expect((row.ticket as Row).subject).toBe("Тикет A");
    expect(Object.keys(row).sort()).toEqual(
      [...Object.keys(MSG_A1), "ticket"].sort()
    );
  });

  it("без embed'ов select=* — поведение не изменено (все колонки на месте)", async () => {
    const pool = makePool([TK_A], []);
    const res = await handleSelect(makeCtx("support_tickets", "select=*", pool), "support_tickets");
    expect(res.status).toBe(200);
    const rows = res.json as Row[];
    expect(Object.keys(rows[0]).sort()).toEqual(Object.keys(TK_A).sort());
  });
});
