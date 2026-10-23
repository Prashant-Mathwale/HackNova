from __future__ import annotations

import pandas as pd
import pytest

from app.data.loader import load_household_dataset
from app.data.validation import normalize_readings, quality_report
from app.exceptions import DataValidationError


def test_loads_original_format_handles_question_marks_and_duplicates(tmp_path):
    path = tmp_path / "sample.txt"
    path.write_text(
        "Date;Time;Global_active_power;Global_reactive_power;Voltage\n"
        "01/01/2020;00:01:00;1.5;?;230\n"
        "01/01/2020;00:00:00;1.0;0.2;231\n"
        "01/01/2020;00:01:00;2.0;0.3;229\n"
        "bad;time;3.0;0.1;230\n",
        encoding="utf-8",
    )
    frame, quality = load_household_dataset(path)
    assert frame.timestamp.is_monotonic_increasing
    assert frame.active_power_kw.tolist() == [1.0, 2.0]
    assert not pd.isna(frame.reactive_power.iloc[1])
    assert quality["duplicate_timestamps_removed"] == 1
    assert quality["invalid_timestamps"] == 1
    assert quality["missing_values_by_column"]["reactive_power"] == 1
    assert quality["active_power_unit"] == "kW"


def test_reading_normalization_maps_missing_optional_fields_and_quality(readings):
    frame = normalize_readings(readings)
    assert "voltage_v" not in frame.columns
    assert frame.timestamp.dt.tz is not None
    assert quality_report(frame)["rows"] == len(readings)


@pytest.mark.parametrize(
    "payload",
    [
        [],
        [{"timestamp": "not-a-date", "active_power_kw": 1}],
        [{"timestamp": "2024-01-01T00:00:00Z", "active_power_kw": -1}],
        [{"timestamp": "2024-01-01T00:00:00Z", "active_power_kw": float("inf")}],
    ],
)
def test_rejects_invalid_readings(payload):
    with pytest.raises(DataValidationError):
        normalize_readings(payload)
