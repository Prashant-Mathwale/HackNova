from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.config import DEFAULT_INTERVAL_MINUTES, MAX_HORIZON_STEPS, MAX_REQUEST_BATCH_SIZE


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Reading(StrictModel):
    timestamp: datetime
    active_power_kw: float = Field(ge=0, le=100000)
    reactive_power: Optional[float] = Field(default=None, ge=0, le=100000)
    voltage_v: Optional[float] = Field(default=None, ge=0, le=100000)
    current_a: Optional[float] = Field(default=None, ge=0, le=100000)
    energy_kwh: Optional[float] = Field(default=None, ge=0, le=100000000)
    sub_metering_1: Optional[float] = Field(default=None, ge=0, le=10000000)
    sub_metering_2: Optional[float] = Field(default=None, ge=0, le=10000000)
    sub_metering_3: Optional[float] = Field(default=None, ge=0, le=10000000)
    temperature: Optional[float] = Field(default=None, ge=-100, le=100)
    humidity: Optional[float] = Field(default=None, ge=0, le=100)


class ReadingsRequest(StrictModel):
    readings: list[Reading] = Field(min_length=1, max_length=MAX_REQUEST_BATCH_SIZE)

    @field_validator("readings")
    @classmethod
    def validate_timestamps(cls, readings):
        timestamps = [reading.timestamp for reading in readings]
        if len(set(timestamps)) != len(timestamps):
            raise ValueError("Reading timestamps must be unique.")
        return readings


class ForecastRequest(ReadingsRequest):
    horizon_steps: int = Field(default=1, ge=1, le=MAX_HORIZON_STEPS)
    interval_minutes: int = Field(default=DEFAULT_INTERVAL_MINUTES, ge=1, le=1440)


class PeakRequest(ReadingsRequest):
    threshold_kw: Optional[float] = Field(default=None, gt=0, le=100000)


class AnalysisRequest(ReadingsRequest):
    horizon_steps: int = Field(default=1, ge=1, le=MAX_HORIZON_STEPS)
    interval_minutes: int = Field(default=DEFAULT_INTERVAL_MINUTES, ge=1, le=1440)
    tariff_inr_per_kwh: Optional[float] = Field(default=None, ge=0, le=100000)
    peak_window_start_hour: Optional[int] = Field(default=None, ge=0, le=23)
    peak_window_end_hour: Optional[int] = Field(default=None, ge=0, le=23)


class ValidateRequest(ReadingsRequest):
    pass


class AppliancePredictionRequest(StrictModel):
    timestamp: datetime
    temperature_outdoor_c: float
    humidity_outdoor_pct: float = Field(ge=0, le=100)
