import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import mongoose from 'mongoose';
import { Analysis } from '../src/models/Analysis.js';
import { Reading } from '../src/models/Reading.js';
import { processAnalysis } from '../src/services/analysis.service.js';

const csv = [
  'Date;Time;Global_active_power;Global_reactive_power;Voltage;Global_intensity;Sub_metering_1;Sub_metering_2;Sub_metering_3',
  ...Array.from({ length: 30 }, (_value, index) =>
    `01/01/2007;00:${String(index).padStart(2, '0')}:00;${(2.45 + index / 100).toFixed(2)};0.2;230.1;10.5;0;1;5`)
].join('\n');

const originals = {
  analysisFindById: Analysis.findById,
  analysisFindByIdAndUpdate: Analysis.findByIdAndUpdate,
  readingInsertMany: Reading.insertMany,
  readingFind: Reading.find,
  readingBulkWrite: Reading.bulkWrite,
  readingDeleteMany: Reading.deleteMany,
  fetch: globalThis.fetch
};

afterEach(() => {
  Analysis.findById = originals.analysisFindById;
  Analysis.findByIdAndUpdate = originals.analysisFindByIdAndUpdate;
  Reading.insertMany = originals.readingInsertMany;
  Reading.find = originals.readingFind;
  Reading.bulkWrite = originals.readingBulkWrite;
  Reading.deleteMany = originals.readingDeleteMany;
  globalThis.fetch = originals.fetch;
});

async function createUpload() {
  const directory = await mkdtemp(path.join(tmpdir(), 'energyiq-analysis-test-'));
  const filePath = path.join(directory, 'test.upload');
  await writeFile(filePath, csv);
  return { directory, filePath };
}

test('persists completed analysis results after successful forecast and anomaly inference', async () => {
  const analysisId = new mongoose.Types.ObjectId();
  const savedReadings = [];
  const analysis = { _id: analysisId, save: async () => {} };
  Analysis.findById = async () => analysis;
  Reading.insertMany = async (documents) => savedReadings.push(...documents);
  Reading.find = () => ({
    sort() { return this; },
    lean() { return this; },
    cursor() {
      return (async function* () {
        for (const reading of savedReadings) {
          if (reading.Global_active_power !== null) yield reading;
        }
      }());
    }
  });
  Reading.bulkWrite = async () => {};
  Reading.deleteMany = async () => {};
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/predict/consumption')) {
      return new Response(JSON.stringify({
        status: 'success',
        latest_observed_active_power_kw: 2.74,
        predictions: [{
          timestamp: '2007-01-01T00:30:00.000Z',
          active_power_kw: 2.6,
          horizon_steps: 1,
          persistence_baseline_kw: 2.74
        }],
        unit: 'kW',
        model: { name: 'random_forest', version: '1.0' },
        warnings: []
      }), { status: 200 });
    }
    const { readings } = JSON.parse(options.body);
    return new Response(JSON.stringify({
      status: 'success',
      results: readings.map((reading) => ({
        timestamp: reading.timestamp,
        is_anomaly: false,
        score: 0.1,
        explanation: 'No unusual pattern was detected by the fitted model.'
      })),
      flagged_count: 0,
      model: { name: 'isolation_forest', version: '1.0' },
      warnings: []
    }), { status: 200 });
  };

  const { directory, filePath } = await createUpload();
  try {
    await processAnalysis(analysisId, filePath);
    assert.equal(analysis.status, 'completed');
    assert.equal(analysis.totalRows, 30);
    assert.equal(analysis.forecast.modelVersion, '1.0');
    assert.equal(analysis.anomalySummary.evaluatedReadings, 30);
    assert.equal(analysis.modelVersion, '1.0 / 1.0');
    await assert.rejects(access(filePath));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('records a failed status and removes partial readings when ML inference fails', async () => {
  const analysisId = new mongoose.Types.ObjectId();
  const analysis = { _id: analysisId, save: async () => {} };
  let failureUpdate;
  let readingsRemoved = false;
  Analysis.findById = async () => analysis;
  Analysis.findByIdAndUpdate = async (_id, update) => { failureUpdate = update; };
  Reading.insertMany = async () => [];
  Reading.deleteMany = async () => { readingsRemoved = true; };
  globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };

  const { directory, filePath } = await createUpload();
  try {
    await processAnalysis(analysisId, filePath);
    assert.equal(failureUpdate.$set.status, 'failed');
    assert.equal(failureUpdate.$set.error.code, 'ML_SERVICE_UNAVAILABLE');
    assert.match(failureUpdate.$set.error.message, /ML dependency failed/);
    assert.equal(readingsRemoved, true);
    await assert.rejects(access(filePath));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
