class ApplicationError(Exception):
    code = "application_error"

    def __init__(self, message: str, *, field: str | None = None):
        super().__init__(message)
        self.field = field


class InvalidInput(ApplicationError):
    code = "invalid_input"


class NotFound(ApplicationError):
    code = "not_found"


class Conflict(ApplicationError):
    code = "stale_scene"


class CapacityExceeded(ApplicationError):
    code = "capacity_exceeded"


class NotImplementedCapability(ApplicationError):
    code = "not_implemented"
