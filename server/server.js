require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const cors = require('cors');
 
const authRoutes = require('./controllers/auth');
const usersRoutes = require('./controllers/users');
const { router: issuesRouter } = require('./controllers/issues');
const feedbackRoutes = require('./controllers/feedback');
const adminRoutes = require('./controllers/admin');
const pool = require('./db'); // make sure pool is imported



const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const auditRoutes = require('./routes/audit');
app.use('/audit', auditRoutes);

const {
  startEscalationScheduler,
  startCountdownBroadcaster
} = require('./utils/escalation');


// Serve uploads & public
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/issues', issuesRouter);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/admin', adminRoutes);
// server + socket.io
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server, { cors: { origin: '*' } });
app.set('io', io);

// 🔥 START ESCALATION & COUNTDOWN (ONLY ONCE, CORRECT)
startEscalationScheduler(io);
startCountdownBroadcaster(io);


// ------------------ Auto escalation ------------------


// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Civic Portal server running on http://localhost:${PORT}`));
