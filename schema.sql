CREATE DATABASE IF NOT EXISTS md;
USE md;

CREATE TABLE IF NOT EXISTS departments (
  id INT PRIMARY KEY,
  name VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  phone VARCHAR(20) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('citizen','head','supervisor','fieldworker','admin') NOT NULL DEFAULT 'citizen',
  ward VARCHAR(80),
  department_id INT,
  latitude DECIMAL(10,7),
  longitude DECIMAL(10,7),
  is_verified TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (department_id) REFERENCES departments(id)
);

CREATE TABLE IF NOT EXISTS issues (
  id INT AUTO_INCREMENT PRIMARY KEY,
  citizen_id INT NOT NULL,
  department_id INT NOT NULL,
  title VARCHAR(255),
  description TEXT,
  image_path VARCHAR(255),
  address VARCHAR(255),
  latitude DECIMAL(10,7),
  longitude DECIMAL(10,7),
  priority ENUM('LOW','MEDIUM','HIGH') DEFAULT 'MEDIUM',
  status ENUM('NEW','ASSIGNED','IN_PROGRESS','VERIFICATION','RESOLVED','ESCALATED','REOPENED') DEFAULT 'NEW',
  resolved_by_supervisor TINYINT(1) DEFAULT 0,
  resolved_by_citizen TINYINT(1) DEFAULT 0,
  rating INT NULL,
  feedback TEXT NULL,
  deleted_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (citizen_id) REFERENCES users(id),
  FOREIGN KEY (department_id) REFERENCES departments(id)
);

