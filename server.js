/* eslint-env node */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const mysql = require('mysql2');
const bcrypt = require('bcrypt'); // For password hashing
const { cloudinary, upload } = require('./config/cloudinary'); // Import Cloudinary configuration
// removed accidental top-level debug logs that referenced undefined variables


const app = express();
const PORT = process.env.PORT || 5000;


// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// Create uploads directory if it doesn't exist (for local fallback)
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// Initialize MySQL Database Pool
const db = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'viron_bookkeeping_db',
  connectionLimit: 10, // Maximum number of connections in the pool
  connectTimeout: 60000 // Connection timeout
});

// Test the connection pool
db.getConnection((err, connection) => {
  if (err) {
    console.error('Error connecting to MySQL database:', err);
    console.log('Please make sure MySQL is running and the database exists.');
    process.exit(1);
  } else {
    console.log('Connected to MySQL database viron_bookkeeping_db');
    connection.release(); // Release the test connection back to the pool
    initializeDatabase();
  }
});

// Database Schema
function initializeDatabase() {
  // Users table
  db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      plain_password VARCHAR(255),
      role ENUM('client', 'bookkeeper') NOT NULL,
      name VARCHAR(255) NOT NULL,
      reset_token VARCHAR(255),
      reset_expires DATETIME,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) console.error('Error creating users table:', err);
  });

  // Add plain_password column if it doesn't exist
  // Ensure column plain_password exists (portable check for MariaDB/MySQL)
  const dbName = process.env.DB_NAME || 'viron_bookkeeping_db';
  db.query(
    `SELECT COUNT(*) as cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [dbName, 'users', 'plain_password'],
    (err, rows) => {
      if (err) return console.error('Error checking plain_password column:', err);
      if (rows && rows[0] && rows[0].cnt === 0) {
        db.query(`ALTER TABLE users ADD COLUMN plain_password VARCHAR(255)`, (err2) => {
          if (err2) console.error('Error adding plain_password column:', err2);
        });
      }
    }
  );

  // Ensure reset_token and reset_expires columns exist
  db.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME IN (?, ?)`,
    [dbName, 'users', 'reset_token', 'reset_expires'],
    (err, cols) => {
      if (err) return console.error('Error checking reset columns:', err);
      const existing = (cols || []).map(c => c.COLUMN_NAME);
      if (!existing.includes('reset_token')) {
        db.query(`ALTER TABLE users ADD COLUMN reset_token VARCHAR(255)`, (e) => { if (e) console.error('Error adding reset_token:', e); });
      }
      if (!existing.includes('reset_expires')) {
        db.query(`ALTER TABLE users ADD COLUMN reset_expires DATETIME`, (e) => { if (e) console.error('Error adding reset_expires:', e); });
      }
    }
  );

  // Personal info table
  db.query(`
    CREATE TABLE IF NOT EXISTS personal_info (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL UNIQUE,
      full_name VARCHAR(255),
      tin VARCHAR(50),
      birth_date DATE,
      birth_place VARCHAR(255),
      citizenship VARCHAR(100),
      civil_status VARCHAR(50),
      gender VARCHAR(20),
      address TEXT,
      phone VARCHAR(20),
      spouse_name VARCHAR(255),
      spouse_tin VARCHAR(50),
      employment_status ENUM('employed', 'self-employed') DEFAULT 'employed',
      philhealth_number VARCHAR(20),
      sss_number VARCHAR(20),
      pagibig_number VARCHAR(20),
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `, (err) => {
    if (err) console.error('Error creating personal_info table:', err);
  });

  // Ensure personal_info.user_id exists and has FK to users(id)
  db.query(
    `SELECT COUNT(*) as cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [dbName, 'personal_info', 'user_id'],
    (err, rows) => {
      if (err) return console.error('Error checking personal_info.user_id column:', err);
      if (rows && rows[0] && rows[0].cnt === 0) {
        console.log('⚠️ user_id column missing in personal_info table, adding it now...');
        db.query(`ALTER TABLE personal_info ADD COLUMN user_id INT NOT NULL UNIQUE AFTER id`, (e) => {
          if (e) {
            console.error('Error adding user_id column to personal_info table:', e);
          } else {
            console.log('✅ user_id column added successfully');
          }
        });
      } else {
        console.log('✅ user_id column exists in personal_info table');
      }

      // Now ensure foreign key exists (check constraints)
      db.query(
        `SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_TYPE = 'FOREIGN KEY'`,
        [dbName, 'personal_info'],
        (err2, cons) => {
          if (err2) return console.error('Error checking personal_info constraints:', err2);
          const hasFK = (cons || []).some(c => /fk_personal_info_user_id/i.test(c.CONSTRAINT_NAME));
          if (!hasFK) {
            // Add a named foreign key (choose a name) — ignore errors if DB already enforces via different name
            db.query(`ALTER TABLE personal_info ADD CONSTRAINT fk_personal_info_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`, (e) => {
              if (e) console.error('Error adding foreign key constraint to personal_info table:', e);
            });
          }
        }
      );

      // Attempt to make user_id NOT NULL UNIQUE (best-effort) - only if column exists
      if (rows && rows[0] && rows[0].cnt > 0) {
        db.query(`ALTER TABLE personal_info MODIFY COLUMN user_id INT NOT NULL UNIQUE`, (e) => {
          if (e && !e.message.includes('Duplicate')) {
            console.error('Error modifying user_id column in personal_info table:', e);
          }
        });
      }
    }
  );

  // Add new columns if they don't exist
  // Ensure additional personal_info columns exist
  ['employment_status','philhealth_number','sss_number','pagibig_number'].forEach(col => {
    db.query(`SELECT COUNT(*) as cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`, [dbName, 'personal_info', col], (err, rows) => {
      if (err) return console.error(`Error checking column ${col}:`, err);
      if (rows && rows[0] && rows[0].cnt === 0) {
        let sql;
        if (col === 'employment_status') sql = `ALTER TABLE personal_info ADD COLUMN employment_status ENUM('employed','self-employed') DEFAULT 'employed'`;
        if (col === 'philhealth_number') sql = `ALTER TABLE personal_info ADD COLUMN philhealth_number VARCHAR(20)`;
        if (col === 'sss_number') sql = `ALTER TABLE personal_info ADD COLUMN sss_number VARCHAR(20)`;
        if (col === 'pagibig_number') sql = `ALTER TABLE personal_info ADD COLUMN pagibig_number VARCHAR(20)`;
        if (sql) db.query(sql, (e) => { if (e) console.error(`Error adding column ${col}:`, e); });
      }
    });
  });

  // Dependents table
  db.query(`
    CREATE TABLE IF NOT EXISTS dependents (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      dep_name VARCHAR(255) NOT NULL,
      dep_birth_date DATE,
      dep_relationship VARCHAR(100),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `, (err) => {
    if (err) console.error('Error creating dependents table:', err);
  });

  // Gross records table
  db.query(`
    CREATE TABLE IF NOT EXISTS gross_records (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      form_name VARCHAR(255) NOT NULL,
      month VARCHAR(10) NOT NULL,
      gross_income DECIMAL(15,2) NOT NULL,
      computed_tax DECIMAL(15,2) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `, (err) => {
    if (err) console.error('Error creating gross_records table:', err);
  });

  // Messages table
  db.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      sender_id INT NOT NULL,
      receiver_id INT NOT NULL,
      message TEXT NOT NULL,
      is_read TINYINT(1) DEFAULT 0,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `, (err) => {
    if (err) console.error('Error creating messages table:', err);
  });

  // Ensure is_read column exists in messages table
  db.query(
    `SELECT COUNT(*) as cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [dbName, 'messages', 'is_read'],
    (err, rows) => {
      if (err) return console.error('Error checking is_read column:', err);
      if (rows && rows[0] && rows[0].cnt === 0) {
        db.query(`ALTER TABLE messages ADD COLUMN is_read TINYINT(1) DEFAULT 0`, (e) => {
          if (e) console.error('Error adding is_read column:', e);
        });
      }
    }
  );

  // Home stats table
  db.query(`
    CREATE TABLE IF NOT EXISTS home_stats (
      id INT AUTO_INCREMENT PRIMARY KEY,
      stat_name VARCHAR(100) UNIQUE NOT NULL,
      stat_value VARCHAR(255) NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) console.error('Error creating home_stats table:', err);
  });

  // Reminders table
  db.query(`
    CREATE TABLE IF NOT EXISTS reminders (
      id INT AUTO_INCREMENT PRIMARY KEY,
      date VARCHAR(50) NOT NULL,
      description TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) console.error('Error creating reminders table:', err);
  });

  // User activities table
  db.query(`
    CREATE TABLE IF NOT EXISTS user_activities (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      activity_type VARCHAR(50) NOT NULL,
      description TEXT NOT NULL,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `, (err) => {
    if (err) console.error('Error creating user_activities table:', err);
  });

  // Legacy clients table (for backward compatibility)
  db.query(`
    CREATE TABLE IF NOT EXISTS clients (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) console.error('Error creating clients table:', err);
  });

  // BIR Forms table
  db.query(`
    CREATE TABLE IF NOT EXISTS bir_forms (
      id INT AUTO_INCREMENT PRIMARY KEY,
      form_name VARCHAR(255) NOT NULL UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) console.error('Error creating bir_forms table:', err);
  });

  // Documents table
  db.query(`
    CREATE TABLE IF NOT EXISTS documents (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      form_id INT NOT NULL,
      file_name VARCHAR(255) NOT NULL,
      file_path VARCHAR(255) NOT NULL,
      quarter VARCHAR(10) NOT NULL,
      year INT NOT NULL,
      uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (form_id) REFERENCES bir_forms(id) ON DELETE CASCADE
    )
  `, (err) => {
    if (err) console.error('Error creating documents table:', err);
  });

  // Insert default BIR forms if they don't exist
  const defaultForms = [
    'BIR Form 1706',
    'BIR Form 1707',
    'BIR Form 2550M',
    'BIR Form 2550Q',
    'BIR Form 2551M',
    'BIR Form 2551Q',
    'BIR Form 2552',
    'BIR Form 2553'
  ];

  defaultForms.forEach(formName => {
    db.query(
      'INSERT IGNORE INTO bir_forms (form_name) VALUES (?)',
      [formName],
      (err) => {
        if (err) console.error(`Error inserting BIR form ${formName}:`, err);
      }
    );
  });

  // Insert default reminders if they don't exist
  const defaultReminders = [
    { date: 'Oct 20, 2025', description: 'Quarterly VAT Return' },
    { date: 'Nov 10, 2025', description: 'Monthly Percentage Tax' },
    { date: 'Dec 31, 2025', description: 'Annual Income Tax Return' }
  ];

  defaultReminders.forEach(reminder => {
    db.query(
      'INSERT IGNORE INTO reminders (date, description) VALUES (?, ?)',
      [reminder.date, reminder.description],
      (err) => {
        if (err) console.error(`Error inserting reminder ${reminder.description}:`, err);
      }
    );
  });


}

// Multer and Cloudinary configuration now imported from ./config/cloudinary
// Old local storage configuration removed

// ==================== API ENDPOINTS ====================

// Auth endpoints
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  db.query('SELECT * FROM users WHERE email = ?', [email], async (err, results) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (results.length === 0 || !(await bcrypt.compare(password, results[0].password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const user = results[0];
    res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
  });
});

app.post('/api/forgot-password', (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  // Generate a unique reset token
  const resetToken = require('crypto').randomBytes(32).toString('hex');
  const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

  db.query(
    'UPDATE users SET reset_token = ?, reset_expires = ? WHERE email = ?',
    [resetToken, resetExpires, email],
    (err, result) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'Email not found' });
      }
      // In a real app, send email with token. For now, return the token for demo.
      res.json({ message: 'Reset token generated', resetToken });
    }
  );
});

app.post('/api/reset-password', async (req, res) => {
  const { token, newPassword, confirmPassword } = req.body;
  if (!token || !newPassword || !confirmPassword) {
    return res.status(400).json({ error: 'Token, new password, and confirm password are required' });
  }
  if (newPassword !== confirmPassword) {
    return res.status(400).json({ error: 'Passwords do not match' });
  }

  db.query(
    'SELECT * FROM users WHERE reset_token = ? AND reset_expires > NOW()',
    [token],
    async (err, results) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (results.length === 0) {
        return res.status(400).json({ error: 'Invalid or expired token' });
      }

      const user = results[0];
      const hashedPassword = await bcrypt.hash(newPassword, 10);

      db.query(
        'UPDATE users SET password = ?, plain_password = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?',
        [hashedPassword, newPassword, user.id],
        (err) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          res.json({ message: 'Password reset successfully' });
        }
      );
    }
  );
});

app.post('/api/signup', async (req, res) => {
  const { email, password, role, name } = req.body;
  if (!email || !password || !role || !name) {
    return res.status(400).json({ error: 'All fields required' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    db.query(
      'INSERT INTO users (email, password, plain_password, role, name) VALUES (?, ?, ?, ?, ?)',
      [email, hashedPassword, password, role, name],
      (err, result) => {
        if (err) {
          if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Email already exists' });
          }
          return res.status(500).json({ error: err.message });
        }
        res.json({ id: result.insertId, name, email, role });
      }
    );
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});
// --- Personal Info Endpoints (Connected + Clean) ---
// Get personal info for a user. Accepts either URL param (/api/personal-info/:userId)
// or query string (?userId= or ?clientId=). Returns an object with personal info
// and a dependents array.
app.get(["/api/personal-info/:userId", "/api/personal-info"], (req, res) => {
  const userId = req.params.userId || req.query.userId || req.query.clientId;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });

  console.log("📥 GET request for userId:", userId);

  // First, check if the table has user_id column
  db.query("SHOW COLUMNS FROM personal_info LIKE 'user_id'", (err, columns) => {
    if (err) {
      console.error("❌ Error checking columns:", err.message);
      return res.status(500).json({ error: err.message });
    }

    const hasUserIdColumn = columns && columns.length > 0;
    console.log("🔍 personal_info table has user_id column:", hasUserIdColumn);

    if (!hasUserIdColumn) {
      console.error("❌ user_id column does not exist in personal_info table");
      return res.status(500).json({
        error: 'Database schema error: user_id column missing. Please restart the server to auto-migrate.',
        needsMigration: true
      });
    }

    // Column exists, proceed with query
    db.query("SELECT * FROM personal_info WHERE user_id = ?", [userId], (err, results) => {
      if (err) {
        console.error("❌ Error fetching personal info:", err.message);
        return res.status(500).json({ error: err.message });
      }

      console.log("✅ Found personal info records:", results?.length || 0);
      const personalInfo = (results && results[0]) ? results[0] : {};

      db.query(
        "SELECT id, dep_name, dep_birth_date, dep_relationship FROM dependents WHERE user_id = ?",
        [userId],
        (err2, deps) => {
          if (err2) {
            console.error("❌ Error fetching dependents:", err2.message);
            return res.status(500).json({ error: err2.message });
          }

          console.log("✅ Found dependents:", deps?.length || 0);
          personalInfo.dependents = deps || [];
          res.json(personalInfo);
        }
      );
    });
  });
});

// ✅ POST: Insert or update personal info + dependents
// Create or update personal info. Accepts URL param, query param or body.userId
app.post(["/api/personal-info/:userId", "/api/personal-info"], (req, res) => {
  const userId = req.params.userId || req.query.userId || req.body.userId;
  if (!userId) {
    console.error("❌ Missing userId in request");
    return res.status(400).json({ error: 'Missing userId' });
  }

  const info = req.body || {};
  const dependents = Array.isArray(info.dependents) ? info.dependents : [];

  console.log("📩 Received POST request for userId=", userId);
  console.log("📩 Request body keys:", Object.keys(info));

  const cleanData = {
    full_name: info.full_name || null,
    tin: info.tin || null,
    birth_date: info.birth_date || null,
    birth_place: info.birth_place || null,
    citizenship: info.citizenship || null,
    civil_status: info.civil_status || null,
    gender: info.gender || null,
    address: info.address || null,
    phone: info.phone || null,
    spouse_name: info.spouse_name || null,
    spouse_tin: info.spouse_tin || null,
    employment_status: info.employment_status || "employed",
    philhealth_number: info.philhealth_number || null,
    sss_number: info.sss_number || null,
    pagibig_number: info.pagibig_number || null,
  };

  const upsertQuery = `
    INSERT INTO personal_info (
      user_id, full_name, tin, birth_date, birth_place, citizenship, civil_status,
      gender, address, phone, spouse_name, spouse_tin, employment_status,
      philhealth_number, sss_number, pagibig_number
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      full_name = VALUES(full_name),
      tin = VALUES(tin),
      birth_date = VALUES(birth_date),
      birth_place = VALUES(birth_place),
      citizenship = VALUES(citizenship),
      civil_status = VALUES(civil_status),
      gender = VALUES(gender),
      address = VALUES(address),
      phone = VALUES(phone),
      spouse_name = VALUES(spouse_name),
      spouse_tin = VALUES(spouse_tin),
      employment_status = VALUES(employment_status),
      philhealth_number = VALUES(philhealth_number),
      sss_number = VALUES(sss_number),
      pagibig_number = VALUES(pagibig_number)
  `;

  const params = [
    userId,
    cleanData.full_name,
    cleanData.tin,
    cleanData.birth_date,
    cleanData.birth_place,
    cleanData.citizenship,
    cleanData.civil_status,
    cleanData.gender,
    cleanData.address,
    cleanData.phone,
    cleanData.spouse_name,
    cleanData.spouse_tin,
    cleanData.employment_status,
    cleanData.philhealth_number,
    cleanData.sss_number,
    cleanData.pagibig_number,
  ];

  // Save personal info
  console.log("💾 Executing UPSERT query for userId:", userId);
  db.query(upsertQuery, params, (err) => {
    if (err) {
      console.error("❌ Database error during UPSERT:", err);
      console.error("❌ Error code:", err.code);
      console.error("❌ Error message:", err.message);
      console.error("❌ SQL State:", err.sqlState);
      return res.status(500).json({ error: err.message, code: err.code });
    }

    console.log("✅ Personal info saved successfully");

    // Delete existing dependents before inserting new ones
    db.query("DELETE FROM dependents WHERE user_id = ?", [userId], (err2) => {
      if (err2) {
        console.error("❌ Error deleting dependents:", err2.message);
        return res.status(500).json({ error: err2.message });
      }

      if (!dependents.length) {
        // Return the saved personal info for consistency with frontend expectations
        return db.query("SELECT * FROM personal_info WHERE user_id = ?", [userId], (err3, rows) => {
          if (err3) return res.status(500).json({ error: err3.message });
          const saved = (rows && rows[0]) ? rows[0] : {};
          saved.dependents = [];
          return res.json(saved);
        });
      }

      const depValues = dependents.map((d) => [
        userId,
        d.dep_name || null,
        d.dep_birth_date || null,
        d.dep_relationship || null,
      ]);

      db.query(
        "INSERT INTO dependents (user_id, dep_name, dep_birth_date, dep_relationship) VALUES ?",
        [depValues],
        (err3) => {
          if (err3) return res.status(500).json({ error: err3.message });

          // Return the saved personal info including dependents
          db.query("SELECT * FROM personal_info WHERE user_id = ?", [userId], (err4, rows) => {
            if (err4) return res.status(500).json({ error: err4.message });
            const saved = (rows && rows[0]) ? rows[0] : {};
            db.query(
              "SELECT id, dep_name, dep_birth_date, dep_relationship FROM dependents WHERE user_id = ?",
              [userId],
              (err5, deps) => {
                if (err5) return res.status(500).json({ error: err5.message });
                saved.dependents = deps || [];
                res.json(saved);
              }
            );
          });
        }
      );
    });
  });
});

// Gross records endpoints
/* ==========================================================
   💰 GROSS RECORDS + EXPENSES ROUTES
   ========================================================== */

// ✅ GET all gross records + related expenses
app.get("/api/gross-records/:userId", (req, res) => {
  const { userId } = req.params;

  const grossQuery = `
    SELECT * FROM gross_records
    WHERE user_id = ?
    ORDER BY created_at DESC
  `;

  db.query(grossQuery, [userId], (err, grossRows) => {
    if (err) return res.status(500).json({ error: err.message });

    if (grossRows.length === 0) return res.json([]);

    const recordIds = grossRows.map((r) => r.id);

    const expenseQuery = `
      SELECT * FROM expenses
      WHERE gross_record_id IN (?)
    `;

    db.query(expenseQuery, [recordIds], (err2, expenseRows) => {
      if (err2) return res.status(500).json({ error: err2.message });

      const data = grossRows.map((record) => ({
        ...record,
        expenses: expenseRows.filter(
          (exp) => exp.gross_record_id === record.id
        ),
      }));

      res.json(data);
    });
  });
});

// ✅ POST new gross record + expenses
app.post("/api/gross-records/:userId", (req, res) => {
  const { userId } = req.params;
  const {
    form_name,
    month,
    gross_income,
    computed_tax,
    classification,
    expenses,
  } = req.body;

  const insertGross = `
    INSERT INTO gross_records
    (user_id, form_name, month, gross_income, computed_tax, classification)
    VALUES (?, ?, ?, ?, ?, ?)
  `;

  db.query(
    insertGross,
    [userId, form_name, month, gross_income, computed_tax, classification],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message });

      const grossRecordId = result.insertId;

      // If no expenses, return success
      if (!expenses || expenses.length === 0) {
        return res
          .status(201)
          .json({ message: "Record added successfully", id: grossRecordId });
      }

      // Add expenses
      const expenseValues = expenses.map((exp) => [
        grossRecordId,
        exp.name,
        exp.amount,
      ]);

      const expenseQuery = `
        INSERT INTO expenses (gross_record_id, name, amount)
        VALUES ?
      `;

      db.query(expenseQuery, [expenseValues], (expErr) => {
        if (expErr) return res.status(500).json({ error: expErr.message });

        res.status(201).json({
          message: "Record and expenses added successfully",
          id: grossRecordId,
        });
      });
    }
  );
});

// ✅ PUT (Update) existing gross record
app.put("/api/gross-records/:recordId", (req, res) => {
  const { recordId } = req.params;
  const {
    form_name,
    month,
    gross_income,
    computed_tax,
    classification,
  } = req.body;

  const updateQuery = `
    UPDATE gross_records
    SET form_name = ?, month = ?, gross_income = ?, computed_tax = ?, classification = ?
    WHERE id = ?
  `;

  db.query(
    updateQuery,
    [form_name, month, gross_income, computed_tax, classification, recordId],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message });

      if (result.affectedRows === 0)
        return res.status(404).json({ error: "Record not found" });

      res.json({ message: "Gross record updated successfully" });
    }
  );
});

// ✅ DELETE gross record (and related expenses)
app.delete("/api/gross-records/:recordId", (req, res) => {
  const { recordId } = req.params;

  // First delete related expenses
  const deleteExpenses = `DELETE FROM expenses WHERE gross_record_id = ?`;
  const deleteGross = `DELETE FROM gross_records WHERE id = ?`;

  db.query(deleteExpenses, [recordId], (err1) => {
    if (err1) return res.status(500).json({ error: err1.message });

    db.query(deleteGross, [recordId], (err2, result) => {
      if (err2) return res.status(500).json({ error: err2.message });

      if (result.affectedRows === 0)
        return res.status(404).json({ error: "Gross record not found" });

      res.json({ message: "Record and related expenses deleted successfully" });
    });
  });
});

// ✅ DELETE individual expense
app.delete("/api/expenses/:id", (req, res) => {
  const { id } = req.params;

  const deleteQuery = `DELETE FROM expenses WHERE id = ?`;

  db.query(deleteQuery, [id], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });

    if (result.affectedRows === 0)
      return res.status(404).json({ error: "Expense not found" });

    res.json({ message: "Expense deleted successfully" });
  });
});


// Messages endpoints
app.get('/api/messages/:userId', (req, res) => {
  const { userId } = req.params;
  const query = `
    SELECT m.*, u.name as sender_name, u.role as sender_role
    FROM messages m
    JOIN users u ON m.sender_id = u.id
    WHERE m.sender_id = ? OR m.receiver_id = ?
    ORDER BY m.timestamp ASC
  `;
  db.query(query, [userId, userId], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

app.post('/api/messages', (req, res) => {
  const { sender_id, receiver_id, message } = req.body;
  db.query(
    'INSERT INTO messages (sender_id, receiver_id, message) VALUES (?, ?, ?)',
    [sender_id, receiver_id, message],
    (err, result) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      // Log activity for sender
      db.query(
        'INSERT INTO user_activities (user_id, activity_type, description) VALUES (?, ?, ?)',
        [sender_id, 'message_sent', `Sent a message`],
        (err) => {
          if (err) console.error('Error logging activity:', err);
        }
      );

      res.json({ id: result.insertId });
    }
  );
});

// Home stats for bookkeeper
app.get('/api/home-stats', (req, res) => {
  db.query('SELECT * FROM home_stats', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    const stats = {};
    rows.forEach(row => {
      stats[row.stat_name] = row.stat_value;
    });
    res.json(stats);
  });
});

// Reminders endpoint
app.get('/api/reminders', (req, res) => {
  db.query('SELECT * FROM reminders ORDER BY date ASC', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// User activities endpoint
app.get('/api/user-activities/:userId', (req, res) => {
  const { userId } = req.params;
  db.query('SELECT * FROM user_activities WHERE user_id = ? ORDER BY timestamp DESC LIMIT 10', [userId], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// Get all clients (for bookkeeper)
app.get('/api/clients', (req, res) => {
  db.query("SELECT id, name, email FROM users WHERE role = 'client' ORDER BY name", [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// Get all users (for admin/bookkeeper views)
app.get('/api/users', (req, res) => {
  db.query('SELECT id, name, email, role FROM users ORDER BY name', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// Get client accounts with passwords (for bookkeeper management)
app.get('/api/client-accounts', (req, res) => {
  db.query('SELECT id, name, email, plain_password FROM users WHERE role = ? ORDER BY name', ['client'], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// Get all BIR forms
app.get('/api/bir-forms', (req, res) => {
  db.query('SELECT * FROM bir_forms ORDER BY form_name', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// Add new BIR form
app.post('/api/bir-forms', (req, res) => {
  const { form_name } = req.body;

  if (!form_name) {
    return res.status(400).json({ error: 'Form name is required' });
  }

  db.query(
    'INSERT INTO bir_forms (form_name) VALUES (?)',
    [form_name],
    (err, result) => {
      if (err) {
        if (err.code === 'ER_DUP_ENTRY') {
          return res.status(400).json({ error: 'Form already exists' });
        }
        return res.status(500).json({ error: err.message });
      }
      res.json({ id: result.insertId, form_name });
    }
  );
});

// Upload documents to Cloudinary
app.post('/api/upload', upload.array('files'), (req, res) => {
  const { client_id, form_name, quarter, year } = req.body;

  if (!client_id || !form_name || !quarter || !year) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  // Get form_id first
  db.query(
    'SELECT id FROM bir_forms WHERE form_name = ?',
    [form_name],
    (err, results) => {
      if (err || results.length === 0) {
        return res.status(400).json({ error: 'Invalid form name' });
      }

      const form_id = results[0].id;
      const uploadedFiles = [];

      // Insert each file into database with Cloudinary URLs
      let processed = 0;
      req.files.forEach((file) => {
        // Cloudinary URL and public_id are available in file object
        const cloudinaryUrl = file.path; // Cloudinary secure_url
        const cloudinaryPublicId = file.filename; // Cloudinary public_id

        db.query(
          `INSERT INTO documents (user_id, form_id, file_name, file_path, cloudinary_public_id, quarter, year)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [client_id, form_id, file.originalname, cloudinaryUrl, cloudinaryPublicId, quarter, year],
          (err, result) => {
            if (err) {
              console.error('Error inserting document:', err);
            } else {
              uploadedFiles.push({
                id: result.insertId,
                fileName: file.originalname,
                fileURL: cloudinaryUrl,
                quarter,
                year
              });

              // Log activity
              db.query(
                'INSERT INTO user_activities (user_id, activity_type, description) VALUES (?, ?, ?)',
                [client_id, 'document_upload', `Uploaded ${file.originalname} for ${form_name}`],
                (err) => {
                  if (err) console.error('Error logging activity:', err);
                }
              );
            }

            processed++;
            if (processed === req.files.length) {
              res.json({ files: uploadedFiles });
            }
          }
        );
      });
    }
  );
});

