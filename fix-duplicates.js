/* eslint-env node */


const mysql = require('mysql2/promise');

async function fixDuplicates() {
  const connection = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'viron_bookkeeping_db'
  });

  console.log('Connected to MySQL database\n');

  try {
    // Find all users with duplicate personal_info records
    const [duplicates] = await connection.query(`
      SELECT user_id, COUNT(*) as count
      FROM personal_info
      GROUP BY user_id
      HAVING count > 1
    `);

    if (duplicates.length === 0) {
      console.log('No duplicates found!');
      await connection.end();
      return;
    }

    console.log(`Found ${duplicates.length} user(s) with duplicate records:\n`);
    duplicates.forEach(dup => {
      console.log(`  User ID ${dup.user_id}: ${dup.count} records`);
    });

    console.log('\n Fixing duplicates...\n');

    for (const dup of duplicates) {
      const userId = dup.user_id;

      // Get all records for this user, ordered by id (newest first)
      const [records] = await connection.query(
        'SELECT * FROM personal_info WHERE user_id = ? ORDER BY id DESC',
        [userId]
      );

      console.log(`\n User ID ${userId} - Found ${records.length} records:`);

      // Keep the newest record (first one)
      const keepRecord = records[0];
      console.log(`   Keeping record ID ${keepRecord.id} (newest)`);

      // Delete older records
      for (let i = 1; i < records.length; i++) {
        const oldRecord = records[i];
        console.log(`   Deleting record ID ${oldRecord.id} (old)`);

        // First delete dependents for this old record
        await connection.query(
          'DELETE FROM dependents WHERE personal_info_id = ?',
          [oldRecord.id]
        );

        // Then delete the old personal_info record
        await connection.query(
          'DELETE FROM personal_info WHERE id = ?',
          [oldRecord.id]
        );
      }
    }

    console.log('\n Duplicates cleaned up!');
    console.log('\n Final check...\n');

    // Verify no more duplicates
    const [finalCheck] = await connection.query(`
      SELECT user_id, COUNT(*) as count
      FROM personal_info
      GROUP BY user_id
      HAVING count > 1
    `);

    if (finalCheck.length === 0) {
      console.log('Success! Each user now has exactly 1 personal_info record.\n');
    } else {
      console.log(' Warning: Still found duplicates:\n');
      finalCheck.forEach(dup => {
        console.log(`  User ID ${dup.user_id}: ${dup.count} records`);
      });
    }

  } catch (error) {
    console.error(' Error:', error.message);
  } finally {
    await connection.end();
  }
}

fixDuplicates();
