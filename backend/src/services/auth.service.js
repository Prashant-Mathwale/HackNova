import crypto from 'node:crypto';
import { User } from '../models/User.js';
import { AppError } from '../utils/errors.js';

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

export async function registerUser({ name, email, password }) {
  const normalizedEmail = email.trim().toLowerCase();
  
  const existingUser = await User.findOne({ email: normalizedEmail });
  if (existingUser) {
    throw new AppError(409, 'USER_EXISTS', 'A user with this email address is already registered.');
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, salt);

  const newUser = await User.create({
    name: name.trim(),
    email: normalizedEmail,
    passwordHash,
    salt
  });

  return {
    id: newUser._id.toString(),
    name: newUser.name,
    email: newUser.email,
    createdAt: newUser.createdAt
  };
}

export async function loginUser({ email, password }) {
  const normalizedEmail = email.trim().toLowerCase();

  const user = await User.findOne({ email: normalizedEmail });
  if (!user) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  }

  const calculatedHash = hashPassword(password, user.salt);
  if (calculatedHash !== user.passwordHash) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  }

  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    createdAt: user.createdAt
  };
}