// Get documents for a specific client and form
app.get('/api/documents/:clientId/:formName', (req, res) => {
  const { clientId, formName } = req.params;

  const query = `
    SELECT d.id, d.file_name, d.file_path, d.quarter, d.year, d.uploaded_at
    FROM documents d
    JOIN bir_forms f ON d.form_id = f.id
    WHERE d.user_id = ? AND f.form_name = ?
    ORDER BY d.year DESC, d.quarter DESC
  `;

  db.query(query, [clientId, formName], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    const documents = rows.map(row => ({
      id: row.id,
      fileName: row.file_name,
      fileURL: row.file_path, // Now contains Cloudinary URL
      quarter: row.quarter,
      year: row.year,
      uploadedAt: row.uploaded_at
    }));

    res.json(documents);
  });
});

// Get all documents (for bookkeeper/admin view)
app.get('/api/documents', (req, res) => {
  const query = `
    SELECT d.id, d.file_name, d.file_path, d.quarter, d.year, d.uploaded_at, f.form_name, u.name as client_name
    FROM documents d
    JOIN bir_forms f ON d.form_id = f.id
    JOIN users u ON d.user_id = u.id
    ORDER BY u.name, f.form_name, d.year DESC, d.quarter DESC
  `;

  db.query(query, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    // Organize by client and form
    const documentsByClient = {};
    rows.forEach(row => {
      const clientKey = row.client_name;
      if (!documentsByClient[clientKey]) {
        documentsByClient[clientKey] = {};
      }
      if (!documentsByClient[clientKey][row.form_name]) {
        documentsByClient[clientKey][row.form_name] = [];
      }
      documentsByClient[clientKey][row.form_name].push({
        id: row.id,
        fileName: row.file_name,
        fileURL: row.file_path, // Now contains Cloudinary URL
        quarter: row.quarter,
        year: row.year,
        uploadedAt: row.uploaded_at
      });
    });

    res.json(documentsByClient);
  });
});

