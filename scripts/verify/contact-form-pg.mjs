import assert from "node:assert/strict";
import { Client } from "pg";

const databaseUrl = process.env.DATABASE_URL;
const baseUrl = (process.env.BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const db = new Client({ connectionString: databaseUrl });
await db.connect();

const email = `contact-pg17-${crypto.randomUUID()}@example.invalid`;
const ip = "198.51.100.77";
let leadId = null;

async function submit(payload) {
  return fetch(`${baseUrl}/api/contact`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Real-IP": ip,
      "User-Agent": "Cond itera contact acceptance test",
    },
    body: JSON.stringify(payload),
  });
}

try {
  const accepted = await submit({
    name: "Тестовый заявитель",
    email,
    phone: "+79990000000",
    topic: "general",
    message: "Проверка фактической регистрации обращения в CRM.",
    consent: true,
  });
  const acceptedBody = await accepted.json();
  assert.equal(accepted.status, 201, JSON.stringify(acceptedBody));
  assert.equal(acceptedBody.success, true);
  assert.ok(acceptedBody.reference);
  leadId = acceptedBody.reference;

  const stored = await db.query(
    `SELECT name, email, phone, source, status, stage, inquiry,
            metadata->>'topic' AS topic,
            metadata->>'privacy_consent' AS privacy_consent,
            metadata->>'notification_status' AS notification_status
       FROM public.leads
      WHERE id = $1::uuid`,
    [leadId]
  );
  assert.equal(stored.rowCount, 1, "contact request must be persisted in public.leads");
  assert.equal(stored.rows[0].name, "Тестовый заявитель");
  assert.equal(stored.rows[0].email, email);
  assert.equal(stored.rows[0].phone, "+79990000000");
  assert.equal(stored.rows[0].source, "website");
  assert.equal(stored.rows[0].status, "new");
  assert.equal(stored.rows[0].stage, "awareness");
  assert.equal(stored.rows[0].topic, "general");
  assert.equal(stored.rows[0].privacy_consent, "true");
  assert.match(stored.rows[0].inquiry, /Проверка фактической регистрации обращения/);
  console.log("PASS: public contact request creates a CRM lead with consent evidence");

  const invalidConsent = await submit({
    name: "Тестовый заявитель",
    email: `no-consent-${crypto.randomUUID()}@example.invalid`,
    topic: "general",
    message: "Сообщение без согласия на обработку данных.",
    consent: false,
  });
  assert.equal(invalidConsent.status, 400, "missing consent must be rejected");

  const honeypot = await submit({
    name: "Бот",
    email: `bot-${crypto.randomUUID()}@example.invalid`,
    topic: "general",
    message: "Автоматическое тестовое сообщение для honeypot.",
    consent: true,
    website: "https://spam.example",
  });
  assert.equal(honeypot.status, 202, "honeypot must be silently accepted");

  const rateLimited = await submit({
    name: "Тестовый заявитель",
    email: `limited-${crypto.randomUUID()}@example.invalid`,
    topic: "general",
    message: "Проверка ограничения частоты отправки обращений.",
    consent: true,
  });
  assert.equal(rateLimited.status, 429, "fourth request in one hour must be rate-limited");
  console.log("PASS: contact endpoint rejects missing consent, drops honeypot and enforces 3/hour limit");
} finally {
  if (leadId) {
    await db.query("DELETE FROM public.leads WHERE id = $1::uuid", [leadId]);
  }
  await db.end();
}
