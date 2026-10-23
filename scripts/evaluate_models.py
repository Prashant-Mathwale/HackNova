from __future__ import annotations

import json

from app.config import ARTIFACT_DIR
from app.models.anomaly_detection import load_anomaly_detector
from app.models.appliance_prediction import load_appliance_model
from app.models.clustering import load_clusters
from app.models.forecasting import load_forecaster
from app.models.peak_prediction import load_peak_model


def main() -> int:
    loaders = {
        "forecasting": load_forecaster,
        "anomaly_detection": load_anomaly_detector,
        "peak_prediction": load_peak_model,
        "clustering": load_clusters,
        "appliance_prediction": load_appliance_model,
    }
    for name, loader in loaders.items():
        artifact = loader(ARTIFACT_DIR)
        if artifact is None:
            print(f"{name}: not trained")
        else:
            print(f"{name}:\n{json.dumps(artifact['metadata'], indent=2, default=str)}")
    print("Unsupervised anomaly models have no accuracy metrics unless labelled ground truth is supplied.")
    print("Metrics use chronological held-out data and may not represent a new household or future season.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
