import { registerUser, loginUser } from '../services/auth.service.js';
import { AppError } from '../utils/errors.js';

export async function register(req, res) {
  const { name, email, password } = req.body || {};

  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Name is required.');
  }

  if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    throw new AppError(400, 'VALIDATION_ERROR', 'A valid email address is required.');
  }

  if (!password || typeof password !== 'string' || password.length < 6) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Password must be at least 6 characters long.');
  }

  const user = await registerUser({ name, email, password });

  res.status(201).json({
    success: true,
    message: 'User registered successfully',
    data: user
  });
}

export async function login(req, res) {
  const { email, password } = req.body || {};

  if (!email || !password) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Email and password are required.');
  }

  const user = await loginUser({ email, password });

  res.status(200).json({
    success: true,
    message: 'Login successful',
    data: user
  });
}
