from __future__ import annotations

import logging

from app.config import APPLIANCE_DATASET_PATH, ARTIFACT_DIR, DATASET_PATH
from app.data.loader import load_appliance_dataset, load_household_dataset
from app.models.anomaly_detection import train_anomaly_detector
from app.models.appliance_prediction import train_appliance_model
from app.models.clustering import train_clusters
from app.models.forecasting import train_forecaster
from app.models.peak_prediction import train_peak_model

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")


def main() -> int:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    try:
        frame, quality = load_household_dataset(DATASET_PATH)
    except Exception as exc:
        logging.error("Core household dataset could not be loaded: %s", exc)
        return 1
    print(f"Dataset quality: {quality}")
    outcomes = {}
    for name, train in (
        ("forecasting", lambda: train_forecaster(frame, quality, ARTIFACT_DIR)),
        ("anomaly_detection", lambda: train_anomaly_detector(frame, quality, ARTIFACT_DIR)),
        ("peak_prediction", lambda: train_peak_model(frame, quality, ARTIFACT_DIR)),
        ("clustering", lambda: train_clusters(frame, quality, ARTIFACT_DIR)),
    ):
        try:
            outcomes[name] = train()
            print(f"[OK] {name}: {outcomes[name]}")
            if name == "forecasting":
                print("Forecast test comparison (kW):")
                print(f"{'Model':<26} {'MAE':>12} {'RMSE':>12} {'R2':>12}")
                for model_name, metrics in outcomes[name]["metrics"].items():
                    if isinstance(metrics, dict) and "mae" in metrics:
                        print(
                            f"{model_name:<26} {metrics['mae']:>12.6f} "
                            f"{metrics['rmse']:>12.6f} {metrics['r2']:>12.6f}"
                        )
        except Exception as exc:
            logging.exception("%s training failed", name)
            outcomes[name] = {"status": "failed", "reason": str(exc)}
            print(f"[FAILED] {name}: {exc}")

    if APPLIANCE_DATASET_PATH.is_file():
        try:
            appliance_frame, appliance_quality = load_appliance_dataset(APPLIANCE_DATASET_PATH)
            outcomes["appliance_prediction"] = train_appliance_model(
                appliance_frame, appliance_quality, ARTIFACT_DIR
            )
            print(f"[OK] appliance_prediction: {outcomes['appliance_prediction']}")
        except Exception as exc:
            logging.exception("Optional appliance model training failed")
            outcomes["appliance_prediction"] = {"status": "failed", "reason": str(exc)}
            print(f"[FAILED] appliance_prediction: {exc}")
    else:
        outcomes["appliance_prediction"] = {"status": "skipped", "reason": "Optional dataset not present."}
        print("[SKIPPED] appliance_prediction: compatible dataset not found.")

    core_failures = {"forecasting", "anomaly_detection"} - {
        name for name, result in outcomes.items() if "status" not in result
    }
    return 1 if core_failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
