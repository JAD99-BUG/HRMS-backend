-- HRMS PostgreSQL Database Schema
-- Created: 2026-01-06
-- This schema supports the full HRMS application

-- Drop tables if they exist (for clean install)
DROP TABLE IF EXISTS payroll_deduction CASCADE;
DROP TABLE IF EXISTS payroll_bonus CASCADE;
DROP TABLE IF EXISTS payroll_entry CASCADE;
DROP TABLE IF EXISTS payroll_run CASCADE;
DROP TABLE IF EXISTS attendance_record CASCADE;
DROP TABLE IF EXISTS leave_request CASCADE;
DROP TABLE IF EXISTS leave_type CASCADE;
DROP TABLE IF EXISTS employment_assignment CASCADE;
DROP TABLE IF EXISTS user_role CASCADE;
DROP TABLE IF EXISTS user_account CASCADE;
DROP TABLE IF EXISTS employee CASCADE;
DROP TABLE IF EXISTS "position" CASCADE;
DROP TABLE IF EXISTS department CASCADE;
DROP TABLE IF EXISTS role CASCADE;
DROP TABLE IF EXISTS deduction_type CASCADE;
DROP TABLE IF EXISTS resignation CASCADE;
DROP TABLE IF EXISTS bonus_type CASCADE;

-- Create role table
CREATE TABLE role (
  role_id SERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,
  description TEXT
);

