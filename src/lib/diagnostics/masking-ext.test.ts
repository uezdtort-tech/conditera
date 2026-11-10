/**
 * Дополнение masking.test.ts — правила §3.2-EXT: приватные переписки и
 * содержимое файлов НЕ сохраняются даже фрагментом (ключи + data: URI).
 */
import { describe, it, expect } from "vitest";
import { scrub, maskString } from "./masking";

describe("masking EXT: приватные сообщения", () => {
  it("объект message REDACTED целиком (включая вложенный body)", () => {
    const out = scrub({
      message: {
        body: "Привет, адрес: Ленина 1, кв 2, телефон +7 900 000 00 00",
        id: "m1",
      },
    });
    // консервативно: объект сообщения целиком скрыт — вложенные ключи
    // (body) scrub'у не видны отдельно, пропустить переписку дороже
    expect(out).toEqual({ message: "[REDACTED]" });
  });

  it("вложенный body/content отдельно — тоже REDACTED", () => {
    const out = scrub({
      payload: { body: "текст", content: "ещё", ok: 1 },
    });
    const inner = (out as { payload: { body: string; content: string; ok: number } }).payload;
    expect(inner.body).toBe("[REDACTED]");
    expect(inner.content).toBe("[REDACTED]");
    expect(inner.ok).toBe(1);
  });

  it("chatText / chat_content / privateMessage REDACTED", () => {
    const out = scrub({
      chatText: "текст переписки",
      chat_content: "ещё переписка",
      privateMessage: "приват",
    });
    expect(out).toEqual({
      chatText: "[REDACTED]",
      chat_content: "[REDACTED]",
      privateMessage: "[REDACTED]",
    });
  });
});

describe("masking EXT: содержимое файлов", () => {
  it("fileContent / attachment_base64 / documentData REDACTED", () => {
    const out = scrub({
      fileContent: "PK...binary...",
      attachment_base64: "aGVsbG8=",
      documentData: "data",
    });
    expect(out).toEqual({
      fileContent: "[REDACTED]",
      attachment_base64: "[REDACTED]",
      documentData: "[REDACTED]",
    });
  });

  it("data:-URI с base64 вырезается из значения даже под нейтральным ключом", () => {
    const out = maskString(
      'error decoding image data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA base64payload'
    );
    expect(out).not.toContain("iVBORw0KGgoAAAANSUhEUgAAAAUA");
  });
});
