from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor

from app.utils.metrics import regression_metrics

PEAK_FEATURES = ("power_lag_1", "power_lag_2", "power_lag_3", "hour_sin", "hour_cos", "weekday_sin", "weekday_cos")


def train_peak_model(frame: pd.DataFrame, dataset: dict[str, Any], artifact_dir: Path) -> dict[str, Any]:
    hourly = frame.set_index("timestamp")["active_power_kw"].resample("1h").max().rename("peak_kw").to_frame()
    valid_hours = int(hourly.peak_kw.notna().sum())
    if valid_hours < 24 * 14:
        raise ValueError(f"Peak model requires at least 14 days of hourly history ({valid_hours} valid hours found).")
    values = hourly.peak_kw
    data = pd.DataFrame(index=hourly.index)
    for lag in (1, 2, 3):
        data[f"power_lag_{lag}"] = values.shift(lag - 1)
    next_time = data.index + pd.Timedelta(hours=1)
    hour = next_time.hour
    weekday = next_time.dayofweek
    data["hour_sin"] = np.sin(2 * np.pi * hour / 24)
    data["hour_cos"] = np.cos(2 * np.pi * hour / 24)
    data["weekday_sin"] = np.sin(2 * np.pi * weekday / 7)
    data["weekday_cos"] = np.cos(2 * np.pi * weekday / 7)
    target = values.shift(-1)
    following_hour = pd.Series(hourly.index, index=hourly.index).shift(-1)
    consecutive_hours = following_hour.sub(pd.Series(hourly.index, index=hourly.index)).eq(pd.Timedelta(hours=1))
    valid = data.notna().all(axis=1) & target.notna() & consecutive_hours
    data, target = data.loc[valid], target.loc[valid]
    split = int(len(data) * 0.8)
    model = RandomForestRegressor(n_estimators=80, max_depth=12, min_samples_leaf=2, random_state=42, n_jobs=-1)
    model.fit(data.iloc[:split], target.iloc[:split])
    predictions = model.predict(data.iloc[split:])
    baseline = data.iloc[split:]["power_lag_1"]
    metadata = {
        "model_name": "hourly_peak_random_forest",
        "version": "1.0",
        "training_timestamp": datetime.now(timezone.utc).isoformat(),
        "dataset": dataset.get("source"),
        "target": "maximum active_power_kw in the next clock-hour bucket",
        "features": list(PEAK_FEATURES),
        "training_hours": int(len(data)),
        "test_metrics": {
            "random_forest": regression_metrics(target.iloc[split:], predictions),
            "previous_hour_peak_baseline": regression_metrics(target.iloc[split:], baseline),
        },
    }
    artifact_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": model, "metadata": metadata, "last_hourly_values": values.tail(3).tolist()}, artifact_dir / "peak_prediction.joblib")
    return metadata


def load_peak_model(artifact_dir: Path) -> dict[str, Any] | None:
    path = artifact_dir / "peak_prediction.joblib"
    if not path.is_file():
        return None
    artifact = joblib.load(path)
    if (
        not isinstance(artifact, dict)
        or not {"model", "metadata"}.issubset(artifact)
        or not isinstance(artifact["metadata"], dict)
        or not hasattr(artifact["model"], "predict")
        or artifact["metadata"].get("features") != list(PEAK_FEATURES)
    ):
        raise ValueError(f"Invalid peak artifact: {path.name}")
    return artifact
