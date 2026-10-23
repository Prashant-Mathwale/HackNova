import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    maxlength: 255
  },
  passwordHash: {
    type: String,
    required: true
  },
  salt: {
    type: String,
    required: true
  }
}, { timestamps: true });

export const User = mongoose.models.User || mongoose.model('User', userSchema);
