import pg from "pg";
const pool = new pg.Pool({ connectionString: "postgresql://postgres@127.0.0.1:54329/conditera_zv26_gate", max: 2 });
const ext = await pool.query(`SELECT extname FROM pg_extension ORDER BY extname`);
console.log("extensions in gate DB:", ext.rows.map(r=>r.extname).join(", "));
const led = await pool.query(`SELECT count(*)::int AS n FROM public.schema_migrations`);
console.log("ledger:", led.rows[0].n);
await pool.end();