CREATE TABLE IF NOT EXISTS assignments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  issue_id INT NOT NULL,
  assigned_by INT,
  assignee_id INT,
  role_assigned ENUM('supervisor','fieldworker'),
  deadline DATETIME NULL,
  status ENUM('PENDING','COMPLETED','OVERDUE') DEFAULT 'PENDING',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (issue_id) REFERENCES issues(id),
  FOREIGN KEY (assigned_by) REFERENCES users(id),
  FOREIGN KEY (assignee_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS feedback (
  id INT AUTO_INCREMENT PRIMARY KEY,
  issue_id INT,
  citizen_id INT,
  rating INT,
  comments TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (issue_id) REFERENCES issues(id),
  FOREIGN KEY (citizen_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT,
  action VARCHAR(255),
  issue_id INT,
  old_status VARCHAR(50),
  new_status VARCHAR(50),
  details TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (issue_id) REFERENCES issues(id)
);

CREATE TABLE IF NOT EXISTS escalations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  issue_id INT,
  from_role VARCHAR(50),
  to_role VARCHAR(50),
  reason VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (issue_id) REFERENCES issues(id)
);

-- indexes
CREATE INDEX idx_dept_status ON issues(department_id, status);
CREATE INDEX idx_created_at ON issues(created_at);
CREATE INDEX idx_assignee_deadline ON assignments(assignee_id, deadline, status);
ALTER TABLE audit_logs
DROP FOREIGN KEY audit_logs_ibfk_2;

ALTER TABLE audit_logs
ADD CONSTRAINT audit_logs_ibfk_2
FOREIGN KEY (issue_id) REFERENCES issues(id)
ON DELETE CASCADE;
SELECT id, name, role, department_id FROM users WHERE role='head';
select * from escalations;
SELECT id, title, department_id, status FROM issues ORDER BY id DESC;
use md;
ALTER TABLE users ADD COLUMN email VARCHAR(255) AFTER name;
ALTER TABLE users MODIFY COLUMN email VARCHAR(255) NULL;
DESCRIBE users;
DESCRIBE departments;
ALTER TABLE assignments
  MODIFY role_assigned ENUM('supervisor','fieldworker','head') NULL;
ALTER TABLE departments
  ADD COLUMN total_deadline_days DECIMAL(5,2) NULL AFTER name;
UPDATE departments SET total_deadline_days = 3 WHERE LOWER(name) = 'water';
UPDATE departments SET total_deadline_days = 3 WHERE LOWER(name) = 'sanitation';
UPDATE departments SET total_deadline_days = 4 WHERE LOWER(name) = 'pwd';
UPDATE departments SET total_deadline_days = 2 WHERE LOWER(name) = 'electricity';
INSERT INTO departments (id, name, total_deadline_days) VALUES
  (1, 'water', 3),
  (2, 'sanitation', 3),
  (3, 'pwd', 4),
  (4, 'electricity', 2)
ON DUPLICATE KEY UPDATE total_deadline_days = VALUES(total_deadline_days);
ALTER TABLE assignments MODIFY role_assigned ENUM('supervisor','fieldworker','head') NULL;
ALTER TABLE departments ADD COLUMN total_deadline_days DECIMAL(5,2) NULL AFTER name;

-- update existing departments:
UPDATE departments SET total_deadline_days = 3 WHERE LOWER(name) = 'water';
UPDATE departments SET total_deadline_days = 3 WHERE LOWER(name) = 'sanitation';
UPDATE departments SET total_deadline_days = 4 WHERE LOWER(name) = 'pwd';
UPDATE departments SET total_deadline_days = 2 WHERE LOWER(name) = 'electricity';

SELECT a.id, a.issue_id, a.role_assigned, a.deadline, TIMESTAMPDIFF(SECOND, NOW(), a.deadline) AS seconds_left
FROM assignments a
WHERE a.status='PENDING' ORDER BY a.deadline ASC;

SELECT * FROM escalations ORDER BY id DESC;

ALTER TABLE issues ADD COLUMN deleted_reason VARCHAR(255) NULL;
ALTER TABLE issues ADD COLUMN deleted_by VARCHAR(50) NULL;
ALTER TABLE issues ADD COLUMN deleted_at DATETIME NULL;
ALTER TABLE audit_logs ADD COLUMN remarks VARCHAR(255) NULL;



ALTER TABLE assignments 
MODIFY COLUMN status ENUM('PENDING','IN_PROGRESS','COMPLETED','ESCALATED') NOT NULL DEFAULT 'PENDING';
use md;
ALTER TABLE issues 
ADD COLUMN deleted_by_head TINYINT(1) DEFAULT 0,
ADD COLUMN head_delete_reason VARCHAR(255) DEFAULT NULL;




-- 1️⃣ Add is_available column to users table (if it doesn't exist)
-- 1️⃣ Add is_available column
ALTER TABLE users
ADD COLUMN is_available TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1 = available, 0 = busy';

-- 2️⃣ Add last_assignment column
ALTER TABLE users
ADD COLUMN last_assignment DATETIME DEFAULT NULL COMMENT 'Last time user was assigned a task';

-- 3️⃣ Ensure role column enum includes all required roles
ALTER TABLE users
MODIFY COLUMN role ENUM('citizen','head','supervisor','fieldworker','admin') NOT NULL DEFAULT 'citizen';

-- 4️⃣ Update existing users to be available by default
UPDATE users SET is_available = 1 WHERE is_available IS NULL;

use md;

select * from escalations;





-- ===========================================
-- 1. USERS TABLE (add isBusy)
-- ===========================================
ALTER TABLE users 
ADD COLUMN isBusy TINYINT(1) NOT NULL DEFAULT 0;

-- Ensure roles exist
ALTER TABLE users MODIFY role 
ENUM('citizen', 'head', 'supervisor', 'fieldworker', 'admin') NOT NULL DEFAULT 'citizen';

-- ===========================================
-- 2. DEPARTMENTS TABLE (add total_deadline_days)
-- ===========================================
ALTER TABLE departments 
ADD COLUMN total_deadline_days INT DEFAULT NULL;

-- Optional: Pre-fill standard deadlines
UPDATE departments
SET total_deadline_days = 
    CASE 
        WHEN name = 'Water' THEN 3
        WHEN name = 'Sanitation' THEN 3
        WHEN name = 'PWD' THEN 4
        WHEN name = 'Electricity' THEN 2
    END;

-- ===========================================
-- 3. ISSUES TABLE (new tracking columns)
-- ===========================================
ALTER TABLE issues
ADD COLUMN deleted_by_head TINYINT(1) DEFAULT 0,
ADD COLUMN head_delete_reason TEXT DEFAULT NULL,
ADD COLUMN resolved_by_supervisor TINYINT(1) DEFAULT 0,
ADD COLUMN resolved_by_citizen TINYINT(1) DEFAULT 0;

-- status enumeration update
ALTER TABLE issues MODIFY status ENUM(
    'NEW', 
    'ASSIGNED', 
    'IN_PROGRESS', 
    'VERIFICATION',
    'ESCALATED',
    'RESOLVED'
);

-- ===========================================
-- 4. ASSIGNMENTS TABLE (multi-level assignment)
-- ===========================================
CREATE TABLE IF NOT EXISTS assignments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    issue_id INT NOT NULL,
    assigned_by INT,
    assignee_id INT,
    role_assigned ENUM('head','supervisor','fieldworker') NOT NULL,
    deadline DATETIME,
    status ENUM('PENDING','DONE') DEFAULT 'PENDING',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (issue_id) REFERENCES issues(id),
    FOREIGN KEY (assigned_by) REFERENCES users(id),
    FOREIGN KEY (assignee_id) REFERENCES users(id)
);

-- Index for fast lookup
CREATE INDEX idx_assign_issue ON assignments(issue_id);
CREATE INDEX idx_assign_assignee ON assignments(assignee_id);

-- ===========================================
-- 5. AUDIT LOGS TABLE
-- ===========================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NULL,
    action VARCHAR(120),
    issue_id INT NULL,
    old_status VARCHAR(50),
    new_status VARCHAR(50),
    remarks TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (issue_id) REFERENCES issues(id)
);

