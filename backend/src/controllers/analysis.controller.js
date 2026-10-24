import { Analysis } from '../models/Analysis.js';
import { Reading } from '../models/Reading.js';
import { parseAnalysisId, parseHistoryQuery, parsePageQuery } from '../validators/analysis.validator.js';
import { AppError } from '../utils/errors.js';
import { successResponse } from '../utils/api-response.js';
import { deleteAnalysis } from '../services/analysis.service.js';
import { analyzeUsagePatterns } from '../services/ml.service.js';

const analysisProjection = 'fileName fileSizeBytes status createdAt updatedAt dateRange totalRows invalidRows missingValues availableColumns summary forecast anomalySummary modelVersion processingDurationMs error';
const MAX_PATTERN_READINGS = 10000;

export async function getAnalysis(req, res) {
  const id = parseAnalysisId(req.params.analysisId);
  const analysis = await Analysis.findById(id).select(analysisProjection).lean();
  if (!analysis) throw new AppError(404, 'ANALYSIS_NOT_FOUND', 'The requested analysis was not found.');
  return successResponse(res, { ...analysis, analysisId: String(analysis._id) });
}

export async function getAnalysisHistory(req, res) {
  const { page, pageSize, status, sort } = parseHistoryQuery(req.query);
  const filter = status ? { status } : {};
  const [items, total] = await Promise.all([
    Analysis.find(filter)
      .select(analysisProjection)
      .sort({ createdAt: sort === 'asc' ? 1 : -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    Analysis.countDocuments(filter)
  ]);
  return successResponse(res, {
    items: items.map((item) => ({ ...item, analysisId: String(item._id) })),
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
  });
}

async function findAnalysis(id) {
  const analysis = await Analysis.findById(parseAnalysisId(id)).select(analysisProjection).lean();
  if (!analysis) throw new AppError(404, 'ANALYSIS_NOT_FOUND', 'The requested analysis was not found.');
  return analysis;
}

export async function getForecast(req, res) {
  const analysis = await findAnalysis(req.params.analysisId);
  if (analysis.status === 'processing') {
    throw new AppError(409, 'ANALYSIS_PROCESSING', 'The analysis is still processing.');
  }
  if (analysis.status !== 'completed' || !analysis.forecast) {
    throw new AppError(422, 'FORECAST_UNAVAILABLE', 'No forecast is available for this analysis.');
  }
  return successResponse(res, {
    analysisId: String(analysis._id),
    predictions: analysis.forecast.predictions,
    unit: analysis.forecast.unit,
    horizon: analysis.forecast.horizon,
    modelVersion: analysis.forecast.modelVersion,
    validation: analysis.forecast.validation
  });
}

export async function getUsagePatterns(req, res) {
  const analysis = await findAnalysis(req.params.analysisId);
  if (analysis.status === 'processing') {
    throw new AppError(409, 'ANALYSIS_PROCESSING', 'The analysis is still processing.');
  }
  if (analysis.status !== 'completed') {
    throw new AppError(422, 'PATTERNS_UNAVAILABLE', 'Pattern analysis is unavailable for this analysis.');
  }

  const sourceReadings = Number(analysis.summary?.validReadingCount ?? analysis.totalRows ?? 0);
  const stride = Math.max(1, Math.ceil(sourceReadings / MAX_PATTERN_READINGS));
  const cursor = Reading.find({
    analysisId: analysis._id,
    Global_active_power: { $ne: null }
  })
    .select('-_id timestamp Global_active_power Global_reactive_power Voltage Global_intensity Sub_metering_1 Sub_metering_2 Sub_metering_3')
    .sort({ timestamp: 1 })
    .lean()
    .cursor();
  const readings = [];
  let index = 0;

  try {
    for await (const reading of cursor) {
      if (index % stride === 0 && readings.length < MAX_PATTERN_READINGS) {
        readings.push(reading);
      }
      index += 1;
    }
  } finally {
    await cursor.close();
  }

  const result = await analyzeUsagePatterns(readings);
  return successResponse(res, {
    analysisId: String(analysis._id),
    cluster: result.cluster,
    statistics: result.statistics,
    dailyPattern: result.daily_pattern,
    hourlyPattern: result.hourly_pattern,
    basedOn: {
      sourceReadings,
      analyzedReadings: readings.length,
      sampled: readings.length < sourceReadings
    }
  });
}

export async function getAnomalies(req, res) {
  const analysis = await findAnalysis(req.params.analysisId);
  if (analysis.status === 'processing') {
    throw new AppError(409, 'ANALYSIS_PROCESSING', 'The analysis is still processing.');
  }
  if (analysis.status !== 'completed') {
    throw new AppError(422, 'ANOMALIES_UNAVAILABLE', 'Anomaly results are unavailable for this analysis.');
  }
  const { page, pageSize } = parsePageQuery(req.query, 100);
  const filter = { analysisId: analysis._id, anomaly: true };
  const [items, total] = await Promise.all([
    Reading.find(filter)
      .select('-_id timestamp Global_active_power Global_reactive_power Voltage Global_intensity Sub_metering_1 Sub_metering_2 Sub_metering_3 anomalyScore')
      .sort({ timestamp: 1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    Reading.countDocuments(filter)
  ]);
  return successResponse(res, {
    totalFlagged: analysis.anomalySummary?.totalFlagged ?? total,
    classification: analysis.anomalySummary?.classification,
    items: items.map(({ anomalyScore, ...item }) => ({ ...item, score: anomalyScore })),
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
  });
}

export async function getConsumption(req, res) {
  const analysis = await findAnalysis(req.params.analysisId);
  const { page, pageSize } = parsePageQuery(req.query, 1000);
  const filter = { analysisId: analysis._id };
  const [items, total] = await Promise.all([
    Reading.find(filter)
      .select('-_id timestamp Global_active_power Global_reactive_power Voltage Global_intensity Sub_metering_1 Sub_metering_2 Sub_metering_3 anomaly anomalyScore')
      .sort({ timestamp: 1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    Reading.countDocuments(filter)
  ]);
  return successResponse(res, {
    items,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
  });
}

export async function removeAnalysis(req, res) {
  const id = parseAnalysisId(req.params.analysisId);
  const deleted = await deleteAnalysis(id);
  return successResponse(res, { analysisId: id, deleted }, deleted ? 'Analysis deleted' : 'Analysis was already deleted');
}
