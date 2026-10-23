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
    return response.ok;
  } catch {
    return false;
  }
}

export async function predictConsumption(readings) {
  const result = await postJson('predict/consumption', {
    readings: readings.map(({ timestamp, Global_active_power }) => ({
      timestamp: timestamp.toISOString(),
      Global_active_power
    })),
    horizon: 1
  });

  if (
    !Array.isArray(result?.forecast) ||
    result.forecast.length === 0 ||
    typeof result.model_version !== 'string' ||
    !result.model_version
  ) {
    throw new AppError(502, 'INVALID_ML_RESPONSE', 'The forecasting service returned an invalid response.');
  }

  const predictions = result.forecast.map((item) => {
    const timestamp = new Date(item?.timestamp);
    const value = item?.predicted_active_power_kw;
    if (!Number.isFinite(timestamp.getTime()) || typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new AppError(502, 'INVALID_ML_RESPONSE', 'The forecasting service returned invalid prediction values.');
    }
    return { timestamp, predictedActivePowerKw: value };
  });

  return {
    predictions,
    horizon: Number.isInteger(result.horizon) && result.horizon > 0 ? result.horizon : predictions.length,
    unit: 'kW',
    modelVersion: result.model_version,
    validation: result.validation ?? {}
  };
}

export async function detectAnomalies(readings) {
  const result = await postJson('detect/anomalies', {
    readings: readings.map((reading) => ({
      timestamp: reading.timestamp.toISOString(),
      Global_active_power: reading.Global_active_power,
      Global_reactive_power: reading.Global_reactive_power,
      Voltage: reading.Voltage,
      Global_intensity: reading.Global_intensity,
      Sub_metering_1: reading.Sub_metering_1,
      Sub_metering_2: reading.Sub_metering_2,
      Sub_metering_3: reading.Sub_metering_3
    }))
  });

  if (!Array.isArray(result?.anomalies) || typeof result.model_version !== 'string' || !result.model_version) {
    throw new AppError(502, 'INVALID_ML_RESPONSE', 'The anomaly service returned an invalid response.');
  }
  if (result.anomalies.length !== readings.length) {
    throw new AppError(502, 'INVALID_ML_RESPONSE', 'The anomaly service returned an unexpected result count.');
  }

  return {
    modelVersion: result.model_version,
    anomalies: result.anomalies.map((item, index) => {
      const timestamp = new Date(item?.timestamp);
      if (
        !Number.isFinite(timestamp.getTime()) ||
        timestamp.getTime() !== readings[index].timestamp.getTime() ||
        typeof item.is_anomaly !== 'boolean' ||
        (item.score !== undefined && (typeof item.score !== 'number' || !Number.isFinite(item.score)))
      ) {
        throw new AppError(502, 'INVALID_ML_RESPONSE', 'The anomaly service returned invalid anomaly values.');
      }
      return { timestamp, isAnomaly: item.is_anomaly, score: item.score };
    })
  };
}