-- Useful indexes
CREATE INDEX idx_audit_issue ON audit_logs(issue_id);


-- ===========================================
-- 6. OPTIONAL — BUSY USERS REPORTING OPTIMIZATION
-- ===========================================
CREATE INDEX idx_users_busy ON users(isBusy, role);

CREATE TABLE fieldworkers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  phone VARCHAR(20) UNIQUE NOT NULL,
  ward VARCHAR(50) NOT NULL,
  department VARCHAR(50) NOT NULL,
  is_available BOOLEAN DEFAULT TRUE
);
ALTER TABLE issues
ADD COLUMN fieldworker_id INT NULL,
ADD COLUMN fw_assigned_at DATETIME NULL,
ADD COLUMN fw_resolved_at DATETIME NULL,
ADD FOREIGN KEY (fieldworker_id) REFERENCES fieldworkers(id);
CREATE TABLE supervisors (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  phone VARCHAR(20) UNIQUE NOT NULL,
  ward VARCHAR(50) NOT NULL,
  department VARCHAR(50) NOT NULL,
  is_available BOOLEAN DEFAULT TRUE
);
ALTER TABLE issues
ADD COLUMN supervisor_id INT NULL,
ADD COLUMN assigned_at DATETIME NULL,
ADD COLUMN resolved_at DATETIME NULL,
ADD FOREIGN KEY (supervisor_id) REFERENCES supervisors(id);
ALTER TABLE users ADD COLUMN isBusy TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE issues 
  ADD COLUMN deleted_by_head TINYINT(1) DEFAULT 0,
  ADD COLUMN head_delete_reason VARCHAR(255) DEFAULT NULL;
ALTER TABLE issues
  ADD COLUMN resolved_by_supervisor TINYINT(1) DEFAULT 0,
  ADD COLUMN resolved_by_citizen TINYINT(1) DEFAULT 0;
CREATE TABLE IF NOT EXISTS assignments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  issue_id INT NOT NULL,
  assigned_by INT,
  assignee_id INT,
  role_assigned ENUM('head','supervisor','fieldworker'),
  deadline DATETIME,
  status VARCHAR(30),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE departments ADD COLUMN total_deadline_days INT DEFAULT NULL;
DESCRIBE users;
DESCRIBE issues;
DESCRIBE departments;
DESCRIBE assignments;


/* =========================================================
   FINAL SQL FOR HEAD → SUPERVISOR ASSIGNMENT FEATURE
   (ADD-ONLY, SAFE, NON-DESTRUCTIVE)
   ========================================================= */

USE md;

/* =========================================================
   1️⃣ ADD isActive FLAG (ENABLES INACTIVE / DELETE SUPERVISOR)
   ========================================================= */
ALTER TABLE users
ADD COLUMN isActive TINYINT(1) NOT NULL DEFAULT 1
COMMENT '1 = Active, 0 = Inactive (soft deleted by Head)';


/* =========================================================
   2️⃣ ENSURE isBusy EXISTS (WORKING STATE)
   ========================================================= */
ALTER TABLE users
ADD COLUMN IF NOT EXISTS isBusy TINYINT(1) NOT NULL DEFAULT 0
COMMENT '1 = Working on an issue, 0 = Free';


/* =========================================================
   3️⃣ NORMALIZE EXISTING SUPERVISORS (SAFE DEFAULTS)
   ========================================================= */
