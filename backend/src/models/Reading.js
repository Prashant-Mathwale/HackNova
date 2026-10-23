import mongoose from 'mongoose';

const readingSchema = new mongoose.Schema({
  analysisId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  timestamp: { type: Date, required: true },
  Global_active_power: { type: Number, min: 0, default: null },
  Global_reactive_power: { type: Number, min: 0, default: null },
  Voltage: { type: Number, min: 0, default: null },
  Global_intensity: { type: Number, min: 0, default: null },
  Sub_metering_1: { type: Number, min: 0, default: null },
  Sub_metering_2: { type: Number, min: 0, default: null },
  Sub_metering_3: { type: Number, min: 0, default: null },
  anomaly: { type: Boolean, default: false },
  anomalyScore: Number
}, { versionKey: false });

readingSchema.index({ analysisId: 1, timestamp: 1 }, { unique: true });
readingSchema.index({ analysisId: 1, anomaly: 1, timestamp: 1 });

export const Reading = mongoose.models.Reading || mongoose.model('Reading', readingSchema);
