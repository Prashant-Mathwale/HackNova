import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import {
  getAnalysis,
  getAnalysisHistory,
  getAnomalies,
  getConsumption,
  getForecast,
  removeAnalysis
} from '../controllers/analysis.controller.js';

const router = Router();
router.get('/', asyncHandler(getAnalysisHistory));
router.get('/:analysisId', asyncHandler(getAnalysis));
router.get('/:analysisId/forecast', asyncHandler(getForecast));
router.get('/:analysisId/anomalies', asyncHandler(getAnomalies));
router.get('/:analysisId/consumption', asyncHandler(getConsumption));
router.delete('/:analysisId', asyncHandler(removeAnalysis));
export default router;
