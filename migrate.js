/* eslint-env node */


const mysql = require('mysql2');
require('dotenv').config();

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});

db.connect((err) => {
  if (err) {
    console.error('Connection failed:', err);
    process.exit(1);
  }

  console.log('Connected to database. Running migration...');

  db.query('ALTER TABLE documents CHANGE client_id user_id INT NOT NULL', (err, result) => {
    if (err) {
      console.error('Migration failed:', err.message);
    } else {
      console.log('Migration successful:', result);
    }
    db.end();
  });
});
