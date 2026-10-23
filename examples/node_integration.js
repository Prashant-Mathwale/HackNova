const express = require("express");

const router = express.Router();
const mlUrl = process.env.ENERGYIQ_ML_URL || "http://127.0.0.1:8000";
const timeoutMs = Number(process.env.ENERGYIQ_ML_TIMEOUT_MS || 10000);

async function mlRequest(path, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${mlUrl}${path}`, {
      method: payload ? "POST" : "GET",
      headers: payload ? { "Content-Type": "application/json" } : {},
      body: payload ? JSON.stringify(payload) : undefined,
      signal: controller.signal,
    });
    const body = await response.json();
    if (!response.ok) {
      const error = new Error(body.detail || `ML service returned HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

router.get("/ml/health", async (_req, res, next) => {
  try {
    res.json({ health: await mlRequest("/health"), models: await mlRequest("/models/status") });
  } catch (error) {
    next(error);
  }
});

router.post("/ml/forecast", async (req, res, next) => {
  try {
    res.json(await mlRequest("/predict/consumption", req.body));
  } catch (error) {
    next(error);
  }
});

router.post("/ml/anomalies", async (req, res, next) => {
  try {
    res.json(await mlRequest("/detect/anomalies", req.body));
  } catch (error) {
    next(error);
  }
});

router.post("/ml/analyze", async (req, res, next) => {
  try {
    res.json(await mlRequest("/analyze", req.body));
  } catch (error) {
    next(error);
  }
});

router.post("/ml/recommendations", async (req, res, next) => {
  try {
    res.json(await mlRequest("/recommendations", req.body));
  } catch (error) {
    next(error);
  }
});

module.exports = { router, mlRequest };
