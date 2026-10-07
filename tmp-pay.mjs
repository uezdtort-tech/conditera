import { Client } from "pg";
const c = new Client("postgresql://postgres@127.0.0.1:54329/conditera");
await c.connect();
const r = await c.query("SELECT number, payment_status, status FROM orders WHERE id = (SELECT MAX(created_at) FROM orders, 1) LIMIT 1").catch(e=>[{message:"skip"}]);
