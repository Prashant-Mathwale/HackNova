from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd

from app.exceptions import DataValidationError


HOUSEHOLD_COLUMNS = {
    "Global_active_power": "active_power_kw",
    "Global_reactive_power": "reactive_power",
    "Voltage": "voltage_v",
    "Global_intensity": "current_a",
    "Sub_metering_1": "sub_metering_1",
    "Sub_metering_2": "sub_metering_2",
    "Sub_metering_3": "sub_metering_3",
}
APPLIANCE_COLUMNS = {
    "date": "timestamp",
    "Appliances": "appliances_wh",
    "T_out": "temperature_outdoor_c",
    "RH_out": "humidity_outdoor_pct",
}


def load_household_dataset(path: str | Path) -> tuple[pd.DataFrame, dict[str, Any]]:
    """Load and normalize the UCI semicolon-delimited household dataset."""
    source = Path(path)
    if not source.is_file():
        raise DataValidationError(f"Dataset not found: {source}")
    try:
        frame = pd.read_csv(source, sep=";", na_values=["?", "", " "], low_memory=False)
    except (OSError, pd.errors.ParserError, UnicodeError) as exc:
        raise DataValidationError(f"Unable to read household dataset: {exc}") from exc

    required = {"Date", "Time", "Global_active_power"}
    if not required.issubset(frame.columns):
        raise DataValidationError("Household dataset must contain Date, Time, and Global_active_power.")

    timestamps = pd.to_datetime(
        frame["Date"].astype("string").str.strip() + " " + frame["Time"].astype("string").str.strip(),
        format="%d/%m/%Y %H:%M:%S",
        errors="coerce",
    ).dt.tz_localize("UTC")
    invalid_timestamps = int(timestamps.isna().sum())
    normalized = pd.DataFrame({"timestamp": timestamps})
    source_missing_values: dict[str, int] = {}
    for source_name, target_name in HOUSEHOLD_COLUMNS.items():
        if source_name in frame:
            normalized[target_name] = pd.to_numeric(frame[source_name], errors="coerce")
            source_missing_values[target_name] = int(normalized[target_name].isna().sum())
    normalized = normalized.dropna(subset=["timestamp", "active_power_kw"])
    duplicate_count = int(normalized["timestamp"].duplicated(keep="last").sum())
    normalized = normalized.drop_duplicates("timestamp", keep="last").sort_values("timestamp")
    normalized = normalized.reset_index(drop=True)
    if normalized.empty:
        raise DataValidationError("Household dataset contains no usable timestamped power readings.")

    missing_timestamps = _count_missing_intervals(normalized["timestamp"])
    deltas = normalized["timestamp"].diff().dropna().dt.total_seconds().div(60)
    quality = {
        "source": str(source.name),
        "rows_read": int(len(frame)),
        "rows_usable": int(len(normalized)),
        "invalid_timestamps": invalid_timestamps,
        "duplicate_timestamps_removed": duplicate_count,
        "missing_values_by_column": source_missing_values,
        "missing_data_percentage": float(
            sum(source_missing_values.values()) / max(1, len(frame) * len(source_missing_values)) * 100
        ),
        "missing_intervals_estimated": missing_timestamps,
        "sampling_interval_minutes_median": float(deltas.median()) if not deltas.empty else None,
        "sampling_interval_minutes_min": float(deltas.min()) if not deltas.empty else None,
        "sampling_interval_minutes_max": float(deltas.max()) if not deltas.empty else None,
        "start_timestamp": normalized["timestamp"].iloc[0].isoformat(),
        "end_timestamp": normalized["timestamp"].iloc[-1].isoformat(),
        "active_power_unit": "kW",
        "synthetic": False,
    }
    return normalized, quality


def load_appliance_dataset(path: str | Path) -> tuple[pd.DataFrame, dict[str, Any]]:
    """Load the UCI Appliances Energy Prediction dataset independently."""
    source = Path(path)
    if not source.is_file():
        raise DataValidationError(f"Appliance dataset not found: {source}")
    try:
        frame = pd.read_csv(source)
    except (OSError, pd.errors.ParserError, UnicodeError) as exc:
        raise DataValidationError(f"Unable to read appliance dataset: {exc}") from exc
    if not {"date", "Appliances"}.issubset(frame.columns):
        raise DataValidationError("Appliance dataset must contain date and Appliances columns.")
    normalized = pd.DataFrame(
        {
            "timestamp": pd.to_datetime(frame["date"], errors="coerce").dt.tz_localize("UTC"),
            "appliances_wh": pd.to_numeric(frame["Appliances"], errors="coerce"),
        }
    )
    for source_name, target_name in APPLIANCE_COLUMNS.items():
        if source_name not in {"date", "Appliances"} and source_name in frame:
            normalized[target_name] = pd.to_numeric(frame[source_name], errors="coerce")
    normalized = normalized.dropna(subset=["timestamp", "appliances_wh"])
    normalized = normalized.drop_duplicates("timestamp", keep="last").sort_values("timestamp")
    normalized = normalized.reset_index(drop=True)
    if normalized.empty:
        raise DataValidationError("Appliance dataset contains no usable records.")
    return normalized, {
        "source": source.name,
        "rows_read": int(len(frame)),
        "rows_usable": int(len(normalized)),
        "start_timestamp": normalized.timestamp.iloc[0].isoformat(),
        "end_timestamp": normalized.timestamp.iloc[-1].isoformat(),
        "target_unit": "Wh per recorded interval (as documented by UCI)",
        "synthetic": False,
    }


def _count_missing_intervals(timestamps: pd.Series) -> int:
    deltas = timestamps.diff().dropna().dt.total_seconds().div(60)
    if deltas.empty:
        return 0
    # Count absent samples only where the observed interval is close to an integer multiple
    # of the modal sampling interval; irregular gaps are reported separately by the range.
    nominal = float(deltas.round().mode().iloc[0])
    if nominal <= 0:
        return 0
    ratios = (deltas / nominal).round()
    valid_gaps = (ratios >= 2) & ((deltas - ratios * nominal).abs() < 0.01)
    return int((ratios[valid_gaps] - 1).sum())
