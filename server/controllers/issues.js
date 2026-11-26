// server/controllers/issues.js
const express = require('express');
const router = express.Router();
const pool = require('../db');
const auth = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const { predictCategory } = require('../ai/classifier');
const notify = require('../utils/notify');

// Multer setup for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'uploads')),
  filename: (req, file, cb) => cb(null, Date.now() + '_' + file.originalname)
});
const upload = multer({ storage });

// Default department deadlines
const DEPT_DEADLINES = { water: 3, sanitation: 3, pwd: 4, electricity: 2 };

// Compute priority based on department & description
function computePriority(deptId, description) {
  if (!description) return 'MEDIUM';
  const d = description.toLowerCase();
  if (d.includes('sewer') || d.includes('sewage') || deptId == 2) return 'HIGH';
  if (d.includes('leak') || d.includes('water')) return 'HIGH';
  if (d.includes('light') || d.includes('electric')) return 'HIGH';
  if (d.includes('road') || d.includes('pothole')) return 'MEDIUM';
  return 'MEDIUM';
}

// Fetch department total days from DB
async function getDeptTotalDays(department_id) {
  try {
    const [rows] = await pool.query('SELECT name, total_deadline_days FROM departments WHERE id=?', [department_id]);
    if (!rows.length) return 3;
    const row = rows[0];
    if (row.total_deadline_days != null && row.total_deadline_days > 0) return row.total_deadline_days;
    return DEPT_DEADLINES[(row.name || '').toLowerCase()] || 3;
  } catch (err) {
    console.error('[Issues] getDeptTotalDays error:', err);
    return 3;
  }
}

// ------------------- Helper: mark user busy/free -------------------
async function markUserBusy(userId) {
  if (!userId) return;
  try {
    await pool.query('UPDATE users SET isBusy=1 WHERE id=?', [userId]);
  } catch (err) {
    console.error('[markUserBusy] error for user', userId, err);
  }
}

async function markUserFree(userId) {
  if (!userId) return;
  try {
    await pool.query('UPDATE users SET isBusy=0 WHERE id=?', [userId]);
  } catch (err) {
    console.error('[markUserFree] error for user', userId, err);
  }
}

// Mark all assignees of an issue free (used on resolve/delete)
async function freeAssigneesForIssue(issueId) {
  try {
    const [assignments] = await pool.query('SELECT assignee_id FROM assignments WHERE issue_id=?', [issueId]);
    for (const a of assignments) {
      if (a.assignee_id) {
        await markUserFree(a.assignee_id);
      }
    }
  } catch (err) {
    console.error('[freeAssigneesForIssue] error', err);
  }
}

// ------------------- Escalation -------------------
async function escalateIssue(issueId) {
  try {
    // ⛔ DO NOT ESCALATE IF ALL ASSIGNMENTS ARE FROZEN
    const [[active]] = await pool.query(`
      SELECT 1
      FROM assignments
      WHERE issue_id = ?
        AND is_frozen = 0
      LIMIT 1
    `, [issueId]);

    if (!active) return; // SAFE EXIT

    const [[issue]] = await pool.query(
      'SELECT status FROM issues WHERE id=?',
      [issueId]
    );

    if (!issue) return;

    if (['ASSIGNED', 'IN_PROGRESS'].includes(issue.status)) {

      await pool.query(
        'UPDATE issues SET status="ESCALATED" WHERE id=?',
        [issueId]
      );

      await pool.query(
        'INSERT INTO audit_logs (user_id, action, issue_id) VALUES (?,?,?)',
        [null, 'AUTO_ESCALATED', issueId]
      );

      notify.emit(null, 'issueUpdated', { issueId, status: 'ESCALATED' });
      console.log(`[Escalation] Issue ${issueId} escalated.`);
    }
  } catch (err) {
    console.error('[Escalation] Failed:', err);
  }
}


// ------------------- Routes -------------------

