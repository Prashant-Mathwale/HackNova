from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
from app.services.analysis_service import ModelRegistry
from app.api import routes


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
