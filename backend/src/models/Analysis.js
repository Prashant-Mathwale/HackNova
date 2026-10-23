import mongoose from 'mongoose';

const analysisSchema = new mongoose.Schema({
  fileName: { type: String, required: true, maxlength: 255 },
  fileSizeBytes: { type: Number, required: true, min: 0 },
  fileHash: { type: String, match: /^[a-f0-9]{64}$/i },
  status: { type: String, enum: ['processing', 'completed', 'failed'], required: true, default: 'processing' },
  datasetFormat: { type: String, default: 'uci-household-electric-power-consumption' },
  totalRows: { type: Number, default: 0, min: 0 },
  invalidRows: { type: Number, default: 0, min: 0 },
  missingValues: { type: Number, default: 0, min: 0 },
  dateRange: {
    start: Date,
    end: Date
  },
  availableColumns: { type: [String], default: [] },
  summary: {
    averageActivePowerKw: Number,
    minActivePowerKw: Number,
    maxActivePowerKw: Number,
    peakTimestamp: Date,
    observedActivePowerSampleSumKw: Number,
    validReadingCount: Number
  },
  forecast: {
    predictions: [{
      timestamp: Date,
      predictedActivePowerKw: Number
    }],
    horizon: Number,
    unit: String,
    modelVersion: String,
    validation: mongoose.Schema.Types.Mixed
  },
  anomalySummary: {
    totalFlagged: { type: Number, default: 0 },
    evaluatedReadings: { type: Number, default: 0 },
    classification: { type: String, default: 'Model-flagged statistical outliers; not verified faults.' }
  },
  modelVersion: String,
  processingDurationMs: Number,
  error: {
    code: String,
    message: String
  }
}, { timestamps: true, minimize: false });

analysisSchema.index({ createdAt: -1 });
analysisSchema.index({ status: 1, createdAt: -1 });

export const Analysis = mongoose.models.Analysis || mongoose.model('Analysis', analysisSchema);
