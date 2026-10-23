import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import readline from 'node:readline';
import { parse } from 'csv-parse';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import { Reading } from '../models/Reading.js';

export const UCI_COLUMNS = [
  'Date',
  'Time',
  'Global_active_power',
  'Global_reactive_power',
  'Voltage',
  'Global_intensity',
  'Sub_metering_1',
  'Sub_metering_2',
  'Sub_metering_3'
];

const MEASUREMENT_COLUMNS = UCI_COLUMNS.slice(2);
const MEASUREMENT_MAXIMUMS = {
  Global_active_power: 100,
  Global_reactive_power: 100,
  Voltage: 500,
  Global_intensity: 1000,
  Sub_metering_1: 100000,
  Sub_metering_2: 100000,
  Sub_metering_3: 100000
};
const BATCH_SIZE = 1000;

async function detectDelimiter(filePath) {
  const input = createReadStream(filePath, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (line.trim()) {
        const semicolonCount = (line.match(/;/g) ?? []).length;
        const commaCount = (line.match(/,/g) ?? []).length;
        if (semicolonCount === UCI_COLUMNS.length - 1) return ';';
        if (commaCount === UCI_COLUMNS.length - 1) return ',';
        throw new AppError(422, 'INVALID_CSV', 'The CSV header does not use a supported delimiter.');
      }
    }
    throw new AppError(422, 'INVALID_CSV', 'The uploaded CSV is empty.');
  } finally {
    lines.close();
    input.destroy();
  }
}

function parseTimestamp(dateValue, timeValue) {
  const dateMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dateValue ?? '');
  const timeMatch = /^(\d{2}):(\d{2}):(\d{2})$/.exec(timeValue ?? '');
  if (!dateMatch || !timeMatch) return null;
  const [, day, month, year] = dateMatch;
  const [, hour, minute, second] = timeMatch;
  const timestamp = new Date(Date.UTC(+year, +month - 1, +day, +hour, +minute, +second));
  if (
    timestamp.getUTCFullYear() !== +year ||
    timestamp.getUTCMonth() !== +month - 1 ||
    timestamp.getUTCDate() !== +day ||
    +hour > 23 ||
    +minute > 59 ||
    +second > 59
  ) return null;
  return timestamp;
}

function parseMeasurement(value, minimum, maximum) {
  const normalized = value?.trim();
  if (!normalized || normalized === '?') return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : Number.NaN;
}

