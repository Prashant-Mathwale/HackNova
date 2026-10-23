import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import mongoose from 'mongoose';
import { parseAndStoreCsv } from '../src/services/csv.service.js';
import { Reading } from '../src/models/Reading.js';

const header = 'Date;Time;Global_active_power;Global_reactive_power;Voltage;Global_intensity;Sub_metering_1;Sub_metering_2;Sub_metering_3';
const validRow = '01/01/2007;00:00:00;2.45;0.2;230.1;10.5;0;1;5';

async function withCsv(contents, callback) {
  const directory = await mkdtemp(path.join(tmpdir(), 'energyiq-test-'));
  const filePath = path.join(directory, 'readings.csv');
  await writeFile(filePath, contents);
  try {
    await callback(filePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('recognizes missing values and stores valid chronological UCI readings', async () => {
  const analysisId = new mongoose.Types.ObjectId();
  const inserted = [];
  const originalInsertMany = Reading.insertMany;
  Reading.insertMany = async (documents) => inserted.push(...documents);
  try {
    await withCsv(`${header}\n${validRow}\n02/01/2007;00:01:00;?;0.2;230.1;10.5;0;1;5\n02/01/2007;00:02:00;1.5;?;230.1;10.5;0;1;5\n`, async (filePath) => {
      const result = await parseAndStoreCsv(filePath, analysisId);
      assert.equal(result.summary.validReadingCount, 2);
      assert.equal(result.summary.invalidRows, 1);
      assert.equal(result.summary.missingValues, 2);
      assert.equal(result.forecastReadings.length, 2);
      assert.equal(inserted.length, 2);
      assert.equal(result.summary.averageActivePowerKw, 1.975);
    });
  } finally {
    Reading.insertMany = originalInsertMany;
  }
});

test('rejects missing headers and empty datasets', async () => {
  await withCsv('Date;Time;Global_active_power\n', async (filePath) => {
    await assert.rejects(parseAndStoreCsv(filePath, new mongoose.Types.ObjectId()), {
      code: 'INVALID_CSV'
    });
  });
  await withCsv(`${header}\n`, async (filePath) => {
    await assert.rejects(parseAndStoreCsv(filePath, new mongoose.Types.ObjectId()), {
      code: 'INVALID_CSV'
    });
  });
});

test('rejects duplicate header names', async () => {
  const duplicateHeader = header.replace('Global_reactive_power', 'Date');
  await withCsv(`${duplicateHeader}\n${validRow}\n`, async (filePath) => {
    await assert.rejects(parseAndStoreCsv(filePath, new mongoose.Types.ObjectId()), {
      code: 'INVALID_CSV'
    });
  });
});

test('rejects out-of-order and duplicate timestamps according to the skip policy', async () => {
  const analysisId = new mongoose.Types.ObjectId();
  const originalInsertMany = Reading.insertMany;
  Reading.insertMany = async () => [];
  try {
    await withCsv(`${header}\n${validRow}\n${validRow}\n`, async (filePath) => {
      const result = await parseAndStoreCsv(filePath, analysisId);
      assert.equal(result.summary.validReadingCount, 1);
      assert.equal(result.summary.invalidRows, 1);
    });
  } finally {
    Reading.insertMany = originalInsertMany;
  }
});

test('enforces the configured data row limit', async () => {
  await withCsv(`${header}\n${validRow}\n${validRow.replace('00:00:00', '00:01:00')}\n`, async (filePath) => {
    await assert.rejects(
      parseAndStoreCsv(filePath, new mongoose.Types.ObjectId(), 1),
      { code: 'ROW_LIMIT_EXCEEDED' }
    );
  });
});

test('rejects invalid calendar timestamps', async () => {
  const originalInsertMany = Reading.insertMany;
  Reading.insertMany = async () => [];
  try {
    await withCsv(`${header}\n31/02/2007;00:00:00;1.2;0.1;230;5;0;0;0\n`, async (filePath) => {
      await assert.rejects(parseAndStoreCsv(filePath, new mongoose.Types.ObjectId()), {
        code: 'NO_VALID_READINGS'
      });
    });
  } finally {
    Reading.insertMany = originalInsertMany;
  }
});

test('rejects out-of-range measurement values instead of retaining them', async () => {
  const originalInsertMany = Reading.insertMany;
  Reading.insertMany = async () => [];
  try {
    await withCsv(`${header}\n01/01/2007;00:00:00;101;0.1;230;5;0;0;0\n`, async (filePath) => {
      await assert.rejects(parseAndStoreCsv(filePath, new mongoose.Types.ObjectId()), {
        code: 'NO_VALID_READINGS'
      });
    });
  } finally {
    Reading.insertMany = originalInsertMany;
  }
});
