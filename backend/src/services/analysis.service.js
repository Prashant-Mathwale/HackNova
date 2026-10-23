import path from 'node:path';
import { unlink } from 'node:fs/promises';
import { env } from '../config/env.js';
import { Analysis } from '../models/Analysis.js';
import { Reading } from '../models/Reading.js';
import { parseAndStoreCsv, hashFile } from './csv.service.js';
import { detectAnomalies, predictConsumption } from './ml.service.js';

function displayFileName(originalName) {
  const basename = path.basename(originalName).replace(/[\u0000-\u001f\u007f]/g, '');
  return basename.slice(0, 255) || 'upload.csv';
}

export async function startAnalysis(file) {
  let analysis;
  try {
    analysis = await Analysis.create({
      fileName: displayFileName(file.originalname),
      fileSizeBytes: file.size,
      status: 'processing'
    });
  } catch (error) {
    await unlink(file.path).catch((cleanupError) => {
      if (cleanupError.code !== 'ENOENT') {
        console.error(JSON.stringify({ level: 'error', event: 'upload_cleanup_failed', error: cleanupError.message }));
      }
    });
    throw error;
  }

  setImmediate(() => {
    processAnalysis(analysis._id, file.path).catch((error) => {
      console.error(JSON.stringify({
        level: 'error',
        event: 'analysis_worker_unhandled',
        analysisId: String(analysis._id),
        error: error.message
      }));
    });
  });

  return analysis;
}

export async function processAnalysis(analysisId, filePath) {
  const startedAt = Date.now();
  let parsed;
  try {
    const fileHash = await hashFile(filePath);
    parsed = await parseAndStoreCsv(filePath, analysisId, env.MAX_CSV_ROWS, startedAt + env.ANALYSIS_TIMEOUT_MS);

    const analysis = await Analysis.findById(analysisId);
    if (!analysis) throw new Error('Analysis record disappeared during processing.');
    analysis.fileHash = fileHash;
    analysis.totalRows = parsed.summary.validReadingCount;
    analysis.invalidRows = parsed.summary.invalidRows;
    analysis.missingValues = parsed.summary.missingValues;
    analysis.dateRange = { start: parsed.summary.start, end: parsed.summary.end };
    analysis.availableColumns = parsed.columns;
    analysis.summary = {
      averageActivePowerKw: parsed.summary.averageActivePowerKw,
      minActivePowerKw: parsed.summary.minActivePowerKw,
      maxActivePowerKw: parsed.summary.maxActivePowerKw,
      peakTimestamp: parsed.summary.peakTimestamp,
      observedActivePowerSampleSumKw: parsed.summary.observedActivePowerSampleSumKw,
      validReadingCount: parsed.summary.validReadingCount
    };
    await analysis.save();

    const forecastHistory = parsed.forecastReadings;
    if (forecastHistory.length < 2) {
      throw Object.assign(new Error('At least two valid readings are required for forecasting.'), {
        code: 'INSUFFICIENT_HISTORY',
        statusCode: 422
      });
    }

    const forecast = await predictConsumption(forecastHistory);
    if (Date.now() - startedAt > env.ANALYSIS_TIMEOUT_MS) {
      throw Object.assign(new Error('Analysis exceeded the configured processing time limit.'), {
        code: 'ANALYSIS_TIMEOUT',
        statusCode: 503
      });
    }
    analysis.forecast = forecast;

    let totalFlagged = 0;
    let evaluatedReadings = 0;
    let anomalyModelVersion = null;
    const cursor = Reading.find({
      analysisId,
      ...Object.fromEntries([
        'Global_active_power',
        'Global_reactive_power',
        'Voltage',
        'Global_intensity',
        'Sub_metering_1',
        'Sub_metering_2',
        'Sub_metering_3'
      ].map((field) => [field, { $ne: null }]))
    }).sort({ timestamp: 1 }).lean().cursor();
    let chunk = [];
    for await (const reading of cursor) {
      if (Date.now() - startedAt > env.ANALYSIS_TIMEOUT_MS) {
        throw Object.assign(new Error('Analysis exceeded the configured processing time limit.'), {
          code: 'ANALYSIS_TIMEOUT',
          statusCode: 503
        });
      }
      chunk.push(reading);
      if (chunk.length < env.ANOMALY_BATCH_SIZE) continue;
      const result = await detectAnomalies(chunk);
      anomalyModelVersion = result.modelVersion;
      evaluatedReadings += result.anomalies.length;
      totalFlagged += result.anomalies.filter((item) => item.isAnomaly).length;
      const updates = result.anomalies.map((item) => ({
        updateOne: {
          filter: { analysisId, timestamp: item.timestamp },
          update: { $set: { anomaly: item.isAnomaly, anomalyScore: item.score } }
        }
      }));
      if (updates.length) await Reading.bulkWrite(updates, { ordered: false });
      chunk = [];
    }
    if (chunk.length) {
      const result = await detectAnomalies(chunk);
      anomalyModelVersion = result.modelVersion;
      evaluatedReadings += result.anomalies.length;
      totalFlagged += result.anomalies.filter((item) => item.isAnomaly).length;
      await Reading.bulkWrite(result.anomalies.map((item) => ({
        updateOne: {
          filter: { analysisId, timestamp: item.timestamp },
          update: { $set: { anomaly: item.isAnomaly, anomalyScore: item.score } }
        }
      })), { ordered: false });
    }

    analysis.anomalySummary = {
      totalFlagged,
      evaluatedReadings,
      classification: 'Model-flagged statistical outliers; not verified faults.'
    };
    analysis.modelVersion = [forecast.modelVersion, anomalyModelVersion].filter(Boolean).join(' / ');
    analysis.processingDurationMs = Date.now() - startedAt;
    analysis.status = 'completed';
    analysis.error = undefined;
    await analysis.save();
  } catch (error) {
    await Reading.deleteMany({ analysisId });
    await Analysis.findByIdAndUpdate(analysisId, {
      $set: {
        status: 'failed',
        processingDurationMs: Date.now() - startedAt,
        error: {
          code: error.code ?? 'ANALYSIS_FAILED',
          message: error.statusCode === 422
            ? error.message
            : 'Analysis could not be completed because processing or an ML dependency failed.'
        }
      }
    });
    console.error(JSON.stringify({
      level: 'error',
      event: 'analysis_failed',
      analysisId: String(analysisId),
      code: error.code ?? 'ANALYSIS_FAILED',
      error: error.message
    }));
  } finally {
    try {
      await unlink(filePath);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error(JSON.stringify({ level: 'error', event: 'upload_cleanup_failed', error: error.message }));
      }
    }
  }
}

export async function deleteAnalysis(id) {
  await Reading.deleteMany({ analysisId: id });
  const deleted = await Analysis.findByIdAndDelete(id);
  return Boolean(deleted);
}
