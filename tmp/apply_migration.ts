import 'dotenv/config';
import { pool } from '../db/index';
import { readFileSync } from 'fs';
(async function(){
  try{
    const sql = readFileSync('db/migrations/2025-10-02-add-learning-preferences.sql', 'utf8');
    console.log('Running SQL:\n', sql);
    const r = await pool.query(sql);
    console.log('Done:', r.command || r);
  }catch(e){
    console.error('Migration error', e);
  } finally{
    process.exit(0);
  }
})();
