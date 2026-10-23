import mongoose from 'mongoose';
import { z } from 'zod';
import { AppError } from '../utils/errors.js';

const positiveInt = z.coerce.number().int().positive().safe();

export function parseAnalysisId(id) {
  if (!mongoose.isValidObjectId(id)) {
    throw new AppError(400, 'INVALID_ANALYSIS_ID', 'The analysis ID is invalid.');
  }
  return id;
}

export function parseHistoryQuery(query) {
  const parsed = z.object({
    page: positiveInt.default(1),
    pageSize: positiveInt.max(100).default(20),
    status: z.enum(['processing', 'completed', 'failed']).optional(),
    sort: z.enum(['asc', 'desc']).default('desc')
  }).safeParse(query);
  if (!parsed.success) {
    throw new AppError(400, 'INVALID_QUERY', 'The history query parameters are invalid.');
  }
  return parsed.data;
}

export function parsePageQuery(query, defaultPageSize = 100) {
  const parsed = z.object({
    page: positiveInt.default(1),
    pageSize: positiveInt.max(defaultPageSize).default(Math.min(defaultPageSize, 100))
  }).safeParse(query);
  if (!parsed.success) {
    throw new AppError(400, 'INVALID_QUERY', 'The pagination query parameters are invalid.');
  }
  return parsed.data;
}
