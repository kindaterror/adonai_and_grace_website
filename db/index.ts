import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import pkg from "pg";
import * as schema from "@shared/schema";
const { Pool } = pkg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set");
}

// Determine whether to enable TLS/SSL for the underlying pg Pool. Many hosted
// Postgres providers require SSL (e.g. Neon, some managed providers). The
// connection string may include `?sslmode=require` (common), but the `pg`
// driver expects an `ssl` option. We allow opting in via DATABASE_SSL=true
// or by providing sslmode=require in the DATABASE_URL query string.
const connectionString = process.env.DATABASE_URL as string;
if (!connectionString) {
  throw new Error("DATABASE_URL must be set");
}

let enableSsl = false;
try {
  const parsed = new URL(connectionString);
  const sslmode = parsed.searchParams.get('sslmode');
  if (sslmode === 'require') enableSsl = true;
} catch (e) {
  // ignore parse errors — we'll rely on env fallback below
}

if ((process.env.DATABASE_SSL || '').toLowerCase() === 'true') enableSsl = true;

const pool = new Pool({
  connectionString,
  // Increase connection timeout slightly so slow auth or networking will fail
  // with a clearer error instead of an ambiguous timeout.
  connectionTimeoutMillis: 20000,
  // When enabling SSL we default to not rejecting unauthorized certs to
  // accommodate managed DB providers that require TLS but don't provide
  // a CA bundle on the runtime host. Set DATABASE_SSL_STRICT=true to enable
  // strict certificate validation in production where you control the CA.
  ssl: enableSsl
    ? { rejectUnauthorized: (process.env.DATABASE_SSL_STRICT || '').toLowerCase() === 'true' }
    : undefined,
});

pool.query(`select current_database()`).then(r => {
  console.log(`[db] connected to`, r.rows[0].current_database);
}).catch(err => {
  console.error('[db] initial connection failed:', err && err.message ? err.message : err);
});

export const db = drizzle(pool, { schema });
export { pool };
