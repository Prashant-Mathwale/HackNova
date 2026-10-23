from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from app.data.validation import quality_report


def consumption_statistics(frame: pd.DataFrame, tariff_inr_per_kwh: float | None = None) -> dict[str, Any]:
    data = frame.sort_values("timestamp").copy()
    power = data.active_power_kw.astype(float)
    timestamps = data.timestamp
    deltas_hours = timestamps.diff().dt.total_seconds().div(3600)
    interval_energy = ((power + power.shift(1)) / 2) * deltas_hours
    estimated_energy = float(interval_energy.dropna().sum())
    data["interval_energy_estimated_kwh"] = interval_energy.fillna(0)
    measured_energy = None
    if "energy_kwh" in data and data.energy_kwh.notna().any():
        measured_energy = float(data.energy_kwh.sum(skipna=True))
    peak_index = power.idxmax()
    data["hour"] = timestamps.dt.hour
    data["day"] = timestamps.dt.date
    data["is_weekend"] = timestamps.dt.dayofweek >= 5
    hourly = data.groupby(data.timestamp.dt.floor("h")).agg(
        mean_power_kw=("active_power_kw", "mean"),
        peak_power_kw=("active_power_kw", "max"),
        estimated_energy_kwh=("interval_energy_estimated_kwh", "sum"),
    ).reset_index()
    daily = data.groupby("day").agg(
        mean_power_kw=("active_power_kw", "mean"),
        peak_power_kw=("active_power_kw", "max"),
        readings=("active_power_kw", "count"),
        estimated_energy_kwh=("interval_energy_estimated_kwh", "sum"),
    ).reset_index()
    day_power = data.loc[data.timestamp.dt.hour.between(7, 17), "active_power_kw"]
    night_power = data.loc[data.timestamp.dt.hour.isin(list(range(0, 7)) + list(range(18, 24))), "active_power_kw"]
    overnight_power = data.loc[data.timestamp.dt.hour.between(0, 5), "active_power_kw"]
    weekday_mean = data.loc[~data.is_weekend, "active_power_kw"].mean()
    weekend_mean = data.loc[data.is_weekend, "active_power_kw"].mean()
    half = max(1, len(data) // 2)
    recent_mean = float(power.iloc[-half:].mean())
    earlier_mean = float(power.iloc[:half].mean())
    delta = timestamps.diff().dt.total_seconds().div(3600)
    warnings = []
    if delta.dropna().gt(1).any():
        warnings.append("Some readings are separated by more than one hour; integrated energy across those gaps may be uncertain.")
    if measured_energy is None:
        warnings.append("Energy is estimated by trapezoidal integration of active power (kW) over elapsed time.")
    result: dict[str, Any] = {
        "active_power_unit": "kW",
        "estimated_energy_kwh": estimated_energy,
        "measured_energy_kwh": measured_energy,
        "average_active_power_kw": float(power.mean()),
        "maximum_active_power_kw": float(power.max()),
        "minimum_active_power_kw": float(power.min()),
        "peak_timestamp": timestamps.loc[peak_index].isoformat(),
        "peak_power_kw": float(power.loc[peak_index]),
        "hourly": [],
        "daily": [
            {
                "date": str(row["day"]),
                "average_power_kw": float(row["mean_power_kw"]),
                "peak_power_kw": float(row["peak_power_kw"]),
                "estimated_energy_kwh": float(row["estimated_energy_kwh"]),
                "readings": int(row["readings"]),
            }
            for _, row in daily.iterrows()
        ],
        "weekday_average_power_kw": _finite_or_none(weekday_mean),
        "weekend_average_power_kw": _finite_or_none(weekend_mean),
        "day_average_power_kw": _finite_or_none(day_power.mean()),
        "night_average_power_kw": _finite_or_none(night_power.mean()),
        "overnight_average_power_kw": _finite_or_none(overnight_power.mean()),
        "recent_vs_earlier_change_percent": (
            float((recent_mean - earlier_mean) / abs(earlier_mean) * 100) if earlier_mean else None
        ),
        "data_quality": quality_report(frame),
        "warnings": warnings,
    }
    result["hourly"] = [
        {
            "timestamp": row["timestamp"].isoformat(),
            "average_power_kw": float(row["mean_power_kw"]),
            "peak_power_kw": float(row["peak_power_kw"]),
            "estimated_energy_kwh": float(row["estimated_energy_kwh"]),
        }
        for _, row in hourly.iterrows()
    ]
    if tariff_inr_per_kwh is not None:
        result["estimated_cost_inr"] = estimated_energy * tariff_inr_per_kwh
        result["cost_assumptions"] = "Estimated energy multiplied by the user-supplied INR/kWh tariff."
    return result


def _finite_or_none(value) -> float | None:
    return float(value) if pd.notna(value) and np.isfinite(value) else None
