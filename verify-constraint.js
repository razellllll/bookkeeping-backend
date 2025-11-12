/* eslint-env node */

const mysql = require('mysql2/promise');

async function verifyConstraint() {
  const connection = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'viron_bookkeeping_db'
  });

  console.log('✅ Connected to MySQL database\n');

  try {
    // Check if UNIQUE constraint exists on user_id
    const [indexes] = await connection.query(`
      SHOW INDEXES FROM personal_info WHERE Column_name = 'user_id'
    `);

    console.log('🔍 Checking UNIQUE constraint on personal_info.user_id:\n');

    if (indexes.length === 0) {
      console.log('❌ ERROR: No index found on user_id column!');
      console.log('   This means ON DUPLICATE KEY UPDATE will NOT work properly.\n');
      console.log('🔧 Fixing: Adding UNIQUE constraint...\n');

      // Add the UNIQUE constraint
      await connection.query(`
        ALTER TABLE personal_info
        ADD UNIQUE KEY unique_user_id (user_id)
      `);

      console.log('✅ UNIQUE constraint added successfully!\n');
    } else {
      console.log('📋 Found indexes on user_id:');
      indexes.forEach(idx => {
        const isUnique = idx.Non_unique === 0;
        console.log(`  - Key name: ${idx.Key_name}, Unique: ${isUnique ? '✅ YES' : '❌ NO'}`);
      });

      const hasUniqueConstraint = indexes.some(idx => idx.Non_unique === 0);

      if (hasUniqueConstraint) {
        console.log('\n✅ UNIQUE constraint is properly set!');
        console.log('   ON DUPLICATE KEY UPDATE will work correctly.\n');
      } else {
        console.log('\n❌ WARNING: Index exists but is NOT unique!');
        console.log('🔧 Fixing: Adding UNIQUE constraint...\n');

        await connection.query(`
          ALTER TABLE personal_info
          ADD UNIQUE KEY unique_user_id (user_id)
        `);

        console.log('✅ UNIQUE constraint added successfully!\n');
      }
    }

    // Test that it works
    console.log('🧪 Testing: Attempting to insert duplicate user_id...\n');

    try {
      await connection.query(`
        INSERT INTO personal_info (user_id, full_name)
        VALUES (4, 'Test Duplicate')
      `);
      console.log('❌ ERROR: Duplicate was allowed! Constraint not working.\n');
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        console.log('✅ SUCCESS: Duplicate was rejected!');
        console.log('   The UNIQUE constraint is working properly.\n');
      } else {
        console.log('❌ Unexpected error:', err.message, '\n');
      }
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await connection.end();
  }
}

verifyConstraint();
