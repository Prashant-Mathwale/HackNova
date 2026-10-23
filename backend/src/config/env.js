import 'dotenv/config';
import { z } from 'zod';

const positiveInteger = z.coerce.number().int().positive().safe();
const mongoUri = z.string().refine((value) => {
  try {
    return ['mongodb:', 'mongodb+srv:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}, 'Must be a valid MongoDB connection URI');
const frontendOrigins = z.string().refine((value) => value.split(',').every((entry) => {
  const origin = entry.trim();
  try {
    const parsedOrigin = new URL(origin);
    return ['http:', 'https:'].includes(parsedOrigin.protocol) && parsedOrigin.origin === origin;
  } catch {
    return false;
  }
}), 'Must be a comma-separated list of HTTP(S) origins');

const envSchema = z.object({
  PORT: positiveInteger.max(65535).default(5000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  MONGODB_URI: mongoUri.default('mongodb://127.0.0.1:27017/energyiq'),
  ML_SERVICE_URL: z.url().refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), 'Must use HTTP(S)').default('http://127.0.0.1:8000'),
  FRONTEND_ORIGIN: frontendOrigins.default('http://localhost:3000'),
  MAX_UPLOAD_SIZE_MB: positiveInteger.max(1024).default(20),
  MAX_CSV_ROWS: positiveInteger.default(200000),
  ANALYSIS_TIMEOUT_MS: positiveInteger.default(120000),
  ML_REQUEST_TIMEOUT_MS: positiveInteger.default(30000),
  FORECAST_HISTORY_ROWS: positiveInteger.default(1000),
  ANOMALY_BATCH_SIZE: positiveInteger.max(10000).default(5000)
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ');
  throw new Error(`Invalid environment configuration: ${details}`);
}

export const env = Object.freeze({
  ...parsed.data,
  MAX_UPLOAD_SIZE_BYTES: parsed.data.MAX_UPLOAD_SIZE_MB * 1024 * 1024,
  FRONTEND_ORIGINS: parsed.data.FRONTEND_ORIGIN.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
});