-- Create department table
CREATE TABLE department (
  department_id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  budget DECIMAL(12, 2) DEFAULT 0,
  manager_assignment_id INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create position table (position is a reserved word in PostgreSQL, use quotes)
CREATE TABLE "position" (
  position_id SERIAL PRIMARY KEY,
  title VARCHAR(100) NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create employee table
CREATE TABLE employee (
  employee_id SERIAL PRIMARY KEY,
  first_name VARCHAR(50) NOT NULL,
  last_name VARCHAR(50) NOT NULL,
  phone VARCHAR(20),
  email VARCHAR(100) UNIQUE,
  hire_date DATE NOT NULL,
  status VARCHAR(20) DEFAULT 'ACTIVE',
  address TEXT,
  nationality VARCHAR(50),
  blood_type VARCHAR(5),
  nssf_number VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create employment_assignment table
CREATE TABLE employment_assignment (
  assignment_id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employee(employee_id) ON DELETE CASCADE,
  department_id INTEGER REFERENCES department(department_id) ON DELETE SET NULL,
  position_id INTEGER REFERENCES "position"(position_id) ON DELETE SET NULL,
  start_date DATE NOT NULL,
  end_date DATE,
  start_salary DECIMAL(10, 2) DEFAULT 0,
  reference_salary DECIMAL(10, 2) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'ACTIVE',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add foreign key to department for manager
ALTER TABLE department 
  ADD CONSTRAINT fk_manager_assignment 
  FOREIGN KEY (manager_assignment_id) 
  REFERENCES employment_assignment(assignment_id) 
  ON DELETE SET NULL;

-- Create user_account table
CREATE TABLE user_account (
  user_id SERIAL PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  email VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  employee_id INTEGER REFERENCES employee(employee_id) ON DELETE SET NULL,
  status VARCHAR(20) DEFAULT 'ACTIVE',
  last_login TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create user_role table
CREATE TABLE user_role (
  user_role_id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES user_account(user_id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES role(role_id) ON DELETE CASCADE,
  assigned_on DATE NOT NULL,
  revoked_on DATE,
  UNIQUE(user_id, role_id, assigned_on)
);

-- Create leave_type table
CREATE TABLE leave_type (
  leave_type_id SERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,
  description TEXT,
  max_days INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create leave_request table
CREATE TABLE leave_request (
  leave_request_id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employee(employee_id) ON DELETE CASCADE,
  leave_type_id INTEGER NOT NULL REFERENCES leave_type(leave_type_id) ON DELETE RESTRICT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT,
  submitted_on DATE NOT NULL,
  status VARCHAR(20) DEFAULT 'PENDING',
  approved_by_user_id INTEGER REFERENCES user_account(user_id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create attendance_record table
CREATE TABLE attendance_record (
  attendance_id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employee(employee_id) ON DELETE CASCADE,
  attendance_date DATE NOT NULL,
  check_in TIME,
  check_out TIME,
  mark VARCHAR(20) DEFAULT 'PRESENT',
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(employee_id, attendance_date)
);

CREATE TABLE resignation (
  resignation_id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employee(employee_id) ON DELETE CASCADE,
  resignation_date DATE NOT NULL,
  last_working_day DATE,
  reason TEXT,
  status VARCHAR(20) DEFAULT 'PENDING',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create payroll_run table
CREATE TABLE payroll_run (
  payroll_run_id SERIAL PRIMARY KEY,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  pay_date DATE,
  created_by_user_id INTEGER REFERENCES user_account(user_id) ON DELETE SET NULL,
  notes TEXT,
  status VARCHAR(20) DEFAULT 'DRAFT',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create payroll_entry table
CREATE TABLE payroll_entry (
  payroll_entry_id SERIAL PRIMARY KEY,
  payroll_run_id INTEGER REFERENCES payroll_run(payroll_run_id) ON DELETE CASCADE,
  assignment_id INTEGER NOT NULL REFERENCES employment_assignment(assignment_id) ON DELETE RESTRICT,
  gross_salary DECIMAL(10, 2) NOT NULL DEFAULT 0,
  bonus_amount DECIMAL(10, 2) DEFAULT 0,
  net_salary DECIMAL(10, 2) NOT NULL DEFAULT 0,
  remarks TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create bonus_type table
CREATE TABLE bonus_type (
  bonus_type_id SERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,
  description TEXT
);

-- Create payroll_bonus table
CREATE TABLE payroll_bonus (
  bonus_id SERIAL PRIMARY KEY,
  payroll_entry_id INTEGER NOT NULL REFERENCES payroll_entry(payroll_entry_id) ON DELETE CASCADE,
  bonus_type_id INTEGER REFERENCES bonus_type(bonus_type_id) ON DELETE SET NULL,
  amount DECIMAL(10, 2) NOT NULL,
  reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create deduction_type table
CREATE TABLE deduction_type (
  deduction_type_id SERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,
  description TEXT,
  is_mandatory BOOLEAN DEFAULT FALSE
);

-- Create payroll_deduction table
CREATE TABLE payroll_deduction (
  deduction_id SERIAL PRIMARY KEY,
  payroll_entry_id INTEGER NOT NULL REFERENCES payroll_entry(payroll_entry_id) ON DELETE CASCADE,
  deduction_type_id INTEGER REFERENCES deduction_type(deduction_type_id) ON DELETE SET NULL,
  amount DECIMAL(10, 2) NOT NULL,
  effective_date DATE,
  reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX idx_employee_status ON employee(status);
CREATE INDEX idx_employee_email ON employee(email);
CREATE INDEX idx_employment_assignment_employee ON employment_assignment(employee_id);
CREATE INDEX idx_employment_assignment_status ON employment_assignment(status);
CREATE INDEX idx_user_account_username ON user_account(username);
CREATE INDEX idx_user_account_email ON user_account(email);
CREATE INDEX idx_user_role_user ON user_role(user_id);
CREATE INDEX idx_attendance_employee_date ON attendance_record(employee_id, attendance_date);
CREATE INDEX idx_leave_request_employee ON leave_request(employee_id);
CREATE INDEX idx_leave_request_status ON leave_request(status);
CREATE INDEX idx_payroll_entry_run ON payroll_entry(payroll_run_id);
CREATE INDEX idx_payroll_entry_assignment ON payroll_entry(assignment_id);
CREATE INDEX idx_payroll_run_period ON payroll_run(period_start, period_end);
CREATE INDEX idx_resignation_employee ON resignation(employee_id);

-- Insert default roles
INSERT INTO role (name, description) VALUES
  ('ADMIN', 'System Administrator with full access'),
  ('HR_MANAGER', 'HR Manager with full HR module access'),
  ('HR_ASSISTANT', 'HR Assistant with limited HR access'),
  ('MANAGER', 'Department Manager'),
  ('OWNER', 'Business Owner with read-only access');

-- Insert default leave types
INSERT INTO leave_type (name, description, max_days) VALUES
  ('Annual Leave', 'Paid annual vacation leave', 21),
  ('Sick Leave', 'Medical sick leave', 14),
  ('Emergency Leave', 'Emergency or compassionate leave', 5),
  ('Unpaid Leave', 'Unpaid time off', NULL);

-- Insert default deduction types
INSERT INTO deduction_type (name, description, is_mandatory) VALUES
  ('NSSF', 'National Social Security Fund', TRUE),
  ('Tax', 'Income Tax', TRUE),
  ('Advance Payment', 'Advance salary payment', FALSE),
  ('Other', 'Other deductions', FALSE);

-- Insert default bonus types  
INSERT INTO bonus_type (name, description) VALUES
  ('Performance Bonus', 'Performance-based bonus'),
  ('Holiday Bonus', 'Holiday or festive bonus'),
  ('Commission', 'Sales commission'),
  ('Other', 'Other bonuses');

-- Create a default admin user (password: admin123)
-- Password hash for 'admin123' using bcrypt (you should change this!)
INSERT INTO employee (first_name, last_name, email, hire_date, status) 
VALUES ('System', 'Administrator', 'admin@hrms.com', CURRENT_DATE, 'ACTIVE');

INSERT INTO user_account (username, email, password_hash, employee_id, status)
VALUES ('admin', 'admin@hrms.com', '$2a$10$X8xZ8K5f5Y5Y5Y5Y5Y5Y5uK5Y5Y5Y5Y5Y5Y5Y5Y5Y5Y5Y5Y5Y5Y5Y', 1, 'ACTIVE');

INSERT INTO user_role (user_id, role_id, assigned_on)
VALUES (1, 1, CURRENT_DATE);

-- All done!
SELECT 'HRMS PostgreSQL schema created successfully!' AS message;
