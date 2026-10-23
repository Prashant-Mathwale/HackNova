import multer from 'multer';
import { AppError } from '../utils/errors.js';

export function notFoundMiddleware(req, res, next) {
  next(new AppError(404, 'NOT_FOUND', 'The requested endpoint was not found.'));
}

export function errorMiddleware(error, req, res, next) {
  if (res.headersSent) {
    next(error);
    return;
  }

  let appError = error;
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      appError = new AppError(413, 'FILE_TOO_LARGE', 'The uploaded file exceeds the configured size limit.');
    } else {
      appError = new AppError(400, 'INVALID_UPLOAD', 'The upload request is invalid.');
    }
  } else if (error?.type === 'entity.too.large') {
    appError = new AppError(413, 'REQUEST_TOO_LARGE', 'The request body is too large.');
  } else if (!(error instanceof AppError)) {
    appError = new AppError(500, 'INTERNAL_ERROR', 'An unexpected server error occurred.');
  }

  console.error(JSON.stringify({
    level: 'error',
    event: 'request_failed',
    requestId: req.id,
    code: appError.code,
    statusCode: appError.statusCode,
    error: error.message
  }));

  res.status(appError.statusCode).json({
    success: false,
    error: {
      code: appError.code,
      message: appError.message,
      details: appError.details
    },
    requestId: req.id
  });
}
