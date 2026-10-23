import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';

export const uploadDirectory = path.join(tmpdir(), 'energyiq-uploads');

await mkdir(uploadDirectory, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, uploadDirectory),
  filename: (_req, _file, callback) => callback(null, `${randomUUID()}.upload`)
});

function csvFileFilter(_req, file, callback) {
  if (path.extname(file.originalname).toLowerCase() !== '.csv') {
    callback(new AppError(415, 'UNSUPPORTED_FILE_TYPE', 'Upload a CSV file with a .csv extension.'));
    return;
  }
  callback(null, true);
}

export const uploadCsv = multer({
  storage,
  fileFilter: csvFileFilter,
  limits: {
    fileSize: env.MAX_UPLOAD_SIZE_BYTES,
    files: 1,
    fields: 0,
    parts: 1
  }
}).single('file');
