import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { detectAnomalies, predictConsumption } from '../src/services/ml.service.js';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('validates and normalizes a successful forecast response', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    forecast: [{ timestamp: '2007-01-01T00:02:00.000Z', predicted_active_power_kw: 1.7 }],
    horizon: 1,
    model_version: 'rf-1',
    validation: { mae_kw: 0.3 }
  }), { status: 200 });
  const result = await predictConsumption([
    { timestamp: new Date('2007-01-01T00:00:00Z'), Global_active_power: 1.2 },
    { timestamp: new Date('2007-01-01T00:01:00Z'), Global_active_power: 1.5 }
  ]);
  assert.equal(result.predictions[0].predictedActivePowerKw, 1.7);
  assert.equal(result.unit, 'kW');
  assert.equal(result.modelVersion, 'rf-1');
});

test('rejects malformed ML response payloads', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ forecast: [] }), { status: 200 });
  await assert.rejects(
    predictConsumption([{ timestamp: new Date(), Global_active_power: 1 }]),
    { code: 'INVALID_ML_RESPONSE' }
  );
});

test('reports ML connection failures and timeouts without leaking transport errors', async () => {
  globalThis.fetch = async () => {
    throw new Error('ECONNREFUSED 127.0.0.1');
  };
  await assert.rejects(
    predictConsumption([{ timestamp: new Date(), Global_active_power: 1 }]),
    { code: 'ML_SERVICE_UNAVAILABLE', statusCode: 503 }
  );

  globalThis.fetch = async () => {
    throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
  };
  await assert.rejects(
    predictConsumption([{ timestamp: new Date(), Global_active_power: 1 }]),
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
  globalThis.fetch = async () => new Response(JSON.stringify({
    anomalies: [{ timestamp: readings[0].timestamp.toISOString(), is_anomaly: false, score: 0.2 }],
    model_version: 'if-1'
  }), { status: 200 });
  const result = await detectAnomalies(readings);
  assert.equal(result.anomalies[0].isAnomaly, false);
  assert.equal(result.modelVersion, 'if-1');
});
