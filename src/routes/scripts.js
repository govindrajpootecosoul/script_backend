const express = require('express');
const Script = require('../models/Script');
const { authMiddleware } = require('../middleware/auth');
const { isAgentOnlineForUser, queueAgentCommand } = require('../lib/agentPresence');

function createScriptsRoutes({ agentSockets, applyScriptStatus }) {
const router = express.Router();

router.use(authMiddleware);

router.get('/', async (req, res) => {
  try {
    const scripts = await Script.find({ userId: req.userId }).sort({ updatedAt: -1 }).lean();
    res.json(
      scripts.map((s) => ({
        id: s._id.toString(),
        name: s.name,
        path: s.path,
        type: s.type,
        status: s.status,
        userId: s.userId.toString(),
        lastError: s.lastError || '',
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to list scripts' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, path, type } = req.body;
    if (!name || !path || !type) {
      return res.status(400).json({ error: 'name, path, and type are required' });
    }
    const allowed = ['python', 'nodejs', 'shell'];
    if (!allowed.includes(type)) {
      return res.status(400).json({ error: 'type must be python, nodejs, or shell' });
    }
    const script = await Script.create({
      name: String(name).trim(),
      path: String(path).trim(),
      type,
      status: 'idle',
      userId: req.userId,
    });
    res.status(201).json({
      id: script._id.toString(),
      name: script.name,
      path: script.path,
      type: script.type,
      status: script.status,
      userId: script.userId.toString(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create script' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await Script.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    if (!result) {
      return res.status(404).json({ error: 'Script not found' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete script' });
  }
});

/** REST run — used when Socket.io is unavailable (e.g. Vercel serverless). */
router.post('/:id/run', async (req, res) => {
  try {
    const script = await Script.findOne({ _id: req.params.id, userId: req.userId });
    if (!script) {
      return res.status(404).json({ error: 'Script not found' });
    }
    const online = await isAgentOnlineForUser(req.userId, agentSockets);
    if (!online) {
      return res.status(503).json({ error: 'Agent offline — start the Electron app and sign in.' });
    }
    await queueAgentCommand(req.userId, script);
    const statusResult = await applyScriptStatus(req.userId, {
      scriptId: script._id.toString(),
      status: 'running',
    });
    if (!statusResult.ok) {
      return res.status(400).json({ error: statusResult.error || 'Failed to update script status' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to run script' });
  }
});

return router;
}

module.exports = createScriptsRoutes;
