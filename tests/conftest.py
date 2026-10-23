from __future__ import annotations

import numpy as np
import pandas as pd
import pytest


@pytest.fixture
def household_frame():
    count = 800
    timestamps = pd.date_range("2024-01-01", periods=count, freq="min")
    index = np.arange(count)
    power = 0.5 + 0.1 * np.sin(index / 12) + 0.05 * np.cos(index / 37)
    return pd.DataFrame(
        {
            "timestamp": timestamps,
            "active_power_kw": power,
            "reactive_power": 0.1 + power * 0.1,
            "voltage_v": 230 + np.sin(index / 20),
            "current_a": power * 4,
            "sub_metering_1": 0.0,
            "sub_metering_2": 0.1,
            "sub_metering_3": 0.2,
        }
    )


@pytest.fixture
def readings(household_frame):
    frame = household_frame.tail(40)
    return [
        {"timestamp": row.timestamp.isoformat(), "active_power_kw": float(row.active_power_kw)}
        for row in frame.itertuples()
    ]
