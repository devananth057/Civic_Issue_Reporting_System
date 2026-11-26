// server/models/assignments.js
// Helper module for assignment CRUD and lookup operations.
// Non-destructive utilities to be used by controllers and escalation scheduler.

const pool = require('../db');

/**
 * Create an assignment.
 * deadline can be either:
 *  - a JS Date object (deadlineDatetime provided), OR
 *  - a number (daysOffset) meaning NOW() + INTERVAL daysOffset DAY
 *
 * Returns the inserted assignment id.
 *
 * Usage examples:
 * await createAssignment({ issueId, assignedBy, assigneeId, role, deadlineDatetime });
 * await createAssignment({ issueId, assignedBy, assigneeId, role, daysOffset: 1.5 });
 */
async function createAssignment({ issueId, assignedBy = null, assigneeId = null, role, deadlineDatetime = null, daysOffset = null, status = 'PENDING' }) {
  if (!issueId || !role) throw new Error('issueId and role are required');

  try {
    if (deadlineDatetime instanceof Date) {
      const sql = `INSERT INTO assignments (issue_id, assigned_by, assignee_id, role_assigned, deadline, status, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, NOW())`;
      const params = [issueId, assignedBy, assigneeId, role, deadlineDatetime, status];
      const [res] = await pool.query(sql, params);
      return res.insertId;
    }

    if (typeof daysOffset === 'number') {
      // Use MySQL expression NOW() + INTERVAL ? DAY -> but we need to pass the number into query safely.
      // Some MySQL drivers don't accept INTERVAL ? DAY with parameter; we'll construct query with numeric literal sanitized.
      // Ensure we coerce to Number and limit precision.
      const days = Number(daysOffset);
      const sql = `INSERT INTO assignments (issue_id, assigned_by, assignee_id, role_assigned, deadline, status, created_at)
                   VALUES (?, ?, ?, ?, (NOW() + INTERVAL ${days} DAY), ?, NOW())`;
      const params = [issueId, assignedBy, assigneeId, role, status];
      const [res] = await pool.query(sql, params);
      return res.insertId;
    }

    // no deadline provided -> insert null
    const sql = `INSERT INTO assignments (issue_id, assigned_by, assignee_id, role_assigned, deadline, status, created_at)
                 VALUES (?, ?, ?, ?, NULL, ?, NOW())`;
    const params = [issueId, assignedBy, assigneeId, role, status];
    const [res] = await pool.query(sql, params);
    return res.insertId;
  } catch (err) {
    console.error('[Assignments] createAssignment error:', err);
    throw err;
  }
}

/**
 * Find first user by role within a department (used for auto-assign/escalate).
 * Returns { id, name, email } or null.
 */
async function findUserByRoleAndDept(role, department_id) {
  try {
    const [rows] = await pool.query(
      'SELECT id, name, email FROM users WHERE role = ? AND department_id = ? LIMIT 1',
      [role, department_id]
    );
    return rows && rows.length ? rows[0] : null;
  } catch (err) {
    console.error('[Assignments] findUserByRoleAndDept error:', err);
    throw err;
  }
}

/**
 * Get all pending assignments (optionally filtered by department).
 * Returns array of assignments with issue info.
 */
async function getPendingAssignments({ department_id = null } = {}) {
  try {
    const params = [];
    let sql = `
      SELECT a.id AS assignment_id, a.issue_id, a.assignee_id, a.role_assigned, a.deadline, a.status,
             i.department_id, i.title, i.status AS issue_status
      FROM assignments a
      JOIN issues i ON i.id = a.issue_id
      WHERE a.status = 'PENDING' AND i.status NOT IN ('RESOLVED','CLOSED')
    `;
    if (department_id) {
      sql += ' AND i.department_id = ?';
      params.push(department_id);
    }
    sql += ' ORDER BY a.deadline ASC';
    const [rows] = await pool.query(sql, params);
    return rows;
  } catch (err) {
    console.error('[Assignments] getPendingAssignments error:', err);
    throw err;
  }
}

/**
 * Get overdue assignments (deadline <= NOW()) that are still PENDING.
 * Returns array of rows.
 */
async function getOverdueAssignments() {
  try {
    const [rows] = await pool.query(`
      SELECT a.id AS assignment_id, a.issue_id, a.assignee_id, a.role_assigned, a.deadline,
             i.department_id, i.title, i.status AS issue_status
      FROM assignments a
      JOIN issues i ON i.id = a.issue_id
      WHERE a.status = 'PENDING' AND a.deadline IS NOT NULL AND a.deadline <= NOW()
        AND i.status NOT IN ('RESOLVED','CLOSED')
      ORDER BY a.deadline ASC
    `);
    return rows;
  } catch (err) {
    console.error('[Assignments] getOverdueAssignments error:', err);
    throw err;
  }
}

/**
 * Mark an assignment status (OVERDUE, COMPLETED, etc.)
 */
async function updateAssignmentStatus(assignmentId, status) {
  try {
    await pool.query('UPDATE assignments SET status = ? WHERE id = ?', [status, assignmentId]);
    return true;
  } catch (err) {
    console.error('[Assignments] updateAssignmentStatus error:', err);
    throw err;
  }
}

/**
 * Mark an assignment completed and optionally add completed_at (if you add the column later).
 */
async function markCompleted(assignmentId) {
  return updateAssignmentStatus(assignmentId, 'COMPLETED');
}

/**
 * Mark an assignment overdue
 */
async function markOverdue(assignmentId) {
  return updateAssignmentStatus(assignmentId, 'OVERDUE');
}

/**
 * Get assignment by id
 */
async function getAssignmentById(assignmentId) {
  try {
    const [rows] = await pool.query('SELECT * FROM assignments WHERE id = ? LIMIT 1', [assignmentId]);
    return rows && rows.length ? rows[0] : null;
  } catch (err) {
    console.error('[Assignments] getAssignmentById error:', err);
    throw err;
  }
}

/**
 * Find current assignment for an issue by role (e.g., role = 'supervisor')
 */
async function findAssignmentByIssueAndRole(issueId, role) {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM assignments WHERE issue_id = ? AND role_assigned = ? ORDER BY created_at DESC LIMIT 1',
      [issueId, role]
    );
    return rows && rows.length ? rows[0] : null;
  } catch (err) {
    console.error('[Assignments] findAssignmentByIssueAndRole error:', err);
    throw err;
  }
}

/**
 * Utility: compute deadline Date object based on department total days and fractional share.
 * - totalDays: number (e.g., 3)
 * - fractionEnd: float value between 0 and 1 representing the fraction of total time until this role's deadline.
 * e.g., for supervisor fractionEnd could be 0.5 meaning deadline = created_at + totalDays*0.5
 */
function computeDeadlineFromTotalDays(totalDays, fractionEnd) {
  const ms = totalDays * 24 * 60 * 60 * 1000 * fractionEnd;
  return new Date(Date.now() + ms);
}

module.exports = {
  createAssignment,
  findUserByRoleAndDept,
  getPendingAssignments,
  getOverdueAssignments,
  updateAssignmentStatus,
  markCompleted,
  markOverdue,
  getAssignmentById,
  findAssignmentByIssueAndRole,
  computeDeadlineFromTotalDays,
};
