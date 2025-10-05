import 'dotenv/config';
import { pool } from '../db/index';
(async function(){
  try{
    const r = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='users' AND column_name='learning_preferences'");
    console.log('result:', r.rows);
  }catch(e){
    console.error('err', e);
  } finally{
    process.exit(0);
  }
})();
