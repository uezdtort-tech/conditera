/**
 * errors.ts — ошибки в формате PostgREST ({message, details, hint, code})
 * и маппинг SQLSTATE → HTTP-статус.
 */

export interface PgrstErrorBody {
  code: string;
  message: string;
  details: string | null;
  hint: string | null;
}

export class PgrstError extends Error {
  status: number;
  code: string;
  details: string | null;
  hint: string | null;

  constructor(
    status: number,
    code: string,
    message: string,
    details: string | null = null,
    hint: string | null = null
  ) {
    super(message);
    this.name = "PgrstError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.hint = hint;
  }

  toBody(): PgrstErrorBody {
    return { code: this.code, message: this.message, details: this.details, hint: this.hint };
  }
}

/** Проброс PG-ошибки в HTTP-ответ с PGRST-семантикой. */
export function mapPgError(err: unknown): PgrstError {
  const e = err as { code?: string; message?: string; detail?: string; hint?: string; constraint?: string };
  const sqlstate = e?.code || "";
  const message = e?.message || "Internal error";
  const detail = e?.detail ?? null;
  const hint = e?.hint ?? null;

  switch (sqlstate) {
    case "23505": // unique_violation
      return new PgrstError(409, sqlstate, message, detail, hint);
    case "23503": // foreign_key_violation
      return new PgrstError(409, sqlstate, message, detail, hint);
    case "40001": // serialization_failure
    case "40P01": // deadlock_detected
      return new PgrstError(409, sqlstate, message, detail, "Retry the request");
    case "42501": // insufficient_privilege (RLS)
      return new PgrstError(403, sqlstate, message, detail, hint);
    case "42P01": // undefined_table
      return new PgrstError(404, "PGRST205", `Could not find the table in the schema cache: ${message}`, detail, hint);
    case "42883": // undefined_function
      return new PgrstError(404, "PGRST202", `Could not find the function in the schema cache: ${message}`, detail, hint);
    case "22P02": // invalid_text_representation
    case "23514": // check_violation
    case "23502": // not_null_violation
    case "22001": // string_data_right_truncation
    case "22003": // numeric_value_out_of_range
    case "22007": // invalid_datetime_format
    case "42703": // undefined_column
    case "42804": // datatype_mismatch
    case "P0001": // raise_exception
      return new PgrstError(400, sqlstate || "400", message, detail, hint);
    default:
      return new PgrstError(500, sqlstate || "500", message, detail, hint);
  }
}

/** Готовый JSON-ответ с ошибкой PostgREST-формата. */
export function pgrstErrorResponse(err: unknown): { status: number; body: PgrstErrorBody } {
  if (err instanceof PgrstError) {
    return { status: err.status, body: err.toBody() };
  }
  // Ошибки, брошенные интроспекцией с pgrstCode/pgrstStatus (не PG-ошибки)
  const annotated = err as { pgrstCode?: string; pgrstStatus?: number; message?: string };
  if (annotated?.pgrstCode && annotated?.pgrstStatus) {
    return {
      status: annotated.pgrstStatus,
      body: { code: annotated.pgrstCode, message: annotated.message || "error", details: null, hint: null },
    };
  }
  const mapped = mapPgError(err);
  return { status: mapped.status, body: mapped.toBody() };
}
