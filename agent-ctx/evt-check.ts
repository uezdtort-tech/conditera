/**
 * /tmp/evt-check.ts — проверка журнала order_events для заказа (S4B1 gate).
 * Использование: bun /tmp/evt-check.ts <orderId>
 * Ждём: ≥ 1 событие, from=DRAFT, to=PENDING.
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";

const orderId = process.argv[2];
if (!orderId) {
  console.log("[FAIL] evt-check: orderId не передан");
  process.exit(1);
}

const envUrl = readFileSync("/home/z/my-project/conditera-v2/.env.local", "utf8")
  .split("\n")
  .find((line) => line.startsWith("DATABASE_URL="))
  ?.slice("DATABASE_URL=".length);

const prisma = new PrismaClient(
  envUrl ? { datasources: { db: { url: envUrl } } } : undefined
);

const events = await prisma.orderEvent.findMany({
  where: { orderId },
  orderBy: { createdAt: "asc" },
});

const draftPending = events.find((e) => e.from === "DRAFT" && e.to === "PENDING");
if (events.length >= 1 && draftPending) {
  console.log(
    `[PASS] order_events: ${events.length} шт., есть DRAFT→PENDING (actor=${draftPending.actorRole ?? "null"})`
  );
} else {
  console.log(
    `[FAIL] order_events: total=${events.length}, DRAFT→PENDING=${draftPending ? "yes" : "no"}`
  );
  process.exitCode = 1;
}
await prisma.$disconnect();
