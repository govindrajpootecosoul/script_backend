const User = require('../models/User');

async function isAgentOnlineForUser(uid, agentSockets) {
  if (agentSockets && agentSockets.has(uid)) return true;
  const u = await User.findById(uid).select('agentHeartbeatAt').lean();
  const at = u && u.agentHeartbeatAt;
  return !!(at && Date.now() - new Date(at).getTime() < 25000);
}

async function touchAgentHeartbeat(userId) {
  await User.updateOne({ _id: userId }, { $set: { agentHeartbeatAt: new Date() } });
}

async function claimPendingCommand(userId) {
  const user = await User.findOneAndUpdate(
    { _id: userId, 'pendingAgentCommand.scriptId': { $exists: true, $ne: null } },
    { $unset: { pendingAgentCommand: '' } },
    { new: false }
  ).lean();
  return user?.pendingAgentCommand || null;
}

async function queueAgentCommand(userId, script) {
  await User.updateOne(
    { _id: userId },
    {
      $set: {
        pendingAgentCommand: {
          scriptId: script._id.toString(),
          name: script.name,
          path: script.path,
          type: script.type,
          queuedAt: new Date(),
        },
      },
    }
  );
}

module.exports = {
  isAgentOnlineForUser,
  touchAgentHeartbeat,
  claimPendingCommand,
  queueAgentCommand,
};
