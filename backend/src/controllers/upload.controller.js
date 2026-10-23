import { startAnalysis } from '../services/analysis.service.js';
import { AppError } from '../utils/errors.js';
import { successResponse } from '../utils/api-response.js';

export async function uploadFile(req, res) {
  if (!req.file) {
    throw new AppError(400, 'FILE_REQUIRED', 'Provide a CSV file in the multipart field named "file".');
  }

  const analysis = await startAnalysis(req.file);
  return successResponse(res, {
    analysisId: String(analysis._id),
    status: analysis.status
  }, 'Analysis started', 202);
}
