import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';

async function postJson(endpoint, payload) {
  let response;
  try {
    response = await fetch(new URL(endpoint, `${env.ML_SERVICE_URL.replace(/\/+$/, '')}/`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(env.ML_REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    const timedOut = error.name === 'TimeoutError' || error.name === 'AbortError';
    throw new AppError(
      503,
      timedOut ? 'ML_SERVICE_TIMEOUT' : 'ML_SERVICE_UNAVAILABLE',
      timedOut ? 'The ML service did not respond before the request timed out.' : 'The ML service is unavailable.'
    );
  }

  if (!response.ok) {
    if (response.status === 422) {
      throw new AppError(
        422,
        'ML_INVALID_INPUT',
        'The ML service rejected the readings. Check the required fields and model input constraints.'
      );
    }
    if (response.status === 503) {
      throw new AppError(503, 'ML_MODEL_UNAVAILABLE', 'The required ML model is not trained or available.');
    }
    throw new AppError(503, 'ML_SERVICE_ERROR', 'The ML service could not process this analysis.');
  }
  try {
    return await response.json();
  } catch {
    throw new AppError(502, 'INVALID_ML_RESPONSE', 'The ML service returned an invalid response.');
  }
}

export async function checkMlHealth() {
  try {
    const response = await fetch(new URL('health', `${env.ML_SERVICE_URL.replace(/\/+$/, '')}/`), {
      signal: AbortSignal.timeout(Math.min(env.ML_REQUEST_TIMEOUT_MS, 3000))
    });
    if (!response.ok) return false;
    const health = await response.json();
    return health?.status === 'ok' &&
      health?.model_readiness?.forecasting === true &&
      health?.model_readiness?.anomaly_detection === true;
  } catch {
    return false;
  }
}

function toCanonicalReading(reading) {
  return {
    timestamp: reading.timestamp.toISOString(),
    active_power_kw: reading.Global_active_power,
    reactive_power: reading.Global_reactive_power,
    voltage_v: reading.Voltage,
    current_a: reading.Global_intensity,
    sub_metering_1: reading.Sub_metering_1,
    sub_metering_2: reading.Sub_metering_2,
    sub_metering_3: reading.Sub_metering_3
  };
}

export async function predictConsumption(readings) {
  if (readings.length < 30) {
    throw new AppError(422, 'INSUFFICIENT_FORECAST_HISTORY', 'Forecasting requires at least 30 consecutive one-minute readings.');
  }
  for (let index = 1; index < readings.length; index += 1) {
    if (readings[index].timestamp - readings[index - 1].timestamp !== 60_000) {
      throw new AppError(422, 'INVALID_FORECAST_INTERVAL', 'Forecasting requires consecutive one-minute readings.');
    }
  }

  const result = await postJson('predict/consumption', {
    readings: readings.map(toCanonicalReading),
    horizon_steps: 1,
    interval_minutes: 1
  });

  if (
    result?.status !== 'success' ||
    !Array.isArray(result?.predictions) ||
    result.predictions.length === 0 ||
    typeof result?.model?.version !== 'string' ||
    !result.model.version ||
    result.unit !== 'kW'
  ) {
    throw new AppError(502, 'INVALID_ML_RESPONSE', 'The forecasting service returned an invalid response.');
  }

  const predictions = result.predictions.map((item) => {
    const timestamp = new Date(item?.timestamp);
    const value = item?.active_power_kw;
    if (
      !Number.isFinite(timestamp.getTime()) ||
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < 0 ||
      !Number.isInteger(item?.horizon_steps) ||
      item.horizon_steps < 1
    ) {
      throw new AppError(502, 'INVALID_ML_RESPONSE', 'The forecasting service returned invalid prediction values.');
    }
    return { timestamp, predictedActivePowerKw: value };
  });

  return {
    predictions,
    horizon: predictions.length,
    unit: result.unit,
    modelVersion: result.model.version,
    validation: {
      latestObservedActivePowerKw: result.latest_observed_active_power_kw,
      persistenceBaselineKw: result.predictions[0].persistence_baseline_kw,
      warnings: result.warnings ?? []
    }
  };
}

export async function detectAnomalies(readings) {
  const result = await postJson('detect/anomalies', {
    readings: readings.map(toCanonicalReading)
  });

  if (
    result?.status !== 'success' ||
    !Array.isArray(result?.results) ||
    typeof result?.model?.version !== 'string' ||
    !result.model.version
  ) {
    throw new AppError(502, 'INVALID_ML_RESPONSE', 'The anomaly service returned an invalid response.');
  }
  if (result.results.length !== readings.length) {
    throw new AppError(502, 'INVALID_ML_RESPONSE', 'The anomaly service returned an unexpected result count.');
  }

  return {
    modelVersion: result.model.version,
    anomalies: result.results.map((item, index) => {
      const timestamp = new Date(item?.timestamp);
      if (
        !Number.isFinite(timestamp.getTime()) ||
        timestamp.getTime() !== readings[index].timestamp.getTime() ||
        typeof item.is_anomaly !== 'boolean' ||
        typeof item.score !== 'number' ||
        !Number.isFinite(item.score)
      ) {
        throw new AppError(502, 'INVALID_ML_RESPONSE', 'The anomaly service returned invalid anomaly values.');
      }
      return {
        timestamp,
        isAnomaly: item.is_anomaly,
        score: item.score,
        explanation: item.explanation ?? null
      };
    })
  };
}
