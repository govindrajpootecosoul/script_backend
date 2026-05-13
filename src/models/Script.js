const mongoose = require('mongoose');

const SCRIPT_TYPES = ['python', 'nodejs', 'shell'];
const SCRIPT_STATUSES = ['idle', 'running', 'success', 'failed'];

const scriptSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    path: { type: String, required: true, trim: true },
    type: { type: String, required: true, enum: SCRIPT_TYPES },
    status: { type: String, enum: SCRIPT_STATUSES, default: 'idle' },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    lastError: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Script', scriptSchema);
module.exports.SCRIPT_TYPES = SCRIPT_TYPES;
module.exports.SCRIPT_STATUSES = SCRIPT_STATUSES;