UPDATE users
SET isActive = 1,
    isBusy = 0
WHERE role = 'supervisor'
  AND (isActive IS NULL OR isBusy IS NULL);


/* =========================================================
   4️⃣ PERFORMANCE INDEX FOR REAL-TIME DROPDOWNS
   (Used by /api/users/allSupervisors)
   ========================================================= */
CREATE INDEX idx_users_supervisor_status
ON users (role, department_id, isActive, isBusy);


/* =========================================================
   5️⃣ ASSIGNMENTS STATUS ALIGNMENT (HEAD EXPECTATION)
   ========================================================= */
ALTER TABLE assignments
MODIFY COLUMN status ENUM(
  'PENDING',
  'IN_PROGRESS',
  'COMPLETED',
  'ESCALATED'
) NOT NULL DEFAULT 'PENDING';


/* =========================================================
   6️⃣ ISSUE STATUS ALIGNMENT (USED BY DASHBOARD)
   ========================================================= */
ALTER TABLE issues
MODIFY COLUMN status ENUM(
  'NEW',
  'ASSIGNED',
  'IN_PROGRESS',
  'VERIFICATION',
  'ESCALATED',
  'RESOLVED'
) NOT NULL DEFAULT 'NEW';


/* =========================================================
   7️⃣ SOFT DELETE SUPPORT (HEAD DELETES SUPERVISOR)
   ========================================================= */
UPDATE users
SET isBusy = 0
WHERE isActive = 0;


/* =========================================================
   8️⃣ OPTIONAL SAFETY VIEW (DEBUG / VERIFY)
   ========================================================= */
CREATE OR REPLACE VIEW v_supervisor_status AS
SELECT
  id,
  name,
  phone,
  department_id,
  CASE
    WHEN isActive = 0 THEN 'INACTIVE'
    WHEN isBusy = 1 THEN 'WORKING'
    ELSE 'ACTIVE'
  END AS system_status
FROM users
WHERE role = 'supervisor';


/* =========================================================
   ✅ FEATURE READY
   ========================================================= */
   
   
   SELECT id, name, phone, role, department_id, isActive, isBusy
FROM users
ORDER BY id DESC
LIMIT 5;
UPDATE users
SET isActive = 1, isBusy = 0
WHERE role = 'supervisor';
SELECT id, name, phone, isActive, isBusy
FROM users
WHERE role = 'supervisor'
  AND department_id = 1
  
ALTER TABLE users
ADD COLUMN isActive TINYINT(1) NOT NULL DEFAULT 1
COMMENT '1 = active, 0 = inactive';

-- 2️⃣ Ensure existing users are active
UPDATE users
SET isActive = 1
WHERE isActive IS NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS isActive TINYINT(1) DEFAULT 1;
UPDATE users SET isActive=1 WHERE role IN ('supervisor','fieldworker');


SELECT id, name, role, department_id, isActive, isBusy
FROM users
WHERE role='fieldworker';
SELECT id, name, role, department_id, isActive, isBusy
FROM users;
select * from users
WHERE role = 'fieldworker'
AND department_id = 1
UPDATE users u
JOIN assignments a ON a.assignee_id = u.id
SET u.isBusy = 1
WHERE a.role_assigned = 'fieldworker'
  AND a.status = 'PENDING';
  SELECT id, name, role, department_id, isActive, isBusy
FROM users
WHERE role='supervisor';
UPDATE users SET isBusy = 1 WHERE id = 21;
use md;
ALTER TABLE issues
MODIFY status ENUM(
  'NEW',
  'ASSIGNED',
  'IN_PROGRESS',
  'VERIFICATION',
  'ESCALATED',
  'RESOLVED',
  'DELETED'
) NOT NULL DEFAULT 'NEW';

SELECT id, name, isActive, isBusy
FROM users
WHERE role='fieldworker'
UPDATE users u
SET isBusy = 0
WHERE u.role IN ('fieldworker','supervisor')
AND NOT EXISTS (
  SELECT 1
  FROM assignments a
  JOIN issues i ON i.id = a.issue_id
  WHERE a.assignee_id = u.id
    AND i.status NOT IN ('RESOLVED','DELETED')
);

