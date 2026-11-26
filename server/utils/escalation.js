  const pool = require('../db');
  const notify = require('./notify');

  /* =========================================================
    ESCALATION CHECK (ASSIGNMENT BASED)
    ========================================================= */
  async function runEscalationCheck(io) {
  try {
    const [rows] = await pool.query(`
      SELECT DISTINCT
        a.issue_id,
        a.role_assigned,
        i.status AS issue_status,
        d.name AS department_name
      FROM assignments a
      JOIN issues i ON i.id = a.issue_id
      JOIN departments d ON d.id = i.department_id
      WHERE a.status = 'PENDING'
        AND a.deadline < NOW()
        AND i.status IN ('ASSIGNED','IN_PROGRESS')
        AND a.is_frozen = 0

    `);

    for (const row of rows) {
      const { issue_id, role_assigned, department_name } = row;

      // HEAD NEVER ESCALATES
      if (role_assigned === 'head') continue;

      console.log(`[Escalation] Issue ${issue_id} escalated`);

      /* 1️⃣ Mark issue ESCALATED */
      await pool.query(
        `UPDATE issues SET status='ESCALATED' WHERE id=?`,
        [issue_id]
      );

      /* 2️⃣ Mark all assignments ESCALATED */
      await pool.query(
        `UPDATE assignments
SET status='ESCALATED'
WHERE issue_id=?
AND is_frozen = 0
`,
        [issue_id]
      );

      /* 3️⃣ FREE ALL ASSIGNEES (CRITICAL FIX) */
      const [assignees] = await pool.query(
        `SELECT DISTINCT assignee_id FROM assignments WHERE issue_id=? AND is_frozen = 0`,
        [issue_id]
      );

      for (const a of assignees) {
        await pool.query(
          `UPDATE users SET isBusy=0 WHERE id=?`,
          [a.assignee_id]
        );
      }

      /* 4️⃣ Log escalation */
      await pool.query(
        `
        INSERT INTO escalations (issue_id, from_role, to_role, reason)
        VALUES (?, ?, ?, ?)
        `,
        [
          issue_id,
          role_assigned,
          role_assigned === 'fieldworker' ? 'supervisor' : 'head',
          'Deadline missed'
        ]
      );

      /* 5️⃣ Notify UI */
      if (io) {
        io.emit('issueUpdated', { issueId: issue_id, status: 'ESCALATED' });
        io.emit('escalationAlert', {
          issueId: issue_id,
          role: role_assigned === 'fieldworker' ? 'supervisor' : 'head',
          departmentName:department_name
        });
      }
    }
  } catch (err) {
    console.error('[Escalation Engine]', err);
  }
}


  /* =========================================================
    START SCHEDULER
    ========================================================= */
  function startEscalationScheduler(io) {
    console.log('[Escalation] Scheduler started (30 sec)');
    runEscalationCheck(io);
    setInterval(() => runEscalationCheck(io), 30 * 1000);
  }

  /* =========================================================
    COUNTDOWN BROADCASTER
    ========================================================= */
  function startCountdownBroadcaster(io) {
    setInterval(async () => {
      try {
        const [rows] = await pool.query(`
          SELECT 
            a.issue_id,
            a.role_assigned,
            TIMESTAMPDIFF(SECOND, NOW(), a.deadline) AS seconds_left
          FROM assignments a
          JOIN issues i ON i.id = a.issue_id
        
            WHERE a.status = 'PENDING'
            AND i.status IN ('ASSIGNED','IN_PROGRESS')
            AND a.is_frozen = 0
            AND i.status NOT IN ('RESOLVED','DELETED')
        `);

        io.emit('deadlineTick', rows.map(r => ({
          issueId: r.issue_id,
          role: r.role_assigned,
          secondsLeft: r.seconds_left
        })));
      } catch (err) {
        console.error('[Countdown]', err);
      }
    }, 1000);
  }

  module.exports = {
    startEscalationScheduler,
    startCountdownBroadcaster
  };