// Citizen reports issue
router.post('/report', auth, upload.single('image'), async (req, res) => {
  try {
    if (req.user.role !== 'citizen') return res.status(403).json({ error: 'Only citizens can report' });

    let { title, description, department_id, latitude, longitude, address } = req.body;
    latitude = latitude ? parseFloat(latitude) : null;
    longitude = longitude ? parseFloat(longitude) : null;

    if (!department_id || department_id === 'null' || department_id === '') {
      const pred = predictCategory((title || '') + ' ' + (description || ''));
      department_id = pred.department_id;
    } else department_id = parseInt(department_id);

    const image_path = req.file ? '/uploads/' + req.file.filename : null;
    const priority = computePriority(department_id, description);

    const [result] = await pool.query(
      `INSERT INTO issues 
       (citizen_id, department_id, title, description, image_path, address, latitude, longitude, priority, status, created_at, deleted_by_head, head_delete_reason)
       VALUES (?,?,?,?,?,?,?,?,?,? ,NOW(), 0, NULL)`,
      [req.user.id, department_id, title || null, description || null, image_path, address || null, latitude, longitude, priority, 'NEW']
    );
    const issueId = result.insertId;

    await pool.query(
      'INSERT INTO audit_logs (user_id, action, issue_id, old_status, new_status) VALUES (?,?,?,?,?)',
      [req.user.id, 'REPORT_CREATED', issueId, null, 'NEW']
    );

    // Auto assign head
    try {
      const totalDays = await getDeptTotalDays(department_id);
      const [heads] = await pool.query('SELECT id FROM users WHERE role="head" AND department_id=? LIMIT 1', [department_id]);
      const headId = heads.length ? heads[0].id : null;
      if (headId) {
        const intervalDays = Math.ceil(totalDays);
        await pool.query(
          `INSERT INTO assignments (issue_id, assigned_by, assignee_id, role_assigned, deadline, status, created_at)
           VALUES (?, ?, ?, ?, NOW() + INTERVAL ? DAY, ?, NOW())`,
          [issueId, req.user.id, headId, 'head', intervalDays, 'PENDING']
        );
        // Note: heads are not considered "busy" for assignment in this system by default.
      }
    } catch (e) {
      console.error('[Issues] Head assignment failed', e);
    }

    notify.emit(req.app, 'issueCreated', { issueId, department_id, title, status: 'NEW' });
    res.json({ success: true, issueId, message: 'Reported successfully and sent to department head' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create issue' });
  }
});

// List issues with button visibility
router.get('/', auth, async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    let q = `SELECT 
  i.*,
  u.name AS citizen_name,
  d.name AS department_name,

  /* supervisor name */
  (SELECT u2.name
   FROM users u2
   JOIN assignments a ON a.assignee_id = u2.id
   WHERE a.issue_id = i.id
     AND a.role_assigned = 'supervisor'
   ORDER BY a.created_at DESC
   LIMIT 1
  ) AS supervisor_name,

  /* fieldworker count */
  (SELECT COUNT(*)
   FROM assignments a
   WHERE a.issue_id = i.id
     AND a.role_assigned = 'fieldworker' AND a.is_frozen = 0
  ) AS fieldworker_count,

  /* 🔥 SUPERVISOR DEADLINE SECONDS */
  (SELECT TIMESTAMPDIFF(
      SECOND,
      NOW(),
      a.deadline
   )
   FROM assignments a
   WHERE a.issue_id = i.id
     AND a.role_assigned = 'supervisor' 
     AND a.is_frozen = 0
   ORDER BY a.created_at DESC
   LIMIT 1
  ) AS supervisor_seconds,

/* 🔥 FIELDWORKER DEADLINE SECONDS */
(SELECT TIMESTAMPDIFF(
    SECOND,
    NOW(),
    a.deadline
 )
 FROM assignments a
 WHERE a.issue_id = i.id
   AND a.role_assigned = 'fieldworker'
   AND a.is_frozen = 0
 ORDER BY a.created_at DESC
 LIMIT 1
) AS fieldworker_seconds


FROM issues i
JOIN users u ON u.id = i.citizen_id
JOIN departments d ON d.id = i.department_id

      `;
    const params = [];

    if (req.user.role === 'citizen') {
      q += ' WHERE (i.citizen_id=? OR i.deleted_by_head=1)';
      params.push(req.user.id);
    } else if (req.user.role === 'head') {
      q += ' WHERE i.department_id=?';
      params.push(req.user.department_id);
    } else if (req.user.role === 'supervisor') {
      q += ' WHERE i.department_id=? AND i.id IN (SELECT issue_id FROM assignments WHERE assignee_id=?)';
      params.push(req.user.department_id, req.user.id);
    } else if (req.user.role === 'fieldworker') {
      q += ' WHERE i.id IN (SELECT issue_id FROM assignments WHERE assignee_id=?)';
      params.push(req.user.id);
    } else q += ' WHERE 1';

    q += ' ORDER BY i.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

    const [rows] = await pool.query(q, params);

    // Compute button visibility
    const issues = rows.map(i => {
 const minutesPassed =
  (Date.now() - new Date(i.created_at).getTime()) / 60000;

const isDeleted = i.deleted_by_head === 1;

const buttons = {
  canDelete:
    !isDeleted &&
    (
      (req.user.role === 'citizen' &&
        i.status === 'NEW' &&
        minutesPassed <= 30) ||
      req.user.role === 'head'
    ),

/* ✅ HEAD CAN ASSIGN SUPERVISOR */
  canAssignSupervisor:
    req.user.role === 'head' &&
    !isDeleted &&
    (
      i.status === 'NEW' ||
      (
        i.status === 'ESCALATED' &&
        i.supervisor_seconds <= 0   // 👈 ONLY AFTER SUPERVISOR DEADLINE
      )
    ),

  /* ✅ SUPERVISOR CAN ASSIGN FIELDWORKER */
  canAssignFieldworker:
    req.user.role === 'supervisor' &&
    !isDeleted &&
    (
      (i.status === 'ASSIGNED' && i.fieldworker_count === 0) ||
      (
        i.status === 'ESCALATED' &&
        i.fieldworker_seconds <= 0 &&   // 👈 FIELDWORKER DEADLINE OVER
        i.supervisor_seconds > 0        // 👈 SUPERVISOR STILL ACTIVE
      )
    ),

  canMarkComplete:
    req.user.role === 'fieldworker' &&
    !isDeleted &&
    i.status === 'IN_PROGRESS',

  canVerify:
    req.user.role === 'supervisor' &&
    !isDeleted &&
    i.status === 'VERIFICATION'
};
      return { ...i, buttons };
    });

    res.json({ success: true, issues });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch issues' });
  }
});