SELECT id, name, isBusy FROM users WHERE role='fieldworker';
-- WORKING fieldworkers
SELECT DISTINCT u.*
FROM users u
JOIN assignments a ON a.assignee_id = u.id
JOIN issues i ON i.id = a.issue_id
WHERE u.role = 'fieldworker'
  AND i.status NOT IN ('RESOLVED', 'DELETED');

-- ACTIVE fieldworkers
SELECT u.*
FROM users u
WHERE u.role = 'fieldworker'
  AND u.id NOT IN (
    SELECT a.assignee_id
    FROM assignments a
    JOIN issues i ON i.id = a.issue_id
    WHERE i.status NOT IN ('RESOLVED', 'DELETED')
  );
  SELECT id, name, role, isActive, isBusy
FROM users
WHERE role = 'fieldworker'
  AND department_id = 1;
  23	aswqe	fieldworker	1	0
4	Field Worker Water	fieldworker	1	1
26	Arun Kumar	fieldworker	1	1
SELECT 
  u.id AS user_id,
  u.name,
  i.id AS issue_id,
  i.title,
  i.status
FROM users u
JOIN assignments a ON a.assignee_id = u.id
JOIN issues i ON i.id = a.issue_id
WHERE u.id IN (4, 26)
ORDER BY i.status;

UPDATE issues
SET status = 'RESOLVED'
WHERE id IN (8,12);
UPDATE users SET isBusy=0 WHERE id=4;
-- Disable foreign key checks
SET FOREIGN_KEY_CHECKS = 0;
use md;
TRUNCATE TABLE audit_logs;
TRUNCATE TABLE assignments;
TRUNCATE TABLE issues;
Truncate Table Users;

-- Enable foreign key checks again
SET FOREIGN_KEY_CHECKS = 1;
UPDATE users SET isBusy = 0 WHERE role IN ('fieldworker','supervisor');
SELECT COUNT(*) FROM issues;
SELECT COUNT(*) FROM assignments;
SELECT COUNT(*) FROM audit_logs;

SELECT id, status, deleted_by_head, head_delete_reason
FROM issues
WHERE status='DELETED';
UPDATE issues
SET head_delete_reason = 'No reason provided (old deleted record)'
WHERE status = 'DELETED'
  AND deleted_by_head = 1
  AND head_delete_reason IS NULL;
SELECT status, deleted_by_head, head_delete_reason

FROM issues
ORDER BY id DESC
LIMIT 1;
ALTER TABLE issues
MODIFY head_delete_reason VARCHAR(255);
UPDATE issues
SET head_delete_reason = 'No reason provided (legacy record)'
WHERE status = 'DELETED'
  AND deleted_by_head = 1
  AND head_delete_reason ;

DESCRIBE assignments;
DESCRIBE issues;
DESCRIBE users;
SELECT id, issue_id, role_assigned, deadline
FROM assignments
ORDER BY id DESC;
SELECT
  issue_id,
  role_assigned,
  deadline,
  TIMESTAMPDIFF(SECOND, NOW(), deadline) AS seconds_left
FROM assignments
ORDER BY issue_id, role_assigned;
-- First, drop the existing constraint (check your constraint name in the error message)
ALTER TABLE escalations DROP FOREIGN KEY escalations_ibfk_1;

-- Re-add it with CASCADE
ALTER TABLE escalations 
ADD CONSTRAINT escalations_ibfk_1 
FOREIGN KEY (issue_id) REFERENCES issues(id) 
ON DELETE CASCADE;
DELETE FROM escalations WHERE issue_id NOT IN (SELECT id FROM issues);
SHOW CREATE TABLE escalations;

-- 1. Try to drop the foreign key using the name found in Step 2 
-- (Replace 'found_name' with the actual name from the SHOW CREATE command)
ALTER TABLE escalations DROP FOREIGN KEY found_name;

-- 2. Now add the constraint with CASCADE
ALTER TABLE escalations 
ADD CONSTRAINT escalations_ibfk_1 
FOREIGN KEY (issue_id) REFERENCES issues(id) 
ON DELETE CASCADE;

ALTER TABLE assignments
ADD COLUMN is_frozen TINYINT(1) DEFAULT 0;

use md;
select*from users
CREATE TABLE password_otps (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  otp VARCHAR(6) NOT NULL,
  expires_at DATETIME NOT NULL,
  used TINYINT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
ALTER TABLE users
ADD COLUMN change_otp VARCHAR(6),
ADD COLUMN change_otp_expiry DATETIME;
SHOW COLUMNS FROM users;
