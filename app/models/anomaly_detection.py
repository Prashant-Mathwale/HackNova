from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline

from app.config import ANOMALY_CONTAMINATION

ANOMALY_FEATURES = (
    "active_power_kw",
    "reactive_power",
    "voltage_v",
    "current_a",
    "sub_metering_1",
    "sub_metering_2",
    "sub_metering_3",
)


def train_anomaly_detector(frame: pd.DataFrame, dataset: dict[str, Any], artifact_dir: Path) -> dict[str, Any]:
    features = frame.reindex(columns=ANOMALY_FEATURES)
    if len(features) < 100:
        raise ValueError("At least 100 historical readings are required for anomaly detection.")
    pipeline = Pipeline(
        [
            ("imputer", SimpleImputer(strategy="median", keep_empty_features=True)),
            (
                "isolation_forest",
                IsolationForest(
                    n_estimators=100,
                    contamination=ANOMALY_CONTAMINATION,
                    random_state=42,
                    n_jobs=-1,
                ),
            ),
        ]
    )
    pipeline.fit(features)
    scores = -pipeline.decision_function(features)
    flags = pipeline.predict(features) == -1
    metadata = {
        "model_name": "isolation_forest",
        "version": "1.0",
        "training_timestamp": datetime.now(timezone.utc).isoformat(),
        "dataset": dataset.get("source"),
        "features": list(ANOMALY_FEATURES),
        "contamination": ANOMALY_CONTAMINATION,
        "training_rows": int(len(features)),
        "training_flagged_count": int(flags.sum()),
        "training_flagged_percentage": float(flags.mean() * 100),
        "training_score_distribution": {
            "minimum": float(np.min(scores)),
            "median": float(np.median(scores)),
            "maximum": float(np.max(scores)),
        },
        "evaluation": "Unsupervised; no labelled fault ground truth was supplied.",
    }
    artifact_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump({"pipeline": pipeline, "metadata": metadata}, artifact_dir / "anomaly_detection.joblib")
    return metadata


def load_anomaly_detector(artifact_dir: Path) -> dict[str, Any] | None:
    path = artifact_dir / "anomaly_detection.joblib"
    if not path.is_file():
        return None
    artifact = joblib.load(path)
    if (
        not isinstance(artifact, dict)
        or not {"pipeline", "metadata"}.issubset(artifact)
        or not isinstance(artifact["metadata"], dict)
        or not hasattr(artifact["pipeline"], "predict")
        or not hasattr(artifact["pipeline"], "decision_function")
        or artifact["metadata"].get("features") != list(ANOMALY_FEATURES)
    ):
        raise ValueError(f"Invalid anomaly artifact: {path.name}")
    return artifact


def score_anomalies(frame: pd.DataFrame, artifact: dict[str, Any]) -> list[dict[str, Any]]:
    features = frame.reindex(columns=ANOMALY_FEATURES)
    pipeline = artifact["pipeline"]
    predictions = pipeline.predict(features)
    scores = pipeline.decision_function(features)
    medians = pipeline.named_steps["imputer"].statistics_
    results = []
    for index, row in frame.iterrows():
        contributions = []
        for feature_index, feature in enumerate(ANOMALY_FEATURES):
            value = row.get(feature)
            median = medians[feature_index]
            if pd.notna(value) and np.isfinite(float(median)):
                deviation = abs(float(value) - float(median)) / max(abs(float(median)), 1e-6)
                if deviation >= 0.5:
                    contributions.append({"field": feature, "value": float(value), "training_median": float(median)})
        results.append(
            {
                "timestamp": row.timestamp.isoformat(),
                "is_anomaly": bool(predictions[frame.index.get_loc(index)] == -1),
                "score": float(-scores[frame.index.get_loc(index)]),
                "explanation": "Unusual consumption pattern; review the reading in context."
                if predictions[frame.index.get_loc(index)] == -1
                else "No unusual pattern was detected by the fitted model.",
                "contributing_readings": contributions[:3],
                "imputed_optional_fields": [
                    feature for feature in ANOMALY_FEATURES if pd.isna(row.get(feature))
                ],
            }
        )
    return results
