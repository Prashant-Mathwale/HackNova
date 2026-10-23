from __future__ import annotations

import numpy as np
import pandas as pd

from app.features.engineering import FORECAST_FEATURES, build_forecast_training_data, forecast_features_from_history
from app.models.forecasting import load_forecaster, train_forecaster
from app.services.analysis_service import ModelRegistry


def test_features_are_past_only_and_target_is_next_interval(household_frame):
    features, target = build_forecast_training_data(household_frame)
    assert tuple(features.columns) == FORECAST_FEATURES
    row_index = int(features.index[100])
    assert features.loc[row_index, "power_lag_1"] == household_frame.loc[row_index, "active_power_kw"]
    assert target.loc[row_index] == household_frame.loc[row_index + 1, "active_power_kw"]
    changed = household_frame.copy()
    changed.loc[row_index + 1, "active_power_kw"] += 100
    changed_features, _ = build_forecast_training_data(changed)
    np.testing.assert_allclose(features.loc[row_index].to_numpy(), changed_features.loc[row_index].to_numpy())


def test_trains_saves_reloads_and_forecasts(household_frame, readings, tmp_path):
    metadata = train_forecaster(household_frame, {"source": "synthetic test fixture"}, tmp_path)
    artifact = load_forecaster(tmp_path)
    assert artifact is not None
    assert metadata["metrics"]["test_rows"] > 0
    response = ModelRegistry({"forecasting": artifact}).forecast(readings, 2, 1)
    assert len(response["predictions"]) == 2
    assert response["predictions"][0]["persistence_baseline_kw"] == readings[-1]["active_power_kw"]
    assert response["warnings"]


def test_requires_sufficient_history(household_frame):
    short = household_frame.head(20)
    from app.features.engineering import build_forecast_training_data

    features, _ = build_forecast_training_data(short)
    assert features.empty


def test_forecast_features_do_not_cross_a_missing_time_gap(household_frame):
    broken = household_frame.copy()
    broken.loc[31:, "timestamp"] += pd.Timedelta(minutes=10)
    features, _ = build_forecast_training_data(broken)
    assert 31 not in features.index


def test_forecast_history_features_are_schema_ordered(household_frame):
    features = forecast_features_from_history(household_frame.tail(30))
    assert tuple(features.columns) == FORECAST_FEATURES
