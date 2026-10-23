from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException
import pandas as pd

from app.config import ARTIFACT_DIR
from app.data.validation import normalize_readings, quality_report
from app.exceptions import DataValidationError, ModelNotReadyError
from app.models.appliance_prediction import load_appliance_model
from app.models.anomaly_detection import load_anomaly_detector
from app.models.clustering import load_clusters
from app.models.forecasting import load_forecaster
from app.models.peak_prediction import load_peak_model
from app.schemas import (
    AnalysisRequest,
    AppliancePredictionRequest,
    ForecastRequest,
    PeakRequest,
    ReadingsRequest,
)
from app.services.analysis_service import ModelRegistry

logger = logging.getLogger(__name__)
router = APIRouter()


def load_registry(artifact_dir=ARTIFACT_DIR) -> ModelRegistry:
    loaders = {
        "forecasting": load_forecaster,
        "anomaly_detection": load_anomaly_detector,
        "peak_prediction": load_peak_model,
        "clustering": load_clusters,
        "appliance_prediction": load_appliance_model,
    }
    artifacts: dict[str, dict[str, Any] | None] = {}
    errors: dict[str, str] = {}
    for name, loader in loaders.items():
        try:
            artifacts[name] = loader(artifact_dir)
        except (
            OSError,
            ValueError,
            KeyError,
            EOFError,
            ImportError,
            ModuleNotFoundError,
            AttributeError,
            TypeError,
        ) as exc:
            logger.warning("Model artifact %s could not be loaded: %s", name, type(exc).__name__)
            artifacts[name] = None
            errors[name] = "Artifact is invalid or could not be loaded; retrain this model."
    return ModelRegistry(artifacts, errors)


registry = load_registry()


@router.get("/health")
def health() -> dict[str, Any]:
    models = registry.status()
    return {
        "status": "ok",
        "service": "EnergyIQ ML Service",
        "version": "1.0.0",
        "loaded_models": [name for name, state in models.items() if state["available"]],
        "model_readiness": {name: state["available"] for name, state in models.items()},
        "training_metadata": {
            name: state["metadata"].get("training_timestamp")
            for name, state in models.items()
            if state["available"] and state["metadata"]
        },
    }


@router.get("/models/status")
def model_status() -> dict[str, Any]:
    return {"models": registry.status()}


@router.post("/predict/consumption")
def predict_consumption(request: ForecastRequest) -> dict[str, Any]:
    return _run(
        lambda: registry.forecast(
            _reading_dicts(request), request.horizon_steps, request.interval_minutes
        )
    )


@router.post("/detect/anomalies")
def detect_anomalies(request: ReadingsRequest) -> dict[str, Any]:
    return _run(lambda: registry.anomalies(_reading_dicts(request)))


@router.post("/predict/peak")
def predict_peak(request: PeakRequest) -> dict[str, Any]:
    return _run(lambda: registry.peak_analysis(_reading_dicts(request), request.threshold_kw))


@router.post("/analyze/patterns")
def analyze_patterns(request: ReadingsRequest) -> dict[str, Any]:
    return _run(lambda: registry.patterns(_reading_dicts(request)))


@router.post("/recommendations")
def recommendations(request: AnalysisRequest) -> dict[str, Any]:
    return _run(
        lambda: registry.recommendations(
            _reading_dicts(request),
            request.tariff_inr_per_kwh,
            request.peak_window_start_hour,
            request.peak_window_end_hour,
        )
    )


@router.post("/analyze")
def analyze(request: AnalysisRequest) -> dict[str, Any]:
    return _run(lambda: registry.analyze(request.model_dump()))


@router.post("/data/validate")
def validate_data(request: ReadingsRequest) -> dict[str, Any]:
    return _run(
        lambda: _validation_response(_reading_dicts(request))
    )


@router.post("/predict/appliances")
def predict_appliances(request: AppliancePredictionRequest) -> dict[str, Any]:
    artifact = registry.artifacts.get("appliance_prediction")
    if artifact is None:
        raise HTTPException(
            status_code=503,
            detail="Appliance model is not trained. Train it with a compatible UCI Appliances Energy dataset.",
        )
    timestamp = pd.Timestamp(request.timestamp)
    timestamp = timestamp.tz_localize("UTC") if timestamp.tzinfo is None else timestamp.tz_convert("UTC")
    features = pd.DataFrame(
        [
            {
                "temperature_outdoor_c": request.temperature_outdoor_c,
                "humidity_outdoor_pct": request.humidity_outdoor_pct,
                "hour": timestamp.hour,
                "weekday": timestamp.dayofweek,
            }
        ]
    )
    prediction = max(0.0, float(artifact["model"].predict(features)[0]))
    metrics = artifact["metadata"].get("test_metrics", {})
    warnings = [
        "This predicts the UCI dataset's aggregate Appliances target; it does not identify individual appliances."
    ]
    if metrics.get("r2", 0) < 0:
        warnings.append("The appliance model had negative held-out R²; use this estimate cautiously.")
    return {
        "status": "success",
        "prediction": {
            "appliances_energy": prediction,
            "unit": "Wh per recorded interval",
            "timestamp": timestamp.isoformat(),
        },
        "model": artifact["metadata"]["model_name"],
        "validation_metrics": metrics,
        "warnings": warnings,
    }


def _run(callback):
    try:
        return callback()
    except ModelNotReadyError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except (ValueError, DataValidationError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def _reading_dicts(request: ReadingsRequest) -> list[dict[str, Any]]:
    return [reading.model_dump() for reading in request.readings]


def _validation_response(readings: list[dict[str, Any]]) -> dict[str, Any]:
    frame = normalize_readings(readings)
    return {
        "status": "valid",
        "canonical_fields": list(frame.columns),
        "units": {
            "active_power_kw": "kW",
            "energy_kwh": "kWh",
            "voltage_v": "V",
            "current_a": "A",
        },
        "data_quality": quality_report(frame),
        "sampling_interval_minutes_median": (
            float(frame.timestamp.diff().dt.total_seconds().div(60).median()) if len(frame) > 1 else None
        ),
        "warnings": [
            "Naive timestamps are interpreted as UTC; timezone-aware timestamps are normalized to UTC."
        ],
    }
