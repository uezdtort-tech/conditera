/**
 * agent-ctx/s6b1-conv-id.ts — id прямого беседы demo-пары (customer/confectioner)
 * для deep-link /account/chats?c={id}. Паттерн s6b1-socket-probe.ts.
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

const ANON = pickEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const prisma = new PrismaClient({ datasources: { db: { url: pickEnv("DATABASE_URL") } } });

async function shimLogin(email: string): Promise<string> {
  const res = await fetch("http://127.0.0.1:3040/auth/v1/token?grant_type=password", {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON },
    body: JSON.stringify({ email, password: "Demo123!" }),
  });
  if (!res.ok) throw new Error(`shim login ${res.status}`);
  const data = (await res.json()) as { user: { id: string } };
  return data.user.id;
}

const a = await shimLogin("customer@demo.ru");
const b = await shimLogin("confectioner@demo.ru");
let room = await prisma.chatRoom.findFirst({
  where: {
    type: "direct",
    AND: [{ participants: { has: a } }, { participants: { has: b } }],
  },
  select: { id: true },
});
if (!room) {
  room = await prisma.chatRoom.create({
    data: { type: "direct", name: "S6B1 probe", participants: [a, b] },
    select: { id: true },
  });
}
console.log(room.id);
await prisma.$disconnect();
process.exit(0);
