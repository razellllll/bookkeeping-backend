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
    console.log('🔧 Starting database migration...');

    // Step 1: Check if user_id column already exists
    const [columns] = await db.query("SHOW COLUMNS FROM dependents LIKE 'user_id'");

    if (columns.length > 0) {
      console.log('✅ user_id column already exists in dependents table');
    } else {
      console.log('📝 Adding user_id column to dependents table...');
      await db.query('ALTER TABLE dependents ADD COLUMN user_id INT AFTER id');
      console.log('✅ user_id column added successfully');
    }

    // Step 2: Populate user_id from personal_info_id
    console.log('📝 Migrating data: populating user_id from personal_info...');
    const [result] = await db.query(`
      UPDATE dependents d
      INNER JOIN personal_info pi ON d.personal_info_id = pi.id
      SET d.user_id = pi.user_id
      WHERE d.user_id IS NULL
    `);
    console.log(`✅ Updated ${result.affectedRows} dependent records`);

    // Step 3: Add foreign key constraint
    console.log('📝 Adding foreign key constraint...');
    try {
      await db.query(`
        ALTER TABLE dependents
        ADD CONSTRAINT fk_dependents_user_id
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      `);
      console.log('✅ Foreign key constraint added');
    } catch (err) {
      if (err.code === 'ER_DUP_KEYNAME') {
        console.log('ℹ️  Foreign key constraint already exists');
      } else {
        throw err;
      }
    }

    // Step 4: Verify the changes
    console.log('\n📊 Verification:');
    const [deps] = await db.query('SELECT id, personal_info_id, user_id, dep_name FROM dependents LIMIT 5');
    console.table(deps);

    console.log('\n✅ Migration complete!');

  } catch (err) {
    console.error('❌ Migration error:', err.message);
    console.error('Full error:', err);
  } finally {
    await db.end();
  }
})();
