class SceneInputError(ValueError):
    """A malformed or unconfirmed scene cannot enter planning."""

    code = "invalid_input"

    def __init__(self, message: str, *, field: str | None = None):
        super().__init__(message)
        self.field = field
