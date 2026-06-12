const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    passwordHash: { type: String, required: true },
    /** Updated by Electron agent while connected; used for dashboard when Socket.io hits another serverless instance. */
    agentHeartbeatAt: { type: Date, default: null },
    /** Queued when web triggers run via REST (Vercel / no sticky Socket.io). */
    pendingAgentCommand: {
      type: new mongoose.Schema(
        {
          scriptId: String,
          name: String,
          path: String,
          scriptType: String,
          queuedAt: Date,
        },
        { _id: false }
      ),
      default: undefined,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
