const mongoose = require('mongoose')

const UserSchema = new mongoose.Schema(
  {
    username: { type: String, unique: true, required: true, trim: true },
    passwordHash: { type: String, required: true },
  },
  { timestamps: true }
)

module.exports = mongoose.model('User', UserSchema)
