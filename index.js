/*
 * File: index.js
 * Role: Express + Socket.IO signaling server for peer discovery and signal forwarding.
 * Notes: Serves static files, returns local IP for QR flow, and relays WebRTC signaling messages.
 */
require('dotenv').config();
const isDevelopment = (process.env.NODE_ENV === 'development');
const express = require('express');
const app = express();
const fs = require('fs');
const os = require('os');

let options = {};
if (isDevelopment) {
  options = {
    key: fs.readFileSync('./localhost.key'),
    cert: fs.readFileSync('./localhost.crt')
  };
}

const server = require(isDevelopment ? 'https' : 'http').Server(options, app);
const port = process.env.PORT || 443;

app.use(express.static('public'));

const getNetworkIp = () => {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return null;
};

app.get('/api/ip', (req, res) => {
  const localIp = getNetworkIp();
  if (!localIp) {
    return res.status(503).json({ error: 'No network IPv4 address found' });
  }
  const protocol = isDevelopment ? 'https' : 'http';
  res.json({ ip: localIp, port, url: `${protocol}://${localIp}:${port}` });
});

server.listen(port, () => {
  const localIp = getNetworkIp();
  const protocol = isDevelopment ? 'https' : 'http';
  console.log(`App listening on port ${port}!`);
  if (localIp) {
    console.log(`Network: ${protocol}://${localIp}:${port}`);
  } else {
    console.warn('Network: unavailable (no non-internal IPv4 found)');
  }
});

const { Server } = require("socket.io");
const io = new Server(server);

const clients = {};
io.on('connection', socket => {
  clients[socket.id] = { id: socket.id };

  socket.on('disconnect', () => {
    io.emit('client-disconnect', clients[socket.id]);
    delete clients[socket.id];
    io.emit('clients', clients);
  });

  socket.on('signal', (peerId, signal) => {
    console.log(`Received signal from ${socket.id} to ${peerId}`);
    io.to(peerId).emit('signal', peerId, signal, socket.id);
  });

  io.emit('clients', clients);
});
