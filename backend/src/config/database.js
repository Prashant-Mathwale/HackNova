import mongoose from 'mongoose';
import { env } from './env.js';
import { Analysis } from '../models/Analysis.js';

export async function connectDatabase() {
  await mongoose.connect(env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000
  });
  console.info(JSON.stringify({ level: 'info', event: 'database_connected' }));
}

export async function failInterruptedAnalyses() {
  const result = await Analysis.updateMany(
    { status: 'processing' },
    {
      $set: {
        status: 'failed',
        error: {
          code: 'PROCESS_RESTARTED',
          message: 'Processing was interrupted when the backend restarted. Upload the file again to retry.'
        }
      }
    }
  );
  if (result.modifiedCount) {
    console.warn(JSON.stringify({
      level: 'warn',
      event: 'interrupted_analyses_failed',
      count: result.modifiedCount
    }));
  }
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}
