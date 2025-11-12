/* eslint-env node */
/**
 * Migration Script: Add Cloudinary Support to Documents Table
 *
 * This script adds the cloudinary_public_id column to the documents table
 * to support Cloudinary file storage.
 *
 * Run this script using: node migrate-to-cloudinary.js
 */

require('dotenv').config();
const mysql = require('mysql2');

// Database connection
const db = mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'viron_bookkeeping_db'
});

db.connect((err) => {
  if (err) {
    console.error('❌ Error connecting to MySQL database:', err);
    process.exit(1);
  }
  console.log('✅ Connected to MySQL database');
  runMigration();
});

function runMigration() {
  console.log('\n🔄 Starting Cloudinary migration...\n');

  // Check if column already exists
  db.query(
    `SHOW COLUMNS FROM documents LIKE 'cloudinary_public_id'`,
    (err, results) => {
      if (err) {
        console.error('❌ Error checking for cloudinary_public_id column:', err);
        db.end();
        process.exit(1);
      }

      if (results.length > 0) {
        console.log('ℹ️  Column cloudinary_public_id already exists. No migration needed.');
        db.end();
        process.exit(0);
      }

      // Add the cloudinary_public_id column
      console.log('➕ Adding cloudinary_public_id column to documents table...');
      db.query(
        `ALTER TABLE documents
         ADD COLUMN cloudinary_public_id VARCHAR(255) NULL AFTER file_path`,
        (err) => {
          if (err) {
            console.error('❌ Error adding cloudinary_public_id column:', err);
            db.end();
            process.exit(1);
          }

          console.log('✅ Successfully added cloudinary_public_id column');
          console.log('✅ Migration completed successfully!');
          console.log('\n📝 Note: Existing documents will continue to work with local file paths.');
          console.log('   New documents will be stored in Cloudinary.');

          db.end();
          process.exit(0);
        }
      );
    }
  );
}