// Head assigns supervisor
router.post('/assignSupervisor', auth, async (req, res) => {
  try {
    if (req.user.role !== 'head') return res.status(403).json({ error: 'Only head can assign supervisors' });
    const { issueId, phone, deadline } = req.body;
    if (!issueId || !phone) return res.status(400).json({ error: 'Missing fields' });

    const [rows] = await pool.query('SELECT id FROM users WHERE phone=? AND role="supervisor" AND department_id=?', [phone, req.user.department_id]);
    if (!rows.length) return res.status(404).json({ error: 'Supervisor not found' });
    const supId = rows[0].id;

    // Free any previously assigned supervisor for this issue (reassign case)
    try {
      const [prev] = await pool.query('SELECT assignee_id FROM assignments WHERE issue_id=? AND role_assigned="supervisor" ORDER BY created_at DESC LIMIT 1', [issueId]);
      if (prev && prev.length && prev[0].assignee_id && prev[0].assignee_id !== supId) {
        await markUserFree(prev[0].assignee_id);
      }
    } catch (e) {
      // non-fatal
    }

    const totalDays = await getDeptTotalDays(req.user.department_id);
  const finalDeadline = deadline && deadline.trim()
  ? new Date(deadline)
  : null;
const intervalDays = Math.ceil(totalDays * 0.5);

await pool.query(
  `INSERT INTO assignments
   (issue_id, assigned_by, assignee_id, role_assigned, deadline, status, created_at)
   VALUES (?, ?, ?, ?, COALESCE(?, NOW() + INTERVAL ? DAY), ?, NOW())`,
  [
    issueId,
    req.user.id,
    supId,
    'supervisor',
    finalDeadline,
    intervalDays,
    'PENDING'
  ]
);
    // mark supervisor busy
    await markUserBusy(supId);

    const [[old]] = await pool.query('SELECT status FROM issues WHERE id=?', [issueId]);
    await pool.query('UPDATE issues SET status=? WHERE id=?', ['ASSIGNED', issueId]);
    await pool.query('INSERT INTO audit_logs (user_id, action, issue_id, old_status, new_status) VALUES (?,?,?,?,?)',
      [req.user.id, 'ASSIGNED_SUPERVISOR', issueId, old ? old.status : null, 'ASSIGNED']);

    notify.emit(req.app, 'issueUpdated', { issueId });
    res.json({ success: true, message: 'Supervisor assigned successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to assign supervisor' });
  }
});