export async function hashFile(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

export async function parseAndStoreCsv(filePath, analysisId, maxRows = env.MAX_CSV_ROWS, deadline = Number.POSITIVE_INFINITY) {
  const delimiter = await detectDelimiter(filePath);
  const parser = createReadStream(filePath).pipe(parse({
    columns: (header) => {
      const normalized = header.map((column) => column.trim().replace(/^\uFEFF/, ''));
      if (new Set(normalized).size !== normalized.length) {
        throw new AppError(422, 'INVALID_CSV', 'The CSV header contains duplicate column names.');
      }
      return normalized;
    },
    delimiter,
    bom: true,
    skip_empty_lines: true,
    trim: true,
    max_record_size: 64 * 1024
  }));

  const batch = [];
  const forecastReadings = [];
  let forecastOffset = 0;
  const summary = {
    totalRows: 0,
    invalidRows: 0,
    missingValues: 0,
    validReadingCount: 0,
    sum: 0,
    min: Number.POSITIVE_INFINITY,
    max: Number.NEGATIVE_INFINITY,
    peakTimestamp: null,
    start: null,
    end: null
  };
  const columns = new Set();
  let lastTimestamp = null;

  async function flushBatch() {
    if (batch.length) {
      await Reading.insertMany(batch.splice(0), { ordered: true });
    }
  }

  try {
    let isFirstRecord = true;
    for await (const row of parser) {
      if (Date.now() > deadline) {
        throw new AppError(503, 'ANALYSIS_TIMEOUT', 'Analysis exceeded the configured processing time limit.');
      }
      if (isFirstRecord) {
        isFirstRecord = false;
        const missingColumns = UCI_COLUMNS.filter((column) => !(column in row));
        if (missingColumns.length) {
          throw new AppError(422, 'INVALID_CSV', 'The CSV is missing required columns.', missingColumns);
        }
        for (const column of Object.keys(row)) columns.add(column);
      }

      summary.totalRows += 1;
      if (summary.totalRows > maxRows) {
        throw new AppError(422, 'ROW_LIMIT_EXCEEDED', `The CSV exceeds the maximum of ${maxRows} data rows.`);
      }

      const timestamp = parseTimestamp(row.Date, row.Time);
      const measurements = Object.fromEntries(
        MEASUREMENT_COLUMNS.map((column) => [
          column,
          parseMeasurement(row[column], column === 'Voltage' ? Number.MIN_VALUE : 0, MEASUREMENT_MAXIMUMS[column])
        ])
      );
      summary.missingValues += Object.values(measurements).filter((value) => value === null).length;

      const activePower = measurements.Global_active_power;
      const invalidNumber = Object.values(measurements).some((value) => Number.isNaN(value));
      if (!timestamp) {
        summary.invalidRows += 1;
        forecastReadings.length = 0;
        forecastOffset = 0;
        continue;
      }
      if (lastTimestamp && timestamp <= lastTimestamp) {
        summary.invalidRows += 1;
        forecastReadings.length = 0;
        forecastOffset = 0;
        continue;
      }

      const consecutive = !lastTimestamp || timestamp.getTime() - lastTimestamp.getTime() === 60_000;
      lastTimestamp = timestamp;
      if (!consecutive || activePower === null || invalidNumber) {
        forecastReadings.length = 0;
        forecastOffset = 0;
      }
      if (activePower === null || invalidNumber) {
        summary.invalidRows += 1;
        continue;
      }

      const reading = { analysisId, timestamp, ...measurements };
      batch.push(reading);
      summary.validReadingCount += 1;
      summary.sum += activePower;
      if (activePower < summary.min) summary.min = activePower;
      if (activePower > summary.max) {
        summary.max = activePower;
        summary.peakTimestamp = timestamp;
      }
      if (!summary.start) summary.start = timestamp;
      summary.end = timestamp;
      if (reading.Global_active_power !== null) {
        if (forecastReadings.length < env.FORECAST_HISTORY_ROWS) {
          forecastReadings.push(reading);
        } else {
          forecastReadings[forecastOffset] = reading;
          forecastOffset = (forecastOffset + 1) % env.FORECAST_HISTORY_ROWS;
        }
      }
      if (batch.length >= BATCH_SIZE) await flushBatch();
    }
    if (isFirstRecord) {
      throw new AppError(422, 'INVALID_CSV', 'The CSV does not contain a header and data rows.');
    }
    await flushBatch();
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error?.code === 'ENOENT') throw error;
    throw new AppError(422, 'INVALID_CSV', 'The CSV contains malformed or unreadable records.');
  }

  if (summary.validReadingCount === 0) {
    throw new AppError(422, 'NO_VALID_READINGS', 'The CSV contains no usable readings.');
  }

  return {
    columns: [...columns],
    forecastReadings: forecastOffset === 0
      ? forecastReadings
      : [...forecastReadings.slice(forecastOffset), ...forecastReadings.slice(0, forecastOffset)],
    summary: {
      totalRows: summary.totalRows,
      invalidRows: summary.invalidRows,
      missingValues: summary.missingValues,
      validReadingCount: summary.validReadingCount,
      averageActivePowerKw: summary.sum / summary.validReadingCount,
      minActivePowerKw: summary.min,
      maxActivePowerKw: summary.max,
      peakTimestamp: summary.peakTimestamp,
      observedActivePowerSampleSumKw: summary.sum,
      start: summary.start,
      end: summary.end
    }
  };
}
