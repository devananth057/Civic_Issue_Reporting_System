const pool = require('../db');

function startCountdownBroadcaster(io) {
  if (!io) {
    console.log('[Countdown] Socket.io not initialized!');
    return;
  }

  console.log('[Countdown] Broadcaster started ✅');

  setInterval(async () => {
    try {
      const [rows] = await pool.query(`
        SELECT issue_id, role_assigned AS role, deadline
        FROM assignments
        WHERE deadline IS NOT NULL
      `);

      const now = Date.now();
      const payload = rows.map(r => ({
        issueId: r.issue_id,
        role: r.role,
        secondsLeft: Math.floor((new Date(r.deadline).getTime() - now) / 1000)
      }));

      io.emit('deadlineTick', payload);
    } catch (err) {
      console.error('[Countdown] Error broadcasting:', err);
    }
  }, 1000); // update every second
}

module.exports = { startCountdownBroadcaster };
