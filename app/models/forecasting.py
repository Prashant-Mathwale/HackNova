from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor

from app.config import DEFAULT_INTERVAL_MINUTES
from app.features.engineering import FORECAST_FEATURES, build_forecast_training_data
from app.utils.metrics import regression_metrics


MODEL_VERSION = "1.0"


def train_forecaster(
    frame: pd.DataFrame,
    quality: dict[str, Any],
    artifact_dir: Path,
    interval_minutes: int = DEFAULT_INTERVAL_MINUTES,
) -> dict[str, Any]:
    features, target = build_forecast_training_data(frame, interval_minutes=interval_minutes)
    if len(features) < 200:
        raise ValueError(f"Insufficient regularly sampled history for forecasting ({len(features)} rows).")
    train_end = int(len(features) * 0.6)
    validation_end = int(len(features) * 0.8)
    if train_end < 100 or validation_end >= len(features):
        raise ValueError("Insufficient data for chronological train/validation/test splits.")
    model = RandomForestRegressor(
        n_estimators=80,
        max_depth=16,
        min_samples_leaf=2,
        max_features=0.8,
        n_jobs=-1,
        random_state=42,
        max_samples=0.5,
    )
    fit_rows = np.linspace(0, validation_end - 1, min(validation_end, 100_000), dtype=int)
    model.fit(features.iloc[fit_rows], target.iloc[fit_rows])
    test_features = features.iloc[validation_end:]
    test_target = target.iloc[validation_end:]
    rf_prediction = model.predict(test_features)
    baseline_prediction = features.iloc[validation_end:]["power_lag_1"].to_numpy()
    test_predictions_path = artifact_dir / "forecast_test_predictions.csv"
    prediction_frame = pd.DataFrame(
        {
            "timestamp": (
                frame.loc[test_features.index, "timestamp"] + pd.to_timedelta(interval_minutes, unit="m")
            ).astype(str).to_numpy(),
            "actual_active_power_kw": test_target.to_numpy(),
            "random_forest_active_power_kw": rf_prediction,
            "persistence_active_power_kw": baseline_prediction,
        }
    )
    prediction_frame.to_csv(test_predictions_path, index=False)
    training_features = features.iloc[fit_rows]
    result = {
        "model_name": "random_forest",
        "version": MODEL_VERSION,
        "dataset": quality,
        "target": "active_power_kw",
        "target_unit": "kW",
        "features": list(FORECAST_FEATURES),
        "interval_minutes": interval_minutes,
        "training_timestamp": datetime.now(timezone.utc).isoformat(),
        "split_ranges": {
            "train_start": str(frame.timestamp.iloc[0]),
            "train_end": str(frame.timestamp.iloc[max(0, train_end - 1)]),
            "validation_end": str(frame.timestamp.iloc[max(0, validation_end - 1)]),
            "test_start": str(frame.timestamp.iloc[validation_end]),
            "test_end": str(frame.timestamp.iloc[-1]),
        },
        "metrics": {
            "random_forest": regression_metrics(test_target, rf_prediction),
            "persistence_baseline": regression_metrics(test_target, baseline_prediction),
            "test_rows": int(len(test_target)),
            "beats_persistence_baseline": bool(
                regression_metrics(test_target, rf_prediction)["mae"]
                < regression_metrics(test_target, baseline_prediction)["mae"]
            ),
        },
        "configuration": {
            "estimators": 80,
            "max_depth": 16,
            "max_samples": 0.5,
            "training_rows_used": int(len(fit_rows)),
            "chronological_split": [0.6, 0.2, 0.2],
        },
        "training_feature_ranges": {
            name: {
                "minimum": float(training_features[name].min()),
                "maximum": float(training_features[name].max()),
            }
            for name in FORECAST_FEATURES
        },
        "quality_warnings": [
            "The Random Forest is fit using the training and validation time ranges; test metrics remain held out."
        ],
        "test_predictions_file": test_predictions_path.name,
    }
    artifact_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": model, "metadata": result}, artifact_dir / "forecasting.joblib")
    return result


def load_forecaster(artifact_dir: Path) -> dict[str, Any] | None:
    path = artifact_dir / "forecasting.joblib"
    if not path.is_file():
        return None
    artifact = joblib.load(path)
    if (
        not isinstance(artifact, dict)
        or not {"model", "metadata"}.issubset(artifact)
        or not isinstance(artifact["metadata"], dict)
        or not hasattr(artifact["model"], "predict")
        or artifact["metadata"].get("features") != list(FORECAST_FEATURES)
    ):
        raise ValueError(f"Invalid forecasting artifact: {path.name}")
    return artifact
