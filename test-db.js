/* eslint-env node */


require('dotenv').config();

const mysql = require('mysql2');

// Connect to database
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});

const db = pool.promise();

db.execute('SELECT 1').then(() => {
  console.log(' Connected to MySQL database\n');
}).catch((err) => {
  console.error(' Error connecting to MySQL:', err.message);
  console.log('\n Make sure MySQL is running!');
  process.exit(1);
}).then(async () => {
  try {
    // Check all users
    const [users] = await db.execute('SELECT id, name, email, role FROM users');
    console.log('Users in database:');
    users.forEach(user => {
      console.log(`  - ID: ${user.id}, Name: ${user.name}, Email: ${user.email}, Role: ${user.role}`);
    });

    // Check personal info for each user
    const [personalInfo] = await db.execute('SELECT * FROM personal_info');
    console.log('\n Personal Info in database:');
    if (personalInfo.length === 0) {
      console.log('   No personal info records found!');
    } else {
      personalInfo.forEach(info => {
        console.log(`\n  User ID: ${info.user_id}`);
        console.log(`    Full Name: "${info.full_name}"`);
        console.log(`    TIN: "${info.tin}"`);
        console.log(`    Birth Date: "${info.birth_date}"`);
        console.log(`    Birth Place: "${info.birth_place}"`);
        console.log(`    Citizenship: "${info.citizenship}"`);
        console.log(`    Civil Status: "${info.civil_status}"`);
        console.log(`    Gender: "${info.gender}"`);
        console.log(`    Address: "${info.address}"`);
        console.log(`    Phone: "${info.phone}"`);
        console.log(`    Spouse Name: "${info.spouse_name}"`);
        console.log(`    Spouse TIN: "${info.spouse_tin}"`);
      });
    }

    await db.end();
    console.log('\n Database check complete!');
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
});
