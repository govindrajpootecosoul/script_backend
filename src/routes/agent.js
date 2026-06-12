const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const {
  touchAgentHeartbeat,
  claimPendingCommands,
} = require('../lib/agentPresence');

function createAgentRoutes({ applyScriptStatus }) {
  const router = express.Router();
  router.use(authMiddleware);

  /** REST fallback for Vercel — Socket.io sessions do not stick across serverless instances. */
  router.post('/heartbeat', async (req, res) => {
    try {
      await touchAgentHeartbeat(req.userId);
      const commands = await claimPendingCommands(req.userId);
      res.json({
        ok: true,
        commands,
        command: commands[0] || null,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Heartbeat failed' });
    }
  });

  router.post('/script-status', async (req, res) => {
    try {
      const { scriptId, status, error } = req.body || {};
      const result = await applyScriptStatus(req.userId, { scriptId, status, error });
      if (!result.ok) {
        return res.status(400).json({ error: result.error });
      }
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to update script status' });
    }
  });

  return router;
}

module.exports = { createAgentRoutes };
