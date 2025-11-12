-- MySQL schema for bookkeeping app with sample data

-- Create database (run this first if the database doesn't exist)
-- CREATE DATABASE IF NOT EXISTS viron_bookkeeping_db;
-- USE viron_bookkeeping_db;

-- Drop tables if they exist (to avoid conflicts)
DROP TABLE IF EXISTS dependents;
DROP TABLE IF EXISTS gross_records;
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS documents;
DROP TABLE IF EXISTS personal_info;
DROP TABLE IF EXISTS home_stats;
DROP TABLE IF EXISTS clients;
DROP TABLE IF EXISTS bir_forms;
DROP TABLE IF EXISTS users;

-- Users table for authentication
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL, -- In production, hash this
  role ENUM('client', 'bookkeeper') NOT NULL,
  name VARCHAR(255) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- BIR Forms table (created first for foreign key reference)
CREATE TABLE bir_forms (
  id INT AUTO_INCREMENT PRIMARY KEY,
  form_name VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Personal info table (extends clients)
CREATE TABLE personal_info (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  full_name VARCHAR(255),
  tin VARCHAR(255),
  birth_date DATE,
  birth_place VARCHAR(255),
  citizenship VARCHAR(255),
  civil_status VARCHAR(255),
  gender VARCHAR(255),
  address TEXT,
  phone VARCHAR(255),
  spouse_name VARCHAR(255),
  spouse_tin VARCHAR(255),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Dependents table
CREATE TABLE dependents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  personal_info_id INT NOT NULL,
  dep_name VARCHAR(255) NOT NULL,
  dep_birth_date DATE,
  dep_relationship VARCHAR(255),
  FOREIGN KEY (personal_info_id) REFERENCES personal_info(id) ON DELETE CASCADE
);

-- Gross records table
CREATE TABLE gross_records (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  form_name VARCHAR(255) NOT NULL,
  month VARCHAR(255) NOT NULL,
  gross_income DECIMAL(10,2) NOT NULL,
  computed_tax DECIMAL(10,2) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Messages table for requests/chat
CREATE TABLE messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sender_id INT NOT NULL,
  receiver_id INT NOT NULL,
  message TEXT NOT NULL,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Home stats table (for bookkeeper dashboard)
CREATE TABLE home_stats (
  id INT AUTO_INCREMENT PRIMARY KEY,
  stat_name VARCHAR(255) UNIQUE NOT NULL,
  stat_value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Documents table for file uploads
CREATE TABLE documents (
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
);

-- Legacy clients table (for backward compatibility)
CREATE TABLE clients (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default BIR forms
INSERT IGNORE INTO bir_forms (form_name) VALUES
('BIR Form 1706'),
('BIR Form 1707'),
('BIR Form 2550M'),
('BIR Form 2550Q'),
('BIR Form 2551M'),
('BIR Form 2551Q'),
('BIR Form 2552'),
('BIR Form 2553');

-- Sample data for users (passwords are hashed with bcrypt, but for demo, using plain text - hash them in production)
-- Password for all sample users is 'password123' (hashed)
INSERT INTO users (email, password, role, name) VALUES
('bookkeeper@example.com', '$2b$10$example.hash.for.bookkeeper', 'bookkeeper', 'John Bookkeeper'),
('client1@example.com', '$2b$10$example.hash.for.client1', 'client', 'Alice Client'),
('client2@example.com', '$2b$10$example.hash.for.client2', 'client', 'Bob Client');

-- Sample personal info
INSERT INTO personal_info (user_id, full_name, tin, birth_date, birth_place, citizenship, civil_status, gender, address, phone, spouse_name, spouse_tin) VALUES
(2, 'Alice Johnson', '123456789', '1985-05-15', 'Manila', 'Filipino', 'Married', 'Female', '123 Main St, Manila', '09123456789', 'Bob Johnson', '987654321'),
(3, 'Bob Smith', '112233445', '1990-08-20', 'Cebu', 'Filipino', 'Single', 'Male', '456 Oak Ave, Cebu', '09987654321', NULL, NULL);

-- Sample dependents
INSERT INTO dependents (personal_info_id, dep_name, dep_birth_date, dep_relationship) VALUES
(1, 'Alice Jr.', '2010-03-10', 'Child'),
(1, 'Bob Jr.', '2012-07-22', 'Child');

-- Sample gross records
INSERT INTO gross_records (user_id, form_name, month, gross_income, computed_tax) VALUES
(2, 'BIR Form 1706', 'January', 50000.00, 7500.00),
(2, 'BIR Form 1706', 'February', 55000.00, 8250.00),
(3, 'BIR Form 1707', 'January', 45000.00, 6750.00);

-- Sample messages
INSERT INTO messages (sender_id, receiver_id, message) VALUES
(2, 1, 'Please review my documents.'),
(1, 2, 'Documents reviewed. Everything looks good.');

-- Sample home stats
INSERT INTO home_stats (stat_name, stat_value) VALUES
('total_clients', '2'),
('total_documents', '5'),
('pending_requests', '1');

-- Sample documents (assuming form_id 1 is BIR Form 1706)
INSERT INTO documents (user_id, form_id, file_name, file_path, quarter, year) VALUES
(2, 1, 'sample.pdf', 'sample.pdf', 'Q1', 2023),
(3, 2, 'rental_form.pdf', 'rental_form.pdf', 'Q2', 2023);

-- Sample legacy clients
INSERT INTO clients (name, email) VALUES
('Legacy Client 1', 'legacy1@example.com'),
('Legacy Client 2', 'legacy2@example.com');
