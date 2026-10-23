import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { detectAnomalies, predictConsumption } from '../src/services/ml.service.js';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('validates and normalizes a successful forecast response', async () => {
  const readings = Array.from({ length: 30 }, (_value, index) => ({
    timestamp: new Date(Date.UTC(2007, 0, 1, 0, index)),
    Global_active_power: 1 + index / 100,
    Global_reactive_power: 0.1,
    Voltage: 230,
    Global_intensity: 5,
    Sub_metering_1: 0,
    Sub_metering_2: 0,
    Sub_metering_3: 1
  }));
  let sentPayload;
  globalThis.fetch = async (_url, options) => {
    sentPayload = JSON.parse(options.body);
    return new Response(JSON.stringify({
      status: 'success',
      latest_observed_active_power_kw: 1.29,
      predictions: [{
        timestamp: '2007-01-01T00:30:00.000Z',
        active_power_kw: 1.7,
        horizon_steps: 1,
        persistence_baseline_kw: 1.29
      }],
      unit: 'kW',
      model: { name: 'random_forest', version: '1.0' },
      warnings: []
    }), { status: 200 });
  };
  const result = await predictConsumption(readings);
  assert.equal(result.predictions[0].predictedActivePowerKw, 1.7);
  assert.equal(result.unit, 'kW');
  assert.equal(result.modelVersion, '1.0');
  assert.equal(result.validation.latestObservedActivePowerKw, 1.29);
  assert.equal(sentPayload.horizon_steps, 1);
  assert.equal(sentPayload.interval_minutes, 1);
  assert.equal(sentPayload.readings[0].active_power_kw, 1);
  assert.equal(sentPayload.readings[0].Global_active_power, undefined);
});

test('rejects malformed ML response payloads', async () => {
  const readings = Array.from({ length: 30 }, (_value, index) => ({
    timestamp: new Date(Date.UTC(2007, 0, 1, 0, index)),
    Global_active_power: 1
  }));
  globalThis.fetch = async () => new Response(JSON.stringify({ predictions: [] }), { status: 200 });
  await assert.rejects(
    predictConsumption(readings),
    { code: 'INVALID_ML_RESPONSE' }
  );
});

test('rejects forecast input that does not meet the trained model history and interval requirements', async () => {
  const twoReadings = [
    { timestamp: new Date('2007-01-01T00:00:00Z'), Global_active_power: 1 },
    { timestamp: new Date('2007-01-01T00:01:00Z'), Global_active_power: 1 }
  ];
  await assert.rejects(predictConsumption(twoReadings), { code: 'INSUFFICIENT_FORECAST_HISTORY' });

  const irregular = Array.from({ length: 30 }, (_value, index) => ({
    timestamp: new Date(Date.UTC(2007, 0, 1, 0, index + (index === 29 ? 1 : 0))),
    Global_active_power: 1
  }));
  await assert.rejects(predictConsumption(irregular), { code: 'INVALID_FORECAST_INTERVAL' });
});

test('reports ML connection failures and timeouts without leaking transport errors', async () => {
  const readings = Array.from({ length: 30 }, (_value, index) => ({
    timestamp: new Date(Date.UTC(2007, 0, 1, 0, index)),
    Global_active_power: 1
  }));
  globalThis.fetch = async () => {
    throw new Error('ECONNREFUSED 127.0.0.1');
  };
  await assert.rejects(
    predictConsumption(readings),
    { code: 'ML_SERVICE_UNAVAILABLE', statusCode: 503 }
  );

  globalThis.fetch = async () => {
    throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
  };
  await assert.rejects(
    predictConsumption(readings),
    { code: 'ML_SERVICE_TIMEOUT', statusCode: 503 }
  );
});

test('validates anomaly result count, timestamps, and flags', async () => {
  const readings = [{
    timestamp: new Date('2007-01-01T00:00:00Z'),
    Global_active_power: 1,
    Global_reactive_power: 0.1,
    Voltage: 230,
    Global_intensity: 5,
    Sub_metering_1: 0,
    Sub_metering_2: 0,
    Sub_metering_3: 1
  }];
  let sentPayload;
  globalThis.fetch = async (_url, options) => {
    sentPayload = JSON.parse(options.body);
    return new Response(JSON.stringify({
      status: 'success',
      results: [{
        timestamp: readings[0].timestamp.toISOString(),
        is_anomaly: false,
        score: 0.2,
        explanation: 'No unusual pattern was detected.'
      }],
      flagged_count: 0,
      model: { name: 'isolation_forest', version: '1.0' },
      warnings: []
    }), { status: 200 });
  };
  const result = await detectAnomalies(readings);
  assert.equal(result.anomalies[0].isAnomaly, false);
  assert.equal(result.modelVersion, '1.0');
  assert.equal(result.anomalies[0].explanation, 'No unusual pattern was detected.');
  assert.equal(sentPayload.readings[0].active_power_kw, 1);
  assert.equal(sentPayload.readings[0].Global_active_power, undefined);
  assert.equal(sentPayload.readings[0].reactive_power, 0.1);
});

test('maps FastAPI validation and unavailable-model responses to safe backend errors', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ detail: 'internal details' }), { status: 422 });
  await assert.rejects(
    detectAnomalies([{ timestamp: new Date(), Global_active_power: 1 }]),
    { code: 'ML_INVALID_INPUT', statusCode: 422 }
  );

  globalThis.fetch = async () => new Response(JSON.stringify({ detail: 'artifact path leaked' }), { status: 503 });
  await assert.rejects(
    detectAnomalies([{ timestamp: new Date(), Global_active_power: 1 }]),
    { code: 'ML_MODEL_UNAVAILABLE', statusCode: 503 }
  );
});

test('health requires both backend-used model artifacts to be loaded', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    status: 'ok',
    model_readiness: { forecasting: true, anomaly_detection: true }
  }), { status: 200 });
  const { checkMlHealth } = await import('../src/services/ml.service.js');
  assert.equal(await checkMlHealth(), true);

  globalThis.fetch = async () => new Response(JSON.stringify({
    status: 'ok',
    model_readiness: { forecasting: true, anomaly_detection: false }
  }), { status: 200 });
  assert.equal(await checkMlHealth(), false);
});
