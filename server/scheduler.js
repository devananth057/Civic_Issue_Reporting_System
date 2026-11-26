const cron = require('node-cron');
const pool = require('./db');
const { escalateIssue } = require('./controllers/issues');

// Run every 10 minutes
cron.schedule('*/10 * * * *', async () => {
  console.log('[Scheduler] Checking for issues to escalate...');

  try {
    const [issues] = await pool.query(
      `SELECT i.id 
       FROM issues i
       JOIN assignments a ON a.issue_id=i.id
       WHERE i.status IN ('ASSIGNED', 'IN_PROGRESS')
         AND a.deadline < NOW()`
    );

    for (const issue of issues) {
      await escalateIssue(issue.id);
    }
  } catch (err) {
    console.error('[Scheduler] Error escalating issues:', err);
  }
});
