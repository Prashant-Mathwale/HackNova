from __future__ import annotations

import math
import pandas as pd
import pytest

from app.data.validation import normalize_readings
from app.models.anomaly_detection import load_anomaly_detector, score_anomalies, train_anomaly_detector
from app.models.clustering import load_clusters, train_clusters
from app.models.peak_prediction import load_peak_model, train_peak_model
from app.services.analysis_service import ModelRegistry, cluster_daily_energy
from app.services.recommendations import build_recommendations
from app.services.statistics import consumption_statistics


def test_anomaly_detector_training_and_scoring(household_frame, tmp_path):
    train_anomaly_detector(household_frame, {"source": "synthetic test fixture"}, tmp_path)
    artifact = load_anomaly_detector(tmp_path)
    results = score_anomalies(household_frame.tail(3), artifact)
    assert len(results) == 3
    assert all("score" in result and "contributing_readings" in result for result in results)
    response = ModelRegistry({"anomaly_detection": artifact}).anomalies(
        household_frame.tail(3).to_dict(orient="records")
    )
    assert response["model"] == {"name": "isolation_forest", "version": "1.0"}
    assert len(response["results"]) == 3


def test_peak_stats_recommendations_and_json_safe_values(readings):
    registry = ModelRegistry({})
    peak = registry.peak_analysis(readings)
    assert peak["next_hour_peak_estimate_kw"] is not None
    frame = normalize_readings(readings)
    stats = consumption_statistics(frame)
    assert stats["estimated_energy_kwh"] >= 0
    assert isinstance(build_recommendations(frame, stats), list)


def test_daily_energy_groups_keep_similar_consumption_together():
    energies = [1.0, 1.1, 1.2, 8.0, 8.1, 8.2]
    profiles = pd.DataFrame({
        "date": pd.date_range("2026-01-01", periods=len(energies)),
        "energy_kwh_estimated": energies,
    })

    result, assignments = cluster_daily_energy(profiles)

    assert result["available"] is True
    assert result["group_count"] == 2
    lower_ids = {assignments[f"2026-01-0{day}"]["id"] for day in range(1, 4)}
    higher_ids = {assignments[f"2026-01-0{day}"]["id"] for day in range(4, 7)}
    assert len(lower_ids) == len(higher_ids) == 1
    assert next(iter(lower_ids)) < next(iter(higher_ids))


def test_clustering_trains_and_reports_profiles(tmp_path):
    count = 24 * 6 * 10
    hourly = pd.DataFrame(
        {
            "timestamp": pd.date_range("2024-01-01", periods=count, freq="10min"),
            "active_power_kw": [0.35 + (index // 144) * 0.08 + 0.1 * math.sin((index % 144) / 12) for index in range(count)],
        }
    )
    train_clusters(hourly, {"source": "synthetic test fixture"}, tmp_path)
    artifact = load_clusters(tmp_path)
    assert artifact["metadata"]["cluster_count"] >= 2
    assert artifact["metadata"]["cluster_profiles"]


def test_clustering_requires_enough_days(household_frame, tmp_path):
    with pytest.raises(ValueError, match="six complete days"):
        train_clusters(household_frame.head(100), {"source": "synthetic"}, tmp_path)


def test_peak_model_trains_with_hourly_history(tmp_path):
    count = 24 * 21
    frame = pd.DataFrame(
        {
            "timestamp": pd.date_range("2024-01-01", periods=count, freq="h"),
            "active_power_kw": [0.4 + (index % 24) / 30 for index in range(count)],
        }
    )
    metadata = train_peak_model(frame, {"source": "synthetic test fixture"}, tmp_path)
    artifact = load_peak_model(tmp_path)
    assert artifact is not None
    assert metadata["test_metrics"]["random_forest"]["mae"] >= 0
