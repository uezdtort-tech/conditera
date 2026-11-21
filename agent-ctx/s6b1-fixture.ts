/**
 * agent-ctx/s6b1-fixture.ts — фикстуры HTTP-матрицы S6B1 (recreate-3-r4).
 *
 * Печатает JSON с id (секреты не печатаются; DATABASE_URL молча из .env.local):
 *   confectionerProfileId — кабинет кондинитера confectioner@demo.ru;
 *   singleOrderId         — single-vendor заказ customer@demo.ru (find-or-create);
 *   mixedOrderId          — мультивендорный заказ (confectionerId NULL, find-or-create).
 */
import { PrismaClient } from "/home/z/my-project/conditera-v2/node_modules/@prisma/client/default.js";
import { readFileSync } from "node:fs";

function pickEnv(name: string): string {
  for (const line of readFileSync("/home/z/my-project/conditera-v2/.env.local", "utf8").split("\n")) {
    const m = line.match(new RegExp(`^${name}=(.*)$`));
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return "";
}

const prisma = new PrismaClient({
  datasources: { db: { url: pickEnv("DATABASE_URL") } },
});

const customer = await prisma.profile.findUnique({ where: { email: "customer@demo.ru" } });
const cabinet = await prisma.confectionerProfile.findFirst({
  where: { profile: { email: "confectioner@demo.ru" } },
  select: { id: true, userId: true },
});
if (!customer || !cabinet) {
  console.error("FIXTURE-FAIL: demo profiles missing");
  process.exit(1);
}

// Single-vendor заказ (find-or-create по номеру).
let single = await prisma.order.findFirst({
  where: { number: { startsWith: "S6B1-SINGLE-" }, customerId: customer.id },
  orderBy: { createdAt: "desc" },
});
if (!single) {
  single = await prisma.order.create({
    data: {
      number: `S6B1-SINGLE-${Date.now()}`,
      customerId: customer.id,
      confectionerId: cabinet.id,
      total: 250000,
      itemsTotal: 250000,
      status: "PENDING",
      contactName: "S6B1 matrix",
      contactPhone: "+70000000000",
    },
  });
}

// Мультивендорный заказ: confectionerId NULL (S4B1-семантика смешанных составов).
let mixed = await prisma.order.findFirst({
  where: { number: { startsWith: "S6B1-MIXED-" }, customerId: customer.id },
  orderBy: { createdAt: "desc" },
});
if (!mixed) {
  mixed = await prisma.order.create({
    data: {
      number: `S6B1-MIXED-${Date.now()}`,
      customerId: customer.id,
      confectionerId: null,
      total: 180000,
      itemsTotal: 180000,
      status: "PENDING",
      contactName: "S6B1 matrix",
      contactPhone: "+70000000000",
    },
  });
}

console.log(
  JSON.stringify({
    confectionerProfileId: cabinet.id,
    singleOrderId: single.id,
    mixedOrderId: mixed.id,
  })
);
await prisma.$disconnect();
process.exit(0);
