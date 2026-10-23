import mongoose from 'mongoose';
import { checkMlHealth } from '../services/ml.service.js';
import { successResponse } from '../utils/api-response.js';

export async function getHealth(_req, res) {
  const database = mongoose.connection.readyState === 1 ? 'connected' : 'unavailable';
  const mlService = await checkMlHealth() ? 'available' : 'unavailable';
  const status = database === 'connected' && mlService === 'available' ? 'ok' : 'degraded';
  return successResponse(res, {
    service: 'energyiq-backend',
    status,
    database,
    mlService
  }, 'Health check completed', status === 'ok' ? 200 : 503);
}
