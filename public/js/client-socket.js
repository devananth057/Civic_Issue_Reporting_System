// Socket.io script
// public/js/client-socket.js
const socket = io();
socket.on('issueUpdated', (d)=> console.log('issueUpdated', d));
socket.on('issueCreated', (d)=> console.log('issueCreated', d));
socket.on('issueDeleted', (d)=> console.log('issueDeleted', d));
