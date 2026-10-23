import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import mongoose from 'mongoose';
import app from '../src/app.js';
import { Analysis } from '../src/models/Analysis.js';
import { Reading } from '../src/models/Reading.js';

after(async () => {
  await mongoose.disconnect();
});

test('health reports dependency state and includes a request ID', async () => {
  const response = await request(app).get('/api/health');
  assert.ok([200, 503].includes(response.status));
  assert.equal(response.body.success, true);
  assert.ok(response.body.data.database);
  assert.ok(response.headers['x-request-id']);
});

test('unknown routes use the common error response format', async () => {
  const response = await request(app).get('/missing');
  assert.equal(response.status, 404);
  assert.equal(response.body.success, false);
  assert.equal(response.body.error.code, 'NOT_FOUND');
  assert.ok(response.body.requestId);
});

test('analysis ID validation rejects invalid IDs before querying MongoDB', async () => {
  const response = await request(app).get('/api/analyses/not-an-id');
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'INVALID_ANALYSIS_ID');
});

test('analysis history applies pagination, status, and sort filters', async () => {
  const originalFind = Analysis.find;
  const originalCountDocuments = Analysis.countDocuments;
  let receivedFilter;
  let receivedSort;
  let receivedSkip;
  let receivedLimit;
  const query = {
    select() { return this; },
    sort(value) { receivedSort = value; return this; },
    skip(value) { receivedSkip = value; return this; },
    limit(value) { receivedLimit = value; return this; },
    async lean() { return []; }
  };
  Analysis.find = (filter) => {
    receivedFilter = filter;
    return query;
  };
  Analysis.countDocuments = async () => 8;
  try {
    const response = await request(app)
      .get('/api/analyses?page=2&pageSize=3&status=failed&sort=asc');
    assert.equal(response.status, 200);
    assert.deepEqual(receivedFilter, { status: 'failed' });
    assert.deepEqual(receivedSort, { createdAt: 1 });
    assert.equal(receivedSkip, 3);
    assert.equal(receivedLimit, 3);
    assert.deepEqual(response.body.data.pagination, {
      page: 2,
      pageSize: 3,
      total: 8,
      totalPages: 3
    });
  } finally {
    Analysis.find = originalFind;
    Analysis.countDocuments = originalCountDocuments;
  }
});

test('analysis history rejects page sizes over the documented cap', async () => {
  const response = await request(app).get('/api/analyses?pageSize=101');
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'INVALID_QUERY');
});

test('returns forecast data for completed analyses and 404 for missing analyses', async () => {
  const originalFindById = Analysis.findById;
  const analysisId = new mongoose.Types.ObjectId();
  Analysis.findById = () => ({
    select() {
      return this;
    },
    async lean() {
      return {
        _id: analysisId,
        status: 'completed',
        forecast: {
          predictions: [{ timestamp: new Date('2007-01-01T00:02:00Z'), predictedActivePowerKw: 2.1 }],
          unit: 'kW',
          horizon: 1,
          modelVersion: 'rf-test',
          validation: {}
        }
      };
    }
  });
  try {
    const found = await request(app).get(`/api/analyses/${analysisId}/forecast`);
    assert.equal(found.status, 200);
    assert.equal(found.body.data.predictions[0].predictedActivePowerKw, 2.1);

    Analysis.findById = () => ({
      select() {
        return this;
      },
      async lean() {
        return null;
      }
    });
    const missing = await request(app).get(`/api/analyses/${analysisId}`);
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, 'ANALYSIS_NOT_FOUND');
  } finally {
    Analysis.findById = originalFindById;
  }
});

test('paginates anomaly details and deletes an analysis with its readings', async () => {
  const originalFindById = Analysis.findById;
  const originalReadingFind = Reading.find;
  const originalReadingCountDocuments = Reading.countDocuments;
  const originalReadingDeleteMany = Reading.deleteMany;
  const originalFindByIdAndDelete = Analysis.findByIdAndDelete;
  const analysisId = new mongoose.Types.ObjectId();
  let deletedReadings;
  let deletedAnalysis;
  Analysis.findById = () => ({
    select() {
      return this;
    },
    async lean() {
      return {
        _id: analysisId,
        status: 'completed',
        anomalySummary: {
          totalFlagged: 2,
          classification: 'Model-flagged statistical outliers; not verified faults.'
        }
      };
    }
  });
  Reading.find = () => ({
    select() {
      return this;
    },
    sort() {
      return this;
    },
    skip() {
      return this;
    },
    limit() {
      return this;
    },
    async lean() {
      return [{
        timestamp: new Date('2007-01-01T00:00:00Z'),
        Global_active_power: 2.5,
        anomalyScore: 0.9
      }];
    }
  });
  Reading.countDocuments = async () => 2;
  Reading.deleteMany = async (filter) => { deletedReadings = filter; };
  Analysis.findByIdAndDelete = async (id) => {
    deletedAnalysis = id;
    return { _id: id };
  };
  try {
    const anomalies = await request(app)
      .get(`/api/analyses/${analysisId}/anomalies?page=2&pageSize=1`);
    assert.equal(anomalies.status, 200);
    assert.equal(anomalies.body.data.totalFlagged, 2);
    assert.equal(anomalies.body.data.items[0].score, 0.9);
    assert.equal(anomalies.body.data.pagination.page, 2);

    const deletion = await request(app).delete(`/api/analyses/${analysisId}`);
    assert.equal(deletion.status, 200);
    assert.equal(deletion.body.data.deleted, true);
    assert.deepEqual(deletedReadings, { analysisId: String(analysisId) });
    assert.equal(String(deletedAnalysis), String(analysisId));
  } finally {
    Analysis.findById = originalFindById;
    Reading.find = originalReadingFind;
    Reading.countDocuments = originalReadingCountDocuments;
    Reading.deleteMany = originalReadingDeleteMany;
    Analysis.findByIdAndDelete = originalFindByIdAndDelete;
  }
});

test('upload rejects missing file and unsupported extensions', async () => {
  const missing = await request(app).post('/api/uploads');
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error.code, 'FILE_REQUIRED');

  const unsupported = await request(app)
    .post('/api/uploads')
    .attach('file', Buffer.from('not csv'), { filename: 'data.txt', contentType: 'text/plain' });
  assert.equal(unsupported.status, 415);
});

test('getAnalysis returns availableColumns along with analysis metadata', async () => {
  const originalFindById = Analysis.findById;
  const analysisId = new mongoose.Types.ObjectId();
  const mockCols = ['Date', 'Time', 'Global_active_power', 'Voltage'];
  Analysis.findById = () => ({
    select() {
      return this;
    },
    async lean() {
      return {
        _id: analysisId,
        fileName: 'test.csv',
        status: 'completed',
        availableColumns: mockCols
      };
    }
  });
  try {
    const res = await request(app).get(`/api/analyses/${analysisId}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.availableColumns, mockCols);
    assert.equal(res.body.data.analysisId, String(analysisId));
  } finally {
    Analysis.findById = originalFindById;
  }
});