// Supervisor assigns fieldworker
// Supervisor assigns fieldworker (WITH DEADLINE CAP)
router.post('/assignFieldworker', auth, async (req, res) => {
  try {
    if (req.user.role !== 'supervisor')
      return res.status(403).json({ error: 'Only supervisors can assign fieldworkers' });

    const { issueId, phone, deadline } = req.body;
    if (!issueId || !phone || !deadline)
      return res.status(400).json({ error: 'Issue, phone and deadline required' });

    // 1️⃣ Get supervisor deadline
    const [[supAssign]] = await pool.query(`
      SELECT deadline
      FROM assignments
      WHERE issue_id = ?
        AND role_assigned = 'supervisor'
        AND is_frozen = 0
      ORDER BY created_at DESC
      LIMIT 1
    `, [issueId]);

    if (!supAssign)
      return res.status(400).json({ error: 'Supervisor deadline not found' });

    const supervisorDeadline = new Date(supAssign.deadline);
    const fieldworkerDeadline = new Date(deadline);

    // 2️⃣ Enforce deadline cap
    if (fieldworkerDeadline > supervisorDeadline) {
      return res.status(400).json({
        error: 'Fieldworker deadline must be within supervisor deadline'
      });
    }

    // 3️⃣ Find fieldworker
    const [rows] = await pool.query(
      'SELECT id FROM users WHERE phone=? AND role="fieldworker" AND department_id=?',
      [phone, req.user.department_id]
    );
    if (!rows.length)
      return res.status(404).json({ error: 'Fieldworker not found' });

    const fwId = rows[0].id;

    // 4️⃣ Insert assignment
    await pool.query(`
      INSERT INTO assignments
      (issue_id, assigned_by, assignee_id, role_assigned, deadline, status, created_at)
      VALUES (?, ?, ?, 'fieldworker', ?, 'PENDING', NOW())
    `, [issueId, req.user.id, fwId, fieldworkerDeadline]);

    await markUserBusy(fwId);

    await pool.query(
      'UPDATE issues SET status="IN_PROGRESS" WHERE id=?',
      [issueId]
    );

    await pool.query(
      'INSERT INTO audit_logs (user_id, action, issue_id) VALUES (?,?,?)',
      [req.user.id, 'ASSIGNED_FIELDWORKER', issueId]
    );

    notify.emit(req.app, 'issueUpdated', { issueId });

    res.json({
      success: true,
      message: 'Fieldworker assigned within supervisor deadline'
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to assign fieldworker' });
  }
});


// Fieldworker marks complete
router.post('/complete', auth, upload.single('image'), async (req, res) => {
  try {
    if (req.user.role !== 'fieldworker')
      return res.status(403).json({ error: 'Only fieldworkers can complete tasks' });

    const { issueId } = req.body;
    if (!issueId) return res.status(400).json({ error: 'Missing issueId' });

    if (!req.file)
      return res.status(400).json({ error: 'Photo upload is mandatory' });

    const image_path = '/uploads/' + req.file.filename;

    const [[old]] = await pool.query(
      'SELECT status FROM issues WHERE id=?',
      [issueId]
    );

    /* 🔒 FREEZE FIELDWORKER TIMER */
    await pool.query(`
      UPDATE assignments
      SET is_frozen = 1
      WHERE issue_id = ?
        AND role_assigned = 'fieldworker'
    `, [issueId]);

    await pool.query(
      'UPDATE issues SET image_path=?, status=? WHERE id=?',
      [image_path, 'VERIFICATION', issueId]
    );

    await pool.query(
      `INSERT INTO audit_logs (user_id, action, issue_id, old_status, new_status)
       VALUES (?,?,?,?,?)`,
      [req.user.id, 'FIELDWORK_COMPLETE', issueId, old?.status, 'VERIFICATION']
    );

    notify.emit(req.app, 'issueUpdated', { issueId });

    res.json({
      success: true,
      message: 'Work completed. Timer frozen & sent for verification'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to mark complete' });
  }
});


// Supervisor verification
router.post('/verifyBySupervisor', auth, async (req, res) => {
  try {
    if (req.user.role !== 'supervisor')
      return res.status(403).json({ error: 'Not allowed' });

    const { issueId } = req.body;

    /* 🔒 FREEZE SUPERVISOR TIMER */
    await pool.query(`
      UPDATE assignments
      SET is_frozen = 1
      WHERE issue_id = ?
        AND role_assigned = 'supervisor'
    `, [issueId]);

    await pool.query(
      'UPDATE issues SET resolved_by_supervisor=1 WHERE id=?',
      [issueId]
    );

    const [[row]] = await pool.query(
      'SELECT resolved_by_citizen FROM issues WHERE id=?',
      [issueId]
    );

    if (row?.resolved_by_citizen) {
      await pool.query(
        'UPDATE issues SET status="RESOLVED" WHERE id=?',
        [issueId]
      );
      await pool.query(`
  UPDATE assignments
  SET is_frozen = 1
  WHERE issue_id = ?
`, [issueId]);


      await onIssueResolved(issueId);
      notify.emit(req.app, 'issueResolved', { issueId });
    }

    res.json({
      success: true,
      message: 'Verified. Supervisor timer frozen'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Verification failed' });
  }
});


// Citizen verification
router.post('/verifyByCitizen', auth, async (req, res) => {
  await pool.query(
    'UPDATE issues SET resolved_by_citizen=1 WHERE id=?',
    [req.body.issueId]
  );

  const [[row]] = await pool.query(
    'SELECT resolved_by_supervisor FROM issues WHERE id=?',
    [req.body.issueId]
  );

  if (row.resolved_by_supervisor) {
    await pool.query(
      'UPDATE issues SET status="RESOLVED" WHERE id=?',
      [req.body.issueId]
    );

    await pool.query(`
  UPDATE assignments
  SET is_frozen = 1
  WHERE issue_id = ?
`, [req.body.issueId]);


    await onIssueResolved(req.body.issueId);
    notify.emit(req.app, 'issueResolved', { issueId: req.body.issueId });

    return res.json({
      success: true,
      message: 'Issue verified and resolved successfully'
    });
  }

  return res.json({
    success: true,
    message: 'Citizen verification completed'
  });
});

/* =========================================================
   DELETE ISSUE (HEAD + CITIZEN)
========================================================= */
router.delete('/:id', auth, async (req, res) => {
  const issueId = req.params.id;

if (req.user.role === 'head') {
  const { reason } = req.body || {};

  if (!reason || !reason.trim()) {
    return res.status(400).json({ error: 'Delete reason required' });
  }

  await pool.query(
    `UPDATE issues
     SET status="DELETED",
         deleted_by_head=1,
         head_delete_reason=?
     WHERE id=?`,
    [reason.trim(), issueId]
  );

  await onIssueResolved(issueId);

  return res.json({
    success: true,
    message: 'Issue deleted by Head'
  });
}

if (req.user.role === 'citizen') {
  const [[row]] = await pool.query(
    'SELECT created_at,status FROM issues WHERE id=? AND citizen_id=?',
    [issueId, req.user.id]
  );
  if (!row) return res.status(404).json({ error: 'Not found' });

  const mins = (Date.now() - new Date(row.created_at)) / 60000;
  if (row.status !== 'NEW' || mins > 30)
    return res.status(400).json({ error: 'Delete window expired' });

  await pool.query(`
  UPDATE issues
  SET status="DELETED",
      deleted_by_head=0,
      head_delete_reason="Deleted by citizen"
  WHERE id=?
`, [issueId]);

await onIssueResolved(issueId);

return res.json({
  success: true,
  message: 'Issue deleted successfully'
});

}



  res.status(403).json({ error: 'Not allowed' });
});


async function recalculateUserBusyStateForUser(userId) {
  try {
    const [[row]] = await pool.query(`
      SELECT COUNT(*) AS activeCount
      FROM assignments a
      JOIN issues i ON i.id = a.issue_id
      WHERE a.assignee_id = ?
        AND i.status NOT IN ('RESOLVED', 'DELETED')
    `, [userId]);

    if (row.activeCount === 0) {
      await markUserFree(userId);   // 🟢 ACTIVE
    } else {
      await markUserBusy(userId);   // 🔵 WORKING
    }
  } catch (err) {
    console.error('[recalculateUserBusyStateForUser]', err);
  }
}
async function onIssueResolved(issueId) {
  try {
    const [assignees] = await pool.query(
      'SELECT DISTINCT assignee_id FROM assignments WHERE issue_id=?',
      [issueId]
    );

    for (const a of assignees) {
      await recalculateUserBusyStateForUser(a.assignee_id);
    }
  } catch (err) {
    console.error('[onIssueResolved]', err);
  }
}



// Reassign issue
router.post('/reassign', auth, async (req, res) => {
  try {
    const { issueId, phone, role } = req.body;
    if (!issueId || !phone || !role) return res.status(400).json({ error: 'Missing fields' });

    const [[issue]] = await pool.query('SELECT status, department_id FROM issues WHERE id=?', [issueId]);
    if (!issue) return res.status(404).json({ error: 'Issue not found' });
    if (issue.status !== 'ESCALATED') return res.status(403).json({ error: 'Can only reassign ESCALATED issues' });

    if (role === 'supervisor' && req.user.role !== 'head') return res.status(403).json({ error: 'Only head can assign supervisor' });
    if (role === 'fieldworker' && req.user.role !== 'supervisor') return res.status(403).json({ error: 'Only supervisor can assign fieldworker' });

    const [users] = await pool.query('SELECT id FROM users WHERE phone=? AND role=? AND department_id=?', [phone, role, issue.department_id]);
    if (!users.length) return res.status(404).json({ error: `${role} not found` });
    const assigneeId = users[0].id;

    // free previous assignee for that role (if any)
    try {
      const [prev] = await pool.query('SELECT assignee_id FROM assignments WHERE issue_id=? AND role_assigned=? ORDER BY created_at DESC LIMIT 1', [issueId, role]);
      if (prev && prev.length && prev[0].assignee_id && prev[0].assignee_id !== assigneeId) {
        await markUserFree(prev[0].assignee_id);
      }
    } catch (e) {
      // ignore
    }

    await pool.query(
      `INSERT INTO assignments (issue_id, assigned_by, assignee_id, role_assigned, deadline, status, created_at)
       VALUES (?, ?, ?, ?, NOW() + INTERVAL 1 DAY, ?, NOW())`,
      [issueId, req.user.id, assigneeId, role, 'PENDING']
    );

    // mark new assignee busy
    await markUserBusy(assigneeId);

    const newStatus = role === 'supervisor' ? 'ASSIGNED' : 'IN_PROGRESS';
    await pool.query('UPDATE issues SET status=? WHERE id=?', [newStatus, issueId]);
    await pool.query('INSERT INTO audit_logs (user_id, action, issue_id) VALUES (?,?,?)', [req.user.id, 'REASSIGNED', issueId]);

    notify.emit(req.app, 'issueUpdated', { issueId });
    res.json({ success: true, message: `Issue reassigned to ${role}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to reassign issue' });
  }
});

module.exports = {
  router,
  escalateIssue
};