// Get all documents for a client (organized by form)
app.get('/api/documents/:clientId', (req, res) => {
  const { clientId } = req.params;

  const query = `
    SELECT d.id, d.file_name, d.file_path, d.quarter, d.year, d.uploaded_at, f.form_name
    FROM documents d
    JOIN bir_forms f ON d.form_id = f.id
    WHERE d.user_id = ?
    ORDER BY f.form_name, d.year DESC, d.quarter DESC
  `;

  db.query(query, [clientId], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    // Organize by form name
    const documentsByForm = {};
    rows.forEach(row => {
      if (!documentsByForm[row.form_name]) {
        documentsByForm[row.form_name] = [];
      }
      documentsByForm[row.form_name].push({
        id: row.id,
        fileName: row.file_name,
        fileURL: row.file_path, // Now contains Cloudinary URL
        quarter: row.quarter,
        year: row.year,
        uploadedAt: row.uploaded_at
      });
    });

    res.json(documentsByForm);
  });
});



// Calculate due dates for government contributions
app.get('/api/due-dates/:userId', (req, res) => {
  const { userId } = req.params;

  // Fetch personal info for the user
  db.query('SELECT * FROM personal_info WHERE user_id = ?', [userId], (err, results) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    if (results.length === 0) {
      return res.json({ dueDates: [] });
    }

    const userInfo = results[0];
    const dueDates = [];
    const now = new Date();
    const currentMonth = now.getMonth() + 1; // JavaScript months are 0-indexed
    const currentYear = now.getFullYear();

    // Helper function to get last day of month
    const getLastDayOfMonth = (year, month) => {
      return new Date(year, month, 0).getDate();
    };

    // Helper function to get first day of next quarter
    const getFirstDayOfNextQuarter = (year, month) => {
      const quarter = Math.ceil(month / 3);
      const nextQuarter = quarter === 4 ? 1 : quarter + 1;
      const nextYear = quarter === 4 ? year + 1 : year;
      const firstMonthOfQuarter = (nextQuarter - 1) * 3 + 1;
      return { year: nextYear, month: firstMonthOfQuarter, day: 1 };
    };

    // PhilHealth due dates
    if (userInfo.philhealth_number) {
      if (userInfo.employment_status === 'employed') {
        // For employed: 15th or 20th of next month based on last digit of PhilHealth number
        const lastDigit = parseInt(userInfo.philhealth_number.slice(-1));
        const dueDay = lastDigit >= 1 && lastDigit <= 5 ? 15 : 20;
        const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1;
        const dueYear = currentMonth === 12 ? currentYear + 1 : currentYear;

        dueDates.push({
          agency: 'PhilHealth',
          description: `PhilHealth contribution payment (Employed) - Form PMRF, ER2`,
          dueDate: `${dueYear}-${String(nextMonth).padStart(2, '0')}-${String(dueDay).padStart(2, '0')}`,
          membershipNumber: userInfo.philhealth_number
        });
      } else if (userInfo.employment_status === 'self-employed') {
        // For self-employed: last day of current month or quarter
        const lastDay = getLastDayOfMonth(currentYear, currentMonth);
        dueDates.push({
          agency: 'PhilHealth',
          description: `PhilHealth contribution payment (Self-employed) - Form PMRF, PPP5`,
          dueDate: `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
          membershipNumber: userInfo.philhealth_number
        });
      }
    }

    // SSS due dates
    if (userInfo.sss_number) {
      // Both employed and self-employed: last day of next month
      const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1;
      const dueYear = currentMonth === 12 ? currentYear + 1 : currentYear;
      const lastDay = getLastDayOfMonth(dueYear, nextMonth);

      const forms = userInfo.employment_status === 'employed'
        ? 'Form R-1, R-1A, R-3'
        : 'Form RS-1, RS-5';

      dueDates.push({
        agency: 'SSS',
        description: `SSS contribution payment (${userInfo.employment_status === 'employed' ? 'Employed' : 'Self-employed'}) - ${forms}`,
        dueDate: `${dueYear}-${String(nextMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
        membershipNumber: userInfo.sss_number
      });
    }

    // Pag-IBIG due dates
    if (userInfo.pagibig_number) {
      if (userInfo.employment_status === 'employed' || userInfo.employment_status === 'self-employed') {
        // For both: 10th of next month, or optionally first month of next quarter for self-employed
        const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1;
        const dueYear = currentMonth === 12 ? currentYear + 1 : currentYear;

        const forms = userInfo.employment_status === 'employed'
          ? 'Form ER1, MDF, MRS'
          : 'Form MDF, POF';

        dueDates.push({
          agency: 'Pag-IBIG',
          description: `Pag-IBIG contribution payment (${userInfo.employment_status === 'employed' ? 'Employed' : 'Self-employed'}) - ${forms}`,
          dueDate: `${dueYear}-${String(nextMonth).padStart(2, '0')}-10`,
          membershipNumber: userInfo.pagibig_number
        });

        // Optional quarterly payment for self-employed
        if (userInfo.employment_status === 'self-employed') {
          const nextQuarter = getFirstDayOfNextQuarter(currentYear, currentMonth);
          dueDates.push({
            agency: 'Pag-IBIG',
            description: `Pag-IBIG contribution payment (Quarterly Option) - Form MDF, POF`,
            dueDate: `${nextQuarter.year}-${String(nextQuarter.month).padStart(2, '0')}-${String(nextQuarter.day).padStart(2, '0')}`,
            membershipNumber: userInfo.pagibig_number
          });
        }
      }
    }

    // Filter for current month and future due dates only
    const currentMonthDueDates = dueDates.filter(dueDate => {
      const dueDateObj = new Date(dueDate.dueDate);
      return dueDateObj >= now;
    });

    res.json({ dueDates: currentMonthDueDates });
  });
});

// Comprehensive database diagnostic endpoint
app.get('/api/debug/check-schema', (req, res) => {
  const dbName = process.env.DB_NAME || 'viron_bookkeeping_db';
  const diagnostics = {};

  // Check personal_info table structure
  db.query(`DESCRIBE personal_info`, (err, columns) => {
    if (err) {
      diagnostics.personal_info_error = err.message;
    } else {
      diagnostics.personal_info_columns = columns.map(col => ({
        Field: col.Field,
        Type: col.Type,
        Null: col.Null,
        Key: col.Key,
        Default: col.Default
      }));
    }

    // Check dependents table structure
    db.query(`DESCRIBE dependents`, (err2, cols2) => {
      if (err2) {
        diagnostics.dependents_error = err2.message;
      } else {
        diagnostics.dependents_columns = cols2.map(col => ({
          Field: col.Field,
          Type: col.Type,
          Null: col.Null,
          Key: col.Key
        }));
      }

      // Check sample data
      db.query(`SELECT * FROM personal_info LIMIT 3`, (err3, rows) => {
        if (err3) {
          diagnostics.sample_data_error = err3.message;
        } else {
          diagnostics.sample_data_count = rows.length;
          diagnostics.sample_data = rows;
        }

        // Check users table for reference
        db.query(`SELECT id, email, role FROM users LIMIT 5`, (err4, users) => {
          if (!err4) {
            diagnostics.sample_users = users;
          }

          res.json(diagnostics);
        });
      });
    });
  });
});

// Database repair endpoint - checks and fixes personal_info table structure
app.get('/api/debug/repair-database', (req, res) => {
  const dbName = process.env.DB_NAME || 'viron_bookkeeping_db';
  const results = { checks: [], fixes: [] };

  // Check if personal_info table exists
  db.query(`SHOW TABLES LIKE 'personal_info'`, (err, tables) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    if (tables.length === 0) {
      results.checks.push('personal_info table does not exist');
      return res.json(results);
    }

    results.checks.push('personal_info table exists');

    // Check if user_id column exists
    db.query(
      `SELECT COUNT(*) as cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [dbName, 'personal_info', 'user_id'],
      (err, rows) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }

        if (rows && rows[0] && rows[0].cnt === 0) {
          results.checks.push('user_id column is MISSING');
          results.fixes.push('Adding user_id column...');

          // Add the user_id column
          db.query(`ALTER TABLE personal_info ADD COLUMN user_id INT AFTER id`, (err) => {
            if (err) {
              results.fixes.push(`Error adding user_id: ${err.message}`);
            } else {
              results.fixes.push('user_id column added successfully');
            }
            return res.json(results);
          });
        } else {
          results.checks.push('user_id column exists');

          // Show the current table structure
          db.query(`DESCRIBE personal_info`, (err, columns) => {
            if (!err) {
              results.table_structure = columns;
            }
            return res.json(results);
          });
        }
      }
    );
  });
});

// Debug endpoint to check documents and files
app.get('/api/debug/documents', (req, res) => {
  db.query('SELECT id, user_id, file_name, file_path FROM documents LIMIT 10', [], (err, docs) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    const uploadsDir = path.join(__dirname, 'uploads');
    let filesInUploads = [];

    try {
      if (fs.existsSync(uploadsDir)) {
        filesInUploads = fs.readdirSync(uploadsDir);
      }
    } catch (e) {
      filesInUploads = ['Error reading directory: ' + e.message];
    }

    const docsWithStatus = docs.map(doc => ({
      ...doc,
      fileExists: fs.existsSync(path.join(__dirname, 'uploads', doc.file_path))
    }));

    res.json({
      documents: docsWithStatus,
      uploadsDirectory: uploadsDir,
      filesInUploads: filesInUploads,
      uploadsDirExists: fs.existsSync(uploadsDir)
    });
  });
});

// Download document - Redirect to Cloudinary URL
app.get('/api/download/:documentId', (req, res) => {
  const { documentId } = req.params;

  console.log('Download request for document ID:', documentId);

  db.query(
    'SELECT file_path, file_name FROM documents WHERE id = ?',
    [documentId],
    (err, results) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error: ' + err.message });
      }

      if (results.length === 0) {
        console.error('Document not found in database with ID:', documentId);
        return res.status(404).json({ error: 'Document not found in database' });
      }

      const row = results[0];
      const cloudinaryUrl = row.file_path; // This is now the Cloudinary URL

      console.log('Found document record:', { id: documentId, cloudinary_url: cloudinaryUrl, file_name: row.file_name });

      // Check if this is a Cloudinary URL (starts with http/https)
      if (cloudinaryUrl.startsWith('http://') || cloudinaryUrl.startsWith('https://')) {
        // Cloudinary URL - redirect to it
        console.log('Redirecting to Cloudinary URL:', cloudinaryUrl);

        // For inline viewing, redirect directly
        if (req.query.inline === 'true') {
          return res.redirect(cloudinaryUrl);
        } else {
          // For download, modify the URL to force download
          // Cloudinary supports fl_attachment flag for forcing downloads
          const downloadUrl = cloudinaryUrl.includes('/upload/')
            ? cloudinaryUrl.replace('/upload/', '/upload/fl_attachment/')
            : cloudinaryUrl;

          return res.redirect(downloadUrl);
        }
      } else {
        // Legacy local file path - for backward compatibility
        console.log('Legacy local file detected, serving from uploads directory');
        const filePath = path.join(__dirname, 'uploads', row.file_path);

        if (!fs.existsSync(filePath)) {
          return res.status(404).json({
            error: 'File not found on server',
            details: {
              file_path: row.file_path,
              expected_location: filePath
            }
          });
        }

        const ext = path.extname(row.file_name).toLowerCase();
        const contentTypes = {
          '.pdf': 'application/pdf',
          '.doc': 'application/msword',
          '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          '.xls': 'application/vnd.ms-excel',
          '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.gif': 'image/gif'
        };

        const contentType = contentTypes[ext] || 'application/octet-stream';

        if (req.query.inline === 'true') {
          res.setHeader('Content-Type', contentType);
          res.setHeader('Content-Disposition', `inline; filename="${row.file_name}"`);
          res.sendFile(filePath);
        } else {
          res.download(filePath, row.file_name);
        }
      }
    }
  );
});

// Delete document
app.delete('/api/documents/:documentId', (req, res) => {
  const { documentId } = req.params;

  // First get the file path and cloudinary public_id
  db.query(
    'SELECT file_path, cloudinary_public_id FROM documents WHERE id = ?',
    [documentId],
    (err, results) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      if (results.length === 0) {
        return res.status(404).json({ error: 'Document not found' });
      }

      const row = results[0];

      // Check if this is a Cloudinary file
      if (row.cloudinary_public_id) {
        // Delete from Cloudinary
        console.log('Deleting from Cloudinary with public_id:', row.cloudinary_public_id);
        cloudinary.uploader.destroy(row.cloudinary_public_id, (error, result) => {
          if (error) {
            console.error('Error deleting from Cloudinary:', error);
            // Continue with database deletion even if Cloudinary deletion fails
          } else {
            console.log('Cloudinary deletion result:', result);
          }

          // Delete from database
          db.query(
            'DELETE FROM documents WHERE id = ?',
            [documentId],
            (err) => {
              if (err) {
                return res.status(500).json({ error: err.message });
              }
              res.json({ message: 'Document deleted successfully' });
            }
          );
        });
      } else {
        // Legacy local file - delete from filesystem
        console.log('Legacy file deletion from local filesystem');
        const filePath = path.join(__dirname, 'uploads', row.file_path);
        fs.unlink(filePath, (err) => {
          if (err) {
            console.error('Error deleting local file:', err);
          }
        });

        // Delete from database
        db.query(
          'DELETE FROM documents WHERE id = ?',
          [documentId],
          (err) => {
            if (err) {
              return res.status(500).json({ error: err.message });
            }
            res.json({ message: 'Document deleted successfully' });
          }
        );
      }
    }
  );
});

// GET unread messages for a user
app.get("/api/messages/unread/:userId", (req, res) => {
  const userId = req.params.userId;
  const sql = `
    SELECT sender_id, message, timestamp 
    FROM messages 
    WHERE receiver_id = ? AND is_read = 0
  `;
  db.query(sql, [userId], (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Database error" });
    }
    res.json(results); // returns array of unread messages
  });
});
// Mark messages as read from a specific sender
app.post("/api/messages/mark-read", (req, res) => {
  const { receiver_id, sender_id } = req.body;

  if (!receiver_id || !sender_id) {
    return res.status(400).json({ error: "Missing parameters" });
  }

  const sql = `
    UPDATE messages
    SET is_read = 1
    WHERE receiver_id = ? AND sender_id = ? AND is_read = 0
  `;
  db.query(sql, [receiver_id, sender_id], (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Database error" });
    }
    res.json({ success: true, affectedRows: result.affectedRows });
  });
});


// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.end((err) => {
    if (err) {
      console.error(err.message);
    }
    console.log('Database connection pool closed');
    process.exit(0);
  });
});





