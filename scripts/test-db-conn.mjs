import 'dotenv/config';
import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Set DATABASE_URL in .env before running this script.');
  process.exit(2);
}

const pool = new Pool({
  connectionString,
  connectionTimeoutMillis: 20000,
  ssl: { rejectUnauthorized: false },
});

(async () => {
  try {
    const res = await pool.query('select now() as now');
    console.log('OK - server time:', res.rows[0].now);
  } catch (err) {
    console.error('DB connection failed:');
    console.error(err && err.code, err && err.message);
    // print the whole error for more detail (may contain provider hints)
    console.error(err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
