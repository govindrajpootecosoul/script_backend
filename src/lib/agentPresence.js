const User = require('../models/User');

const pendingCommandFields = {
  scriptId: String,
  name: String,
  path: String,
  scriptType: String,
  queuedAt: Date,
};

async function isAgentOnlineForUser(uid, agentSockets) {
  if (agentSockets && agentSockets.has(uid)) return true;
  const u = await User.findById(uid).select('agentHeartbeatAt').lean();
  const at = u && u.agentHeartbeatAt;
  return !!(at && Date.now() - new Date(at).getTime() < 25000);
}

async function touchAgentHeartbeat(userId) {
  await User.updateOne({ _id: userId }, { $set: { agentHeartbeatAt: new Date() } });
}

function normalizeCommand(raw) {
  if (!raw || !raw.scriptId) return null;
  return {
    scriptId: String(raw.scriptId),
    name: raw.name || '',
    path: raw.path || '',
    scriptType: raw.scriptType || raw.type || '',
    queuedAt: raw.queuedAt || null,
  };
}

/** Atomically take all queued commands (and legacy single-slot field if present). */
async function claimPendingCommands(userId) {
  const user = await User.findOneAndUpdate(
    {
      _id: userId,
      $or: [
        { 'pendingAgentCommands.0': { $exists: true } },
        { 'pendingAgentCommand.scriptId': { $exists: true, $ne: null } },
      ],
    },
    { $set: { pendingAgentCommands: [] }, $unset: { pendingAgentCommand: '' } },
    { new: false }
  ).lean();

  const queued = (user?.pendingAgentCommands || [])
    .map(normalizeCommand)
    .filter(Boolean);
  const legacy = normalizeCommand(user?.pendingAgentCommand);
  return legacy ? [...queued, legacy] : queued;
}

async function queueAgentCommand(userId, script) {
  const entry = {
    scriptId: script._id.toString(),
    name: script.name,
    path: script.path,
    scriptType: script.type,
    queuedAt: new Date(),
  };
  await User.updateOne(
    { _id: userId },
    {
      $unset: { pendingAgentCommand: '' },
      $push: { pendingAgentCommands: entry },
    }
  );
}

module.exports = {
  isAgentOnlineForUser,
  touchAgentHeartbeat,
  claimPendingCommands,
  queueAgentCommand,
  pendingCommandFields,
};
