// server/seed_users.js
require('dotenv').config();
const pool = require('./db');
const bcrypt = require('bcryptjs');

async function seed() {
  try {
    await pool.query('INSERT IGNORE INTO departments (id, name) VALUES (1,"Water"),(2,"Sanitation"),(3,"PWD"),(4,"Electricity")');

    const users = [
      { name:'Deva Citizen', phone:'9000000001', pass:'citizen123', role:'citizen', ward:'Ward-1', department_id:null, lat:12.9716, lon:77.5946 },
      { name:'Head Water', phone:'9000000002', pass:'head123', role:'head', ward:'Ward-1', department_id:1 },
      { name:'Supervisor Water', phone:'9000000003', pass:'super123', role:'supervisor', ward:'Ward-1', department_id:1 },
      { name:'Field Worker Water', phone:'9000000004', pass:'field123', role:'fieldworker', ward:'Ward-1', department_id:1 },
      { name:'Head Sanitation', phone:'9000000010', pass:'head123', role:'head', ward:'Ward-1', department_id:2 },
      { name:'Supervisor Sanitation', phone:'9000000011', pass:'super123', role:'supervisor', ward:'Ward-1', department_id:2 },
      { name:'Field Worker Sanitation', phone:'9000000012', pass:'field123', role:'fieldworker', ward:'Ward-1', department_id:2 },
      { name:'Head PWD', phone:'9000000020', pass:'head123', role:'head', ward:'Ward-1', department_id:3 },
      { name:'Supervisor PWD', phone:'9000000021', pass:'super123', role:'supervisor', ward:'Ward-1', department_id:3 },
      { name:'Field Worker PWD', phone:'9000000022', pass:'field123', role:'fieldworker', ward:'Ward-1', department_id:3 },
      { name:'Head Electricity', phone:'9000000030', pass:'head123', role:'head', ward:'Ward-1', department_id:4 },
      { name:'Supervisor Electricity', phone:'9000000031', pass:'super123', role:'supervisor', ward:'Ward-1', department_id:4 },
      { name:'Field Worker Electricity', phone:'9000000032', pass:'field123', role:'fieldworker', ward:'Ward-1', department_id:4 }
    ];
    for (const u of users) {
      const [r] = await pool.query('SELECT id FROM users WHERE phone = ?', [u.phone]);
      if (r.length) continue;
      const hash = await bcrypt.hash(u.pass, 10);
      await pool.query('INSERT INTO users (name, phone, password_hash, role, ward, department_id, is_verified, latitude, longitude) VALUES (?,?,?,?,?,?,?,?,?)',
        [u.name, u.phone, hash, u.role, u.ward, u.department_id, 1, u.lat || null, u.lon || null]);
      console.log('Inserted', u.phone);
    }
    console.log('Seeding finished'); process.exit(0);
  } catch (err) {
    console.error(err); process.exit(1);
  }
}

seed();
