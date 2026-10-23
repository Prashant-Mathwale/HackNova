class EnergyIQError(Exception):
    """Base exception for expected service errors."""


class DataValidationError(EnergyIQError, ValueError):
    """Raised when readings cannot be safely normalized or analyzed."""


class ModelNotReadyError(EnergyIQError):
    """Raised when an endpoint requires an artifact that is not trained."""
