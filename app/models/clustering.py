from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
from sklearn.preprocessing import StandardScaler

CLUSTER_FEATURES = ("energy_kwh_estimated", "average_power_kw", "peak_power_kw", "power_std_kw", "evening_share")


def daily_profiles(frame: pd.DataFrame) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    data = frame.sort_values("timestamp").copy()
    data["date"] = data.timestamp.dt.date
    data["hour"] = data.timestamp.dt.hour
    for day, group in data.groupby("date"):
        if len(group) < 12 or (group.timestamp.iloc[-1] - group.timestamp.iloc[0]).total_seconds() < 18 * 3600:
            continue
        if group.timestamp.diff().dropna().dt.total_seconds().gt(3 * 3600).any():
            continue
        times = group.timestamp.astype("int64").to_numpy(dtype=float) / 1e9
        power = group.active_power_kw.to_numpy(dtype=float)
        if len(group) < 2:
            continue
        energy = float(np.sum((power[:-1] + power[1:]) * np.diff(times) / 2) / 3600)
        total_energy = max(energy, 1e-9)
        evening = group.loc[group.hour.between(18, 23), "active_power_kw"]
        rows.append(
            {
                "date": pd.Timestamp(day),
                "energy_kwh_estimated": energy,
                "average_power_kw": float(np.mean(power)),
                "peak_power_kw": float(np.max(power)),
                "power_std_kw": float(np.std(power)),
                "evening_share": float(evening.mean() * max(len(evening), 1) / max(np.sum(power), 1e-9)),
            }
        )
    return pd.DataFrame(rows)


def train_clusters(frame: pd.DataFrame, dataset: dict[str, Any], artifact_dir: Path) -> dict[str, Any]:
    profiles = daily_profiles(frame)
    if len(profiles) < 6:
        raise ValueError(f"At least six complete days are required for clustering ({len(profiles)} found).")
    features = profiles.loc[:, CLUSTER_FEATURES].replace([np.inf, -np.inf], np.nan).dropna()
    count = min(4, max(2, len(features) // 3))
    scaler = StandardScaler()
    scaled = scaler.fit_transform(features)
    model = KMeans(n_clusters=count, random_state=42, n_init=10)
    labels = model.fit_predict(scaled)
    profile = features.assign(cluster=labels).groupby("cluster").mean().to_dict(orient="index")
    names = _cluster_names(profile)
    silhouette = float(silhouette_score(scaled, labels)) if len(set(labels)) > 1 and len(labels) > count else None
    metadata = {
        "model_name": "daily_usage_kmeans",
        "version": "1.0",
        "training_timestamp": datetime.now(timezone.utc).isoformat(),
        "dataset": dataset.get("source"),
        "features": list(CLUSTER_FEATURES),
        "cluster_count": int(count),
        "cluster_sizes": {str(int(key)): int(value) for key, value in pd.Series(labels).value_counts().items()},
        "cluster_profiles": {str(int(key)): {**value, "description": names[int(key)]} for key, value in profile.items()},
        "silhouette_score": silhouette,
        "training_days": int(len(features)),
    }
    artifact_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": model, "scaler": scaler, "metadata": metadata}, artifact_dir / "clustering.joblib")
    return metadata


def load_clusters(artifact_dir: Path) -> dict[str, Any] | None:
    path = artifact_dir / "clustering.joblib"
    if not path.is_file():
        return None
    artifact = joblib.load(path)
    if (
        not isinstance(artifact, dict)
        or not {"model", "scaler", "metadata"}.issubset(artifact)
        or not isinstance(artifact["metadata"], dict)
        or not hasattr(artifact["model"], "predict")
        or not hasattr(artifact["scaler"], "transform")
        or artifact["metadata"].get("features") != list(CLUSTER_FEATURES)
    ):
        raise ValueError(f"Invalid clustering artifact: {path.name}")
    return artifact


def _cluster_names(profiles: dict[int, dict[str, float]]) -> dict[int, str]:
    energy_order = sorted(profiles, key=lambda key: profiles[key]["energy_kwh_estimated"])
    names: dict[int, str] = {}
    for rank, cluster_id in enumerate(energy_order):
        energy_label = "lower-consumption" if rank == 0 else "higher-consumption" if rank == len(energy_order) - 1 else "typical-consumption"
        profile = profiles[cluster_id]
        style = "evening-heavy" if profile["evening_share"] > 0.4 else "relatively steady"
        names[cluster_id] = f"{energy_label}, {style} days"
    return names
