from __future__ import annotations

import numpy as np
import pandas as pd

LAGS = (1, 2, 3, 5, 10, 15, 30)
WINDOWS = (5, 15, 30)
FORECAST_FEATURES = tuple(
    [f"power_lag_{lag}" for lag in LAGS]
    + [f"power_mean_{window}" for window in WINDOWS]
    + [f"power_std_{window}" for window in WINDOWS]
    + ["hour_sin", "hour_cos", "weekday_sin", "weekday_cos", "is_weekend"]
)


def build_forecast_training_data(frame: pd.DataFrame, interval_minutes: int = 1) -> tuple[pd.DataFrame, pd.Series]:
    """Use measurements at t to predict the next regularly-spaced observation t+1."""
    data = frame.sort_values("timestamp").reset_index(drop=True).copy()
    features = pd.DataFrame(index=data.index)
    power = data["active_power_kw"].astype(float)
    for lag in LAGS:
        features[f"power_lag_{lag}"] = power.shift(lag - 1)
    for window in WINDOWS:
        history = power.shift(0).rolling(window, min_periods=window)
        features[f"power_mean_{window}"] = history.mean()
        features[f"power_std_{window}"] = history.std(ddof=0)
    target_timestamps = data["timestamp"] + pd.to_timedelta(interval_minutes, unit="m")
    features = pd.concat([features, _calendar_features(target_timestamps)], axis=1)
    target = power.shift(-1)
    deltas = data["timestamp"].diff().dt.total_seconds().div(60)
    regular_history = deltas.eq(interval_minutes).rolling(max(LAGS) - 1, min_periods=max(LAGS) - 1).sum().eq(
        max(LAGS) - 1
    )
    next_deltas = data["timestamp"].shift(-1).sub(data["timestamp"]).dt.total_seconds().div(60)
    regular_next = np.isclose(next_deltas, interval_minutes)
    valid = features.notna().all(axis=1) & target.notna() & regular_history & regular_next
    return features.loc[valid, list(FORECAST_FEATURES)], target.loc[valid]


def forecast_features_from_history(frame: pd.DataFrame, interval_minutes: int = 1) -> pd.DataFrame:
    if len(frame) < max(LAGS):
        raise ValueError(f"At least {max(LAGS)} readings are required for forecasting.")
    data = frame.sort_values("timestamp")
    power = data["active_power_kw"].astype(float).tail(max(LAGS)).reset_index(drop=True)
    values: dict[str, float] = {}
    for lag in LAGS:
        values[f"power_lag_{lag}"] = float(power.iloc[-lag])
    for window in WINDOWS:
        sample = power.tail(window)
        if len(sample) < window:
            raise ValueError(f"At least {window} readings are required for forecasting.")
        values[f"power_mean_{window}"] = float(sample.mean())
        values[f"power_std_{window}"] = float(sample.std(ddof=0))
    next_timestamp = data["timestamp"].iloc[-1] + pd.to_timedelta(interval_minutes, unit="m")
    calendar = _calendar_features(pd.Series([next_timestamp])).iloc[0].to_dict()
    values.update(calendar)
    return pd.DataFrame([{name: values[name] for name in FORECAST_FEATURES}])


def _calendar_features(timestamps: pd.Series) -> pd.DataFrame:
    hours = timestamps.dt.hour + timestamps.dt.minute / 60
    weekdays = timestamps.dt.dayofweek
    return pd.DataFrame(
        {
            "hour_sin": np.sin(2 * np.pi * hours / 24),
            "hour_cos": np.cos(2 * np.pi * hours / 24),
            "weekday_sin": np.sin(2 * np.pi * weekdays / 7),
            "weekday_cos": np.cos(2 * np.pi * weekdays / 7),
            "is_weekend": (weekdays >= 5).astype(float),
        },
        index=timestamps.index,
    )
