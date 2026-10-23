from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import pandas as pd
from sklearn.ensemble import RandomForestRegressor

from app.utils.metrics import regression_metrics

APPLIANCE_FEATURES = (
    "temperature_outdoor_c",
    "humidity_outdoor_pct",
    "hour",
    "weekday",
)


def train_appliance_model(frame: pd.DataFrame, dataset: dict[str, Any], artifact_dir: Path) -> dict[str, Any]:
    data = frame.copy()
    data["hour"] = data.timestamp.dt.hour
    data["weekday"] = data.timestamp.dt.dayofweek
    features = data.reindex(columns=APPLIANCE_FEATURES)
    target = data["appliances_wh"]
    valid = features.notna().all(axis=1) & target.notna()
    features, target = features.loc[valid], target.loc[valid]
    if len(features) < 100:
        raise ValueError(f"Appliance model requires at least 100 valid rows ({len(features)} found).")
    split = int(len(features) * 0.8)
    model = RandomForestRegressor(n_estimators=80, max_depth=14, min_samples_leaf=2, random_state=42, n_jobs=-1)
    model.fit(features.iloc[:split], target.iloc[:split])
    prediction = model.predict(features.iloc[split:])
    metadata = {
        "model_name": "appliance_energy_random_forest",
        "version": "1.0",
        "training_timestamp": datetime.now(timezone.utc).isoformat(),
        "dataset": dataset.get("source"),
        "target": "Appliances",
        "target_unit": "Wh per recorded interval (UCI dataset)",
        "features": list(APPLIANCE_FEATURES),
        "training_rows": int(len(features)),
        "test_metrics": regression_metrics(target.iloc[split:], prediction),
        "split": "chronological 80/20",
    }
    artifact_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": model, "metadata": metadata}, artifact_dir / "appliance_prediction.joblib")
    return metadata


def load_appliance_model(artifact_dir: Path) -> dict[str, Any] | None:
    path = artifact_dir / "appliance_prediction.joblib"
    if not path.is_file():
        return None
    artifact = joblib.load(path)
    if (
        not isinstance(artifact, dict)
        or not {"model", "metadata"}.issubset(artifact)
        or not isinstance(artifact["metadata"], dict)
        or not hasattr(artifact["model"], "predict")
        or artifact["metadata"].get("features") != list(APPLIANCE_FEATURES)
    ):
        raise ValueError(f"Invalid appliance artifact: {path.name}")
    return artifact
