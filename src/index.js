require('dotenv').config();
const os = require('os');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const { connectDb } = require('./db');
const authRoutes = require('./routes/auth');
const scriptsRoutes = require('./routes/scripts');
const Script = require('./models/Script');
const { verifySocketToken } = require('./middleware/auth');

const PORT = Number(process.env.PORT) || 3000;
const LISTEN_HOST = process.env.LISTEN_HOST || '0.0.0.0';

function lanIPv4Addresses() {
  const out = [];
  for (const nets of Object.values(os.networkInterfaces())) {
    if (!nets) continue;
    for (const n of nets) {
      if (n.family === 'IPv4' && !n.internal) out.push(n.address);
    }
  }
  return out;
}

/** Comma-separated list, e.g. http://localhost:5173,http://192.168.1.5:5173 */
const CORS_ORIGINS = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function isPrivateLanHttpOrigin(origin) {
  if (!origin || !origin.startsWith('http://')) return false;
  try {
    const { hostname } = new URL(origin);
    if (hostname === 'localhost' || hostname === '127.0.0.1') return false;
    const parts = hostname.split('.').map((x) => Number(x));
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false;
    const [a, b] = parts;
    if (a === 192 && b === 168) return true;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    return false;
  } catch {
    return false;
  }
}

function allowCorsOrigin(origin, callback) {
  if (!origin) return callback(null, true);
  if (CORS_ORIGINS.includes(origin)) return callback(null, true);
  if (origin.startsWith('http://localhost:')) return callback(null, true);
  if (origin.startsWith('http://127.0.0.1:')) return callback(null, true);
  if (origin.startsWith('file://')) return callback(null, true);
  if (process.env.ALLOW_PRIVATE_LAN_CORS === 'true' && isPrivateLanHttpOrigin(origin)) {
    return callback(null, true);
  }
  callback(null, true);
}

/** @type {Map<string, import('socket.io').Socket>} userId -> agent socket */
const agentSockets = new Map();

/** Debounce auto-idle after success/failed so the UI never stays "stuck" and runs can repeat. */
const idleResetTimers = new Map();

function clearIdleResetTimer(scriptId) {
  const key = String(scriptId);
  const prev = idleResetTimers.get(key);
  if (prev) clearTimeout(prev);
  idleResetTimers.delete(key);
}

function scheduleAutoIdleAfterTerminal(scriptId, userId, terminalStatus) {
  const key = String(scriptId);
  clearIdleResetTimer(key);
  const delayMs = terminalStatus === 'success' ? 2000 : 5000;
  const t = setTimeout(async () => {
    idleResetTimers.delete(key);
    try {
      const s = await Script.findOne({ _id: scriptId, userId });
      if (!s) return;
      if (terminalStatus === 'success' && s.status !== 'success') return;
      if (terminalStatus === 'failed' && s.status !== 'failed') return;
      s.status = 'idle';
      s.lastError = '';
      await s.save();
      io.to(`user:${userId}`).emit('script_status', { scriptId: key, status: 'idle' });
    } catch (e) {
      console.error(e);
    }
  }, delayMs);
  idleResetTimers.set(key, t);
}

const app = express();
app.use(cors({ origin: allowCorsOrigin, credentials: true }));
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/scripts', scriptsRoutes);

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: allowCorsOrigin,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  const payload = verifySocketToken(token);
  if (!payload) {
    return next(new Error('Unauthorized'));
  }
  socket.userId = payload.userId;
  socket.clientType = socket.handshake.auth?.clientType === 'agent' ? 'agent' : 'web';
  next();
});

io.on('connection', (socket) => {
  const { userId, clientType } = socket;

  if (clientType === 'agent') {
    agentSockets.set(userId, socket);
    socket.join(`user:${userId}`);
    console.log(`Agent online: user ${userId}`);
    io.emit('agent_presence', { userId, online: true });
  } else {
    socket.join(`user:${userId}`);
    socket.emit('agent_presence', { userId, online: agentSockets.has(userId) });
  }

  socket.on('RUN_SCRIPT', async ({ scriptId }, ack) => {
    try {
      if (!scriptId || !mongoose.isValidObjectId(scriptId)) {
        ack?.({ ok: false, error: 'Invalid scriptId' });
        return;
      }
      const script = await Script.findOne({ _id: scriptId, userId });
      if (!script) {
        ack?.({ ok: false, error: 'Script not found' });
        return;
      }
      clearIdleResetTimer(script._id.toString());
      const agent = agentSockets.get(userId);
      if (!agent || !agent.connected) {
        ack?.({ ok: false, error: 'Agent offline — start the Electron app and sign in.' });
        return;
      }
      script.status = 'running';
      script.lastError = '';
      await script.save();
      io.to(`user:${userId}`).emit('script_status', {
        scriptId: script._id.toString(),
        status: 'running',
      });
      agent.emit('EXECUTE_COMMAND', {
        scriptId: script._id.toString(),
        name: script.name,
        path: script.path,
        type: script.type,
      });
      ack?.({ ok: true });
    } catch (e) {
      console.error(e);
      ack?.({ ok: false, error: 'Server error' });
    }
  });

  socket.on('SCRIPT_STATUS', async ({ scriptId, status, error: errMsg }) => {
    if (socket.clientType !== 'agent') return;
    if (!scriptId || !mongoose.isValidObjectId(scriptId)) return;
    const allowed = ['running', 'success', 'failed', 'idle'];
    if (!allowed.includes(status)) return;
    try {
      const script = await Script.findOne({ _id: scriptId, userId });
      if (!script) return;
      script.status = status;
      if (status === 'failed' && errMsg) {
        script.lastError = String(errMsg).slice(0, 2000);
      }
      if (status === 'success' || status === 'idle') {
        script.lastError = '';
      }
      await script.save();
      io.to(`user:${userId}`).emit('script_status', {
        scriptId,
        status,
        error: errMsg || script.lastError,
      });
      if (status === 'success' || status === 'failed') {
        scheduleAutoIdleAfterTerminal(scriptId, userId, status);
      }
      if (status === 'idle') {
        clearIdleResetTimer(scriptId);
      }
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('disconnect', () => {
    if (clientType === 'agent' && agentSockets.get(userId) === socket) {
      agentSockets.delete(userId);
      console.log(`Agent offline: user ${userId}`);
      io.emit('agent_presence', { userId, online: false });
    }
  });
});

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('Missing MONGODB_URI in .env');
    process.exit(1);
  }
  if (!process.env.JWT_SECRET) {
    console.error('Missing JWT_SECRET in .env');
    process.exit(1);
  }
  await connectDb(uri);
  console.log('MongoDB connected — database:', mongoose.connection.name);
  server.listen(PORT, LISTEN_HOST, () => {
    console.log(`HTTP + Socket.io listening on http://localhost:${PORT} (bind ${LISTEN_HOST})`);
    const ips = lanIPv4Addresses();
    if (ips.length) {
      console.log('This PC IPv4 (use these from other devices on same Wi‑Fi):');
      for (const ip of ips) {
        console.log(`  http://${ip}:${PORT}/health`);
      }
    } else {
      console.log('LAN: use this machine IPv4 + port, e.g. http://<YOUR_IP>:' + PORT);
    }
    console.log(
      'If another PC/phone cannot open those URLs: allow inbound TCP ' +
        PORT +
        ' in Windows Firewall on THIS machine (see script_control/scripts/open-windows-lan-ports.ps1).'
    );
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
