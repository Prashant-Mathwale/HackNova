import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncHandler } from '../utils/async-handler.js';
import { uploadFile } from '../controllers/upload.controller.js';
import { uploadCsv } from '../middleware/upload.middleware.js';

const router = Router();
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many upload requests. Try again shortly.', details: [] }
  }
});

router.post('/', uploadLimiter, (req, res, next) => {
  uploadCsv(req, res, (error) => {
    if (error) return next(error);
    return asyncHandler(uploadFile)(req, res, next);
  });
});

export default router;
