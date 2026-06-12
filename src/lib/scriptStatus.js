const mongoose = require('mongoose');
const Script = require('../models/Script');

function createScriptStatusHandlers({ io, scheduleAutoIdleAfterTerminal, clearIdleResetTimer }) {
  return async function applyScriptStatus(userId, { scriptId, status, error: errMsg }) {
    if (!scriptId || !mongoose.isValidObjectId(scriptId)) return { ok: false, error: 'Invalid scriptId' };
    const allowed = ['running', 'success', 'failed', 'idle'];
    if (!allowed.includes(status)) return { ok: false, error: 'Invalid status' };
    const script = await Script.findOne({ _id: scriptId, userId });
    if (!script) return { ok: false, error: 'Script not found' };
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
    return { ok: true };
  };
}

module.exports = { createScriptStatusHandlers };
