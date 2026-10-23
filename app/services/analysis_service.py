from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from app.config import PEAK_POWER_THRESHOLD_KW
from app.data.validation import normalize_readings
from app.exceptions import ModelNotReadyError
from app.features.engineering import forecast_features_from_history
from app.models.anomaly_detection import score_anomalies
from app.models.clustering import CLUSTER_FEATURES, daily_profiles
from app.services.recommendations import build_recommendations
from app.services.statistics import consumption_statistics


class ModelRegistry:
    def __init__(self, artifacts: dict[str, dict[str, Any] | None], load_errors: dict[str, str] | None = None):
        self.artifacts = artifacts
        self.load_errors = load_errors or {}

    def status(self) -> dict[str, Any]:
        model_names = (
            "forecasting",
            "anomaly_detection",
            "peak_prediction",
            "clustering",
            "appliance_prediction",
        )
        return {
            name: {
                "available": artifact is not None,
                "metadata": artifact.get("metadata") if artifact else None,
                "load_error": self.load_errors.get(name),
            }
            for name in dict.fromkeys((*model_names, *self.artifacts))
            for artifact in [self.artifacts.get(name)]
        }

    def forecast(self, readings: list[dict[str, Any]], horizon_steps: int, interval_minutes: int) -> dict[str, Any]:
        artifact = self.artifacts.get("forecasting")
        if artifact is None:
            raise ModelNotReadyError("Forecasting model is not trained. Run python -m scripts.train_all.")
        metadata = artifact["metadata"]
        trained_interval = int(metadata.get("interval_minutes", 1))
        if interval_minutes != trained_interval:
            raise ValueError(f"Forecast model supports a {trained_interval}-minute interval; received {interval_minutes}.")
        frame = normalize_readings(readings)
        if len(frame) < 30:
            raise ValueError("At least 30 consecutive readings are required for forecasting.")
        deltas = frame.timestamp.diff().dropna().dt.total_seconds().div(60)
        if not deltas.empty and not np.isclose(deltas.tail(29), interval_minutes).all():
            raise ValueError("Recent readings must be regularly spaced at the configured forecasting interval.")
        baseline = float(frame.active_power_kw.iloc[-1])
        forecasts = []
        warnings: list[str] = []
        context = frame.copy()
        for step in range(1, horizon_steps + 1):
            features = forecast_features_from_history(context, interval_minutes)
            ranges = metadata.get("training_feature_ranges", {})
            outside_range = [
                name
                for name, bounds in ranges.items()
                if features.iloc[0][name] < bounds["minimum"] or features.iloc[0][name] > bounds["maximum"]
            ]
            if outside_range:
                warnings.append(
                    "Forecast inputs are outside the training range for: " + ", ".join(outside_range[:5]) + "."
                )
            prediction = max(0.0, float(artifact["model"].predict(features)[0]))
            timestamp = (context.timestamp.iloc[-1] + pd.to_timedelta(interval_minutes, unit="m")).isoformat()
            forecasts.append(
                {
                    "active_power_kw": prediction,
                    "timestamp": timestamp,
                    "horizon_steps": step,
                    "persistence_baseline_kw": baseline,
                    "absolute_difference_from_baseline_kw": abs(prediction - baseline),
                }
            )
            context = pd.concat(
                [context, pd.DataFrame([{"timestamp": pd.Timestamp(timestamp), "active_power_kw": prediction}])],
                ignore_index=True,
            )
        return {
            "status": "success",
            "latest_observed_active_power_kw": baseline,
            "predictions": forecasts,
            "unit": "kW",
            "model": {"name": metadata["model_name"], "version": metadata["version"]},
            "warnings": list(dict.fromkeys(
                warnings
                + (["Recursive forecasts may accumulate error across forecast steps."] if horizon_steps > 1 else [])
            )),
        }

    def anomalies(self, readings: list[dict[str, Any]]) -> dict[str, Any]:
        artifact = self.artifacts.get("anomaly_detection")
        if artifact is None:
            raise ModelNotReadyError("Anomaly detector is not trained. Run python -m scripts.train_all.")
        frame = normalize_readings(readings)
        result = score_anomalies(frame, artifact)
        return {
            "status": "success",
            "model": artifact["metadata"]["model_name"],
            "results": result,
            "flagged_count": sum(item["is_anomaly"] for item in result),
            "warnings": [
                "An unusual-pattern flag is not proof of an electrical fault or unsafe wiring.",
                "Missing optional sensor fields are imputed to training medians, not treated as zero.",
            ],
        }

    def peak_analysis(self, readings: list[dict[str, Any]], threshold_kw: float | None = None) -> dict[str, Any]:
        frame = normalize_readings(readings)
        threshold = threshold_kw if threshold_kw is not None else PEAK_POWER_THRESHOLD_KW
        data = frame.set_index("timestamp")["active_power_kw"]
        hourly_all = data.resample("1h").max()
        hourly = hourly_all.dropna()
        daily_peak = data.resample("1D").max().dropna()
        top = data.nlargest(min(5, len(data)))
        same_hour = data.loc[data.index.hour == frame.timestamp.iloc[-1].hour]
        artifact = self.artifacts.get("peak_prediction")
        prediction: float | None = None
        method = "same-clock-hour historical median"
        warnings: list[str] = []
        recent_hourly = hourly_all.tail(3)
        if artifact is not None and len(recent_hourly) == 3 and recent_hourly.notna().all():
            hour_values = recent_hourly.to_numpy(dtype=float)[::-1]
            timestamp = hourly.index[-1] + pd.Timedelta(hours=1)
            features = pd.DataFrame(
                [
                    {
                        "power_lag_1": hour_values[0],
                        "power_lag_2": hour_values[1],
                        "power_lag_3": hour_values[2],
                        "hour_sin": np.sin(2 * np.pi * timestamp.hour / 24),
                        "hour_cos": np.cos(2 * np.pi * timestamp.hour / 24),
                        "weekday_sin": np.sin(2 * np.pi * timestamp.dayofweek / 7),
                        "weekday_cos": np.cos(2 * np.pi * timestamp.dayofweek / 7),
                    }
                ]
            )
            prediction = max(0.0, float(artifact["model"].predict(features)[0]))
            method = artifact["metadata"]["model_name"]
        elif len(same_hour):
            prediction = float(same_hour.median())
            warnings.append("The eligible trained hourly peak model is unavailable; using a historical same-hour median.")
        else:
            warnings.append("Insufficient comparable history to estimate the next-hour peak.")
        return {
            "status": "success",
            "peak_definition": "Maximum observed household active power in an hourly time bucket; not grid-wide demand.",
            "historical_daily_peaks": [
                {"date": timestamp.date().isoformat(), "peak_power_kw": float(value)}
                for timestamp, value in daily_peak.items()
            ],
            "historical_hourly_peaks": [
                {"timestamp": timestamp.isoformat(), "peak_power_kw": float(value)}
                for timestamp, value in hourly.tail(48).items()
            ],
            "top_observed_periods": [
                {"timestamp": timestamp.isoformat(), "power_kw": float(value)} for timestamp, value in top.items()
            ],
            "comparable_hour_median_kw": float(same_hour.median()) if len(same_hour) else None,
            "next_hour_peak_estimate_kw": prediction,
            "next_hour_method": method if prediction is not None else None,
            "threshold_kw": threshold,
            "exceeds_threshold": bool(prediction is not None and prediction > threshold),
            "warnings": warnings,
        }

    def patterns(self, readings: list[dict[str, Any]]) -> dict[str, Any]:
        frame = normalize_readings(readings)
        stats = consumption_statistics(frame)
        profiles = daily_profiles(frame)
        artifact = self.artifacts.get("clustering")
        if artifact is None:
            cluster = {"available": False, "reason": "Clustering model is not trained or history is insufficient."}
        elif profiles.empty:
            cluster = {"available": False, "reason": "At least two readings within a day are required."}
        else:
            latest = profiles.iloc[-1]
            values = latest.reindex(CLUSTER_FEATURES).to_frame().T
            cluster_id = int(artifact["model"].predict(artifact["scaler"].transform(values))[0])
            profile = artifact["metadata"]["cluster_profiles"].get(str(cluster_id), {})
            cluster = {
                "available": True,
                "cluster_id": cluster_id,
                "description": profile.get("description", "similar historical usage pattern"),
                "profile": profile,
                "assignment_scope": str(latest["date"].date()),
                "interpretation": "Similarity to learned daily profiles; not a verified household behavior.",
            }
        return {
            "status": "success",
            "statistics": stats,
            "hourly_pattern": stats["hourly"],
            "daily_pattern": stats["daily"],
            "cluster": cluster,
        }

    def recommendations(
        self,
        readings: list[dict[str, Any]],
        tariff_inr_per_kwh: float | None = None,
        peak_window_start_hour: int | None = None,
        peak_window_end_hour: int | None = None,
    ) -> dict[str, Any]:
        frame = normalize_readings(readings)
        stats = consumption_statistics(frame, tariff_inr_per_kwh)
        anomaly_artifact = self.artifacts.get("anomaly_detection")
        anomalies = score_anomalies(frame, anomaly_artifact) if anomaly_artifact else []
        return {
            "status": "success",
            "recommendations": build_recommendations(
                frame, stats, anomalies, peak_window_start_hour, peak_window_end_hour
            ),
            "based_on": {
                "readings": len(frame),
                "tariff_supplied": tariff_inr_per_kwh is not None,
                "appliance_identity_inferred": False,
            },
        }

    def analyze(self, request: dict[str, Any]) -> dict[str, Any]:
        readings = request["readings"]
        frame = normalize_readings(readings)
        components: dict[str, Any] = {
            "statistics": consumption_statistics(frame, request.get("tariff_inr_per_kwh")),
            "models": self.status(),
        }
        warnings: list[str] = []
        callbacks = {
            "forecast": lambda: self.forecast(
                readings, request.get("horizon_steps", 1), request.get("interval_minutes", 1)
            ),
            "anomalies": lambda: self.anomalies(readings),
            "peak": lambda: self.peak_analysis(readings),
            "patterns": lambda: self.patterns(readings),
            "recommendations": lambda: self.recommendations(
                readings,
                request.get("tariff_inr_per_kwh"),
                request.get("peak_window_start_hour"),
                request.get("peak_window_end_hour"),
            ),
        }
        for name, callback in callbacks.items():
            try:
                components[name] = callback()
            except (ValueError, ModelNotReadyError) as exc:
                components[name] = {"available": False, "reason": str(exc)}
                warnings.append(f"{name}: {exc}")
        return {"status": "success", "components": components, "warnings": warnings}
