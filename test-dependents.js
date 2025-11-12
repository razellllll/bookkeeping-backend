/* eslint-env node */


const mysql = require('mysql2/promise');

async function testDependents() {
  const connection = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'viron_bookkeeping_db'
  });

  console.log('✅ Connected to MySQL database\n');

  try {
    // Check all dependents
    const [dependents] = await connection.query(`
      SELECT d.*, pi.user_id
      FROM dependents d
      JOIN personal_info pi ON d.personal_info_id = pi.id
      ORDER BY pi.user_id, d.id
    `);

    console.log('📋 All dependents in database:\n');

    if (dependents.length === 0) {
      console.log('   ⚠️  No dependents found!\n');
    } else {
      const groupedByUser = {};
      dependents.forEach(dep => {
        if (!groupedByUser[dep.user_id]) {
          groupedByUser[dep.user_id] = [];
        }
        groupedByUser[dep.user_id].push(dep);
      });

      Object.keys(groupedByUser).forEach(userId => {
        console.log(`User ID ${userId}:`);
        groupedByUser[userId].forEach(dep => {
          console.log(`  - Dependent ID ${dep.id}:`);
          console.log(`      Name: "${dep.dep_name}"`);
          console.log(`      Birth Date: "${dep.dep_birth_date}"`);
          console.log(`      Relationship: "${dep.dep_relationship}"`);
          console.log(`      Personal Info ID: ${dep.personal_info_id}`);
        });
        console.log('');
      });
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await connection.end();
  }
}

testDependents();
