import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import healthRoutes from './routes/health.routes.js';
import uploadRoutes from './routes/upload.routes.js';
import analysisRoutes from './routes/analysis.routes.js';
import authRoutes from './routes/auth.routes.js';
import { requestIdMiddleware } from './middleware/request-id.middleware.js';
import { errorMiddleware, notFoundMiddleware } from './middleware/error.middleware.js';
import { AppError } from './utils/errors.js';

const app = express();

app.disable('x-powered-by');
app.use(requestIdMiddleware);
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || env.FRONTEND_ORIGINS.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new AppError(403, 'CORS_ORIGIN_DENIED', 'This origin is not allowed.'));
  }
}));
app.use(express.json({ limit: '100kb' }));

app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/analyses', analysisRoutes);
app.use(notFoundMiddleware);
app.use(errorMiddleware);

export default app;
