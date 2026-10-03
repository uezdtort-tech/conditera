/**
 * pg.d.ts — минимальные типы для модуля `pg` (node-postgres).
 *
 * В проекте не установлен @types/pg, а `pg@8.x` не поставляет собственные
 * .d.ts (в package.json нет поля "types"). Объявляем только то подмножество
 * API, которое использует PostgREST-шим (src/lib/postgrest/*).
 */

declare module "pg" {
  export interface QueryResultRow {
    [column: string]: unknown;
  }

  export interface QueryResultField {
    name: string;
    tableID: number;
    columnID: number;
    dataTypeID: number;
    dataTypeSize: number;
    dataTypeModifier: number;
    format: string;
  }

  export interface QueryResult<R extends QueryResultRow = QueryResultRow> {
    rows: R[];
    rowCount: number | null;
    fields: QueryResultField[];
    command: string;
    oid: number;
  }

  export interface PoolConfig {
    connectionString?: string;
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database?: string;
    max?: number;
    min?: number;
    idleTimeoutMillis?: number;
    connectionTimeoutMillis?: number;
    statement_timeout?: number | false;
    ssl?: boolean | { rejectUnauthorized?: boolean };
    application_name?: string;
  }

  export interface PoolClient {
    query<R extends QueryResultRow = QueryResultRow>(
      text: string,
      values?: unknown[]
    ): Promise<QueryResult<R>>;
    release(err?: Error | false): void;
  }

  export class Pool {
    constructor(config?: PoolConfig);
    query<R extends QueryResultRow = QueryResultRow>(
      text: string,
      values?: unknown[]
    ): Promise<QueryResult<R>>;
    connect(): Promise<PoolClient>;
    end(): Promise<void>;
    totalCount: number;
    idleCount: number;
    waitingCount: number;
  }

  export class Client {
    constructor(config?: PoolConfig);
    connect(): Promise<void>;
    query<R extends QueryResultRow = QueryResultRow>(
      text: string,
      values?: unknown[]
    ): Promise<QueryResult<R>>;
    end(): Promise<void>;
  }
}
