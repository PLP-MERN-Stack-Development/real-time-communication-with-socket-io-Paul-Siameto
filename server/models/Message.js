const mongoose = require('mongoose')

const MessageSchema = new mongoose.Schema(
  {
    message: { type: String, required: true },
    senderUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    sender: { type: String, required: true },
    senderSocketId: { type: String },
    isPrivate: { type: Boolean, default: false },
    toUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    toUsername: { type: String, default: null },
    toSocketId: { type: String, default: null },
    timestamp: { type: Date, default: Date.now },
    room: { type: String, default: 'global', index: true },
    attachments: [
      {
        url: String,
        type: String,
        name: String,
        size: Number,
      },
    ],
    readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    reactions: [
      {
        type: { type: String },
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      },
    ],
  },
  { timestamps: true }
)

module.exports = mongoose.model('Message', MessageSchema)
