from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
from app.services.analysis_service import ModelRegistry
from app.api import routes
from app.models.anomaly_detection import train_anomaly_detector


def test_required_api_endpoints_and_unready_models(monkeypatch, readings):
    monkeypatch.setattr(routes, "registry", ModelRegistry({}))
    client = TestClient(app)
    assert client.get("/health").status_code == 200
    assert client.get("/models/status").json()["models"]["forecasting"]["available"] is False
    body = {"readings": readings}
    assert client.post("/predict/consumption", json=body).status_code == 503
    assert client.post("/detect/anomalies", json=body).status_code == 503
    assert client.post("/predict/peak", json=body).status_code == 200
    assert client.post("/analyze/patterns", json=body).status_code == 200
    assert client.post("/recommendations", json=body).status_code == 200
    assert client.post("/analyze", json=body).status_code == 200
    validation = client.post("/data/validate", json=body)
    assert validation.status_code == 200
    assert validation.json()["status"] == "valid"
    assert client.post("/data/validate", json={}).status_code == 422
    assert client.post("/data/validate", json={"readings": []}).status_code == 422
    assert client.post(
        "/data/validate",
        json={"readings": [{"timestamp": "invalid", "active_power_kw": 1}]},
    ).status_code == 422
    assert client.post(
        "/data/validate",
        json={"readings": [{"timestamp": "2024-01-01T00:00:00Z", "active_power_kw": 1, "unit": "W"}]},
    ).status_code == 422
    assert client.post(
        "/data/validate",
        json={"readings": readings * 251},
    ).status_code == 422
    assert client.post(
        "/predict/appliances",
        json={"timestamp": "2024-01-01T00:00:00Z", "temperature_outdoor_c": 10, "humidity_outdoor_pct": 50},
    ).status_code == 503


def test_anomaly_api_returns_model_name_and_version(monkeypatch, household_frame, tmp_path):
    train_anomaly_detector(household_frame, {"source": "synthetic test fixture"}, tmp_path)
    from app.models.anomaly_detection import load_anomaly_detector

    artifact = load_anomaly_detector(tmp_path)
    monkeypatch.setattr(routes, "registry", ModelRegistry({"anomaly_detection": artifact}))
    readings = [
        {
            "timestamp": row.timestamp.isoformat(),
            "active_power_kw": float(row.active_power_kw),
            "reactive_power": float(row.reactive_power),
            "voltage_v": float(row.voltage_v),
            "current_a": float(row.current_a),
            "sub_metering_1": float(row.sub_metering_1),
            "sub_metering_2": float(row.sub_metering_2),
            "sub_metering_3": float(row.sub_metering_3),
        }
        for row in household_frame.tail(3).itertuples()
    ]

    response = TestClient(app).post("/detect/anomalies", json={"readings": readings})
    assert response.status_code == 200
    assert response.json()["model"] == {"name": "isolation_forest", "version": "1.0"}
    assert len(response.json()["results"]) == len(readings)
