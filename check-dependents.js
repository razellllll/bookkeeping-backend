const mysql = require('mysql2/promise');
require('dotenv').config();

(async () => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'viron_bookkeeping_db'
  });

  try {
    console.log('Checking for dependents with NULL user_id...');
    const [nullDeps] = await db.query('SELECT * FROM dependents WHERE user_id IS NULL');
    console.log('Found', nullDeps.length, 'dependents with NULL user_id');

    if (nullDeps.length > 0) {
      console.log('\nSample records:');
      console.table(nullDeps);

      console.log('\nUpdating these records...');
      const [result] = await db.query(`
        UPDATE dependents d
        INNER JOIN personal_info pi ON d.personal_info_id = pi.id
        SET d.user_id = pi.user_id
        WHERE d.user_id IS NULL
      `);
      console.log('✅ Updated', result.affectedRows, 'records');
    } else {
      console.log('✅ All dependents have user_id populated');
    }

    // Show final state
    console.log('\nFinal verification:');
    const [allDeps] = await db.query('SELECT id, user_id, personal_info_id, dep_name FROM dependents LIMIT 10');
    if (allDeps.length > 0) {
      console.table(allDeps);
    } else {
      console.log('No dependents in database');
    }

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await db.end();
  }
})();
