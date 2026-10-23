from __future__ import annotations

import os
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent.parent
DATASET_PATH = Path(os.getenv("ENERGYIQ_DATASET_PATH", ROOT_DIR / "household_power_consumption.txt"))
APPLIANCE_DATASET_PATH = Path(
    os.getenv("ENERGYIQ_APPLIANCE_DATASET_PATH", ROOT_DIR / "energydata_complete.csv")
)
ARTIFACT_DIR = Path(os.getenv("ENERGYIQ_ARTIFACT_DIR", ROOT_DIR / "artifacts"))
HOST = os.getenv("ENERGYIQ_HOST", "127.0.0.1")
PORT = int(os.getenv("ENERGYIQ_PORT", "8000"))
DEFAULT_INTERVAL_MINUTES = int(os.getenv("ENERGYIQ_INTERVAL_MINUTES", "1"))
MAX_HORIZON_STEPS = int(os.getenv("ENERGYIQ_MAX_HORIZON_STEPS", "60"))
MAX_REQUEST_BATCH_SIZE = int(os.getenv("ENERGYIQ_MAX_BATCH_SIZE", "10000"))
ANOMALY_CONTAMINATION = float(os.getenv("ENERGYIQ_ANOMALY_CONTAMINATION", "0.02"))
if not 0.001 <= ANOMALY_CONTAMINATION <= 0.5:
    raise ValueError("ENERGYIQ_ANOMALY_CONTAMINATION must be between 0.001 and 0.5.")
PEAK_POWER_THRESHOLD_KW = float(os.getenv("ENERGYIQ_PEAK_THRESHOLD_KW", "5.0"))
