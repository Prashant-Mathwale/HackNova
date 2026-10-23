from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from app.exceptions import DataValidationError


NUMERIC_FIELDS = (
    "active_power_kw",
    "reactive_power",
    "voltage_v",
    "current_a",
    "energy_kwh",
    "sub_metering_1",
    "sub_metering_2",
    "sub_metering_3",
    "temperature",
    "humidity",
)


def normalize_readings(readings: list[dict[str, Any]]) -> pd.DataFrame:
    if not readings:
        raise DataValidationError("At least one reading is required.")
    frame = pd.DataFrame(readings)
    if "timestamp" not in frame or "active_power_kw" not in frame:
        raise DataValidationError("Each reading must include timestamp and active_power_kw (kW).")
    timestamps = pd.to_datetime(frame["timestamp"], errors="coerce", utc=True)
    if timestamps.isna().any():
        raise DataValidationError("One or more timestamps are invalid.")
    if timestamps.duplicated().any():
        raise DataValidationError("Reading timestamps must be unique.")
    frame["timestamp"] = timestamps
    for field in NUMERIC_FIELDS:
        if field in frame:
            frame[field] = pd.to_numeric(frame[field], errors="coerce")
            finite = frame[field].dropna().to_numpy(dtype=float)
            if not np.isfinite(finite).all():
                raise DataValidationError(f"{field} must contain finite numeric values.")
    power = frame["active_power_kw"].dropna()
    if power.empty:
        raise DataValidationError("Readings must include active_power_kw values.")
    if (power < 0).any() or (power > 100000).any():
        raise DataValidationError("active_power_kw must be between 0 and 100000 kW.")
    frame = frame.sort_values("timestamp").drop_duplicates("timestamp", keep="last")
    if frame["active_power_kw"].isna().any():
        raise DataValidationError("active_power_kw cannot be missing.")
    if frame.empty:
        raise DataValidationError("No usable readings were supplied.")
    return frame.reset_index(drop=True)


def quality_report(frame: pd.DataFrame) -> dict[str, Any]:
    deltas = frame.timestamp.diff().dropna().dt.total_seconds().div(60)
    missing_count = int(frame.isna().sum().sum())
    return {
        "rows": int(len(frame)),
        "missing_data_percentage": float(missing_count / frame.size * 100) if frame.size else 0.0,
        "missing_values_by_column": {
            str(key): int(value) for key, value in frame.isna().sum().items()
        },
        "sampling_interval_minutes_median": float(deltas.median()) if not deltas.empty else None,
        "duplicate_timestamps": 0,
        "start_timestamp": frame.timestamp.iloc[0].isoformat(),
        "end_timestamp": frame.timestamp.iloc[-1].isoformat(),
        "warnings": _quality_warnings(frame, deltas),
    }


def _quality_warnings(frame: pd.DataFrame, deltas: pd.Series) -> list[str]:
    warnings: list[str] = []
    if frame.isna().any().any():
        warnings.append("Optional sensor values are missing; missing values were not replaced with zero.")
    if not deltas.empty and deltas.nunique() > 1:
        warnings.append("Sampling intervals vary; energy estimates account for elapsed time.")
    if not deltas.empty and (deltas <= 0).any():
        warnings.append("Non-increasing timestamps were found.")
    return warnings
