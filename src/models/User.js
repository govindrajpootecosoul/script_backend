const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    passwordHash: { type: String, required: true },
    /** Updated by Electron agent while connected; used for dashboard when Socket.io hits another serverless instance. */
    agentHeartbeatAt: { type: Date, default: null },
    /** Queued when web triggers run via REST (Vercel / no sticky Socket.io). */
    pendingAgentCommand: {
      scriptId: String,
      name: String,
      path: String,
      type: String,
      queuedAt: Date,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
