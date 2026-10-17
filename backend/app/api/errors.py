import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from ..domain.errors import SceneInputError
from ..service.errors import (
    ApplicationError,
    CapacityExceeded,
    Conflict,
    InvalidInput,
    NotFound,
    NotImplementedCapability,
)

logger = logging.getLogger(__name__)


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApplicationError)
    @app.exception_handler(SceneInputError)
    async def application_error(request: Request, error: Exception):
        status = 500
        for kind, code in (
            (Conflict, 409),
            (NotFound, 404),
            (CapacityExceeded, 503),
            (NotImplementedCapability, 501),
            (InvalidInput, 422),
            (SceneInputError, 422),
        ):
            if isinstance(error, kind):
                status = code
                break
        payload = {"code": error.code, "message": str(error)}
        if getattr(error, "field", None):
            payload["field"] = error.field
        headers = {"Retry-After": "1"} if status == 503 else None
        return JSONResponse(
            status_code=status,
            content={"error": payload, "detail": str(error)},
            headers=headers,
        )

    @app.exception_handler(RequestValidationError)
    async def request_error(request: Request, error: RequestValidationError):
        return JSONResponse(
            status_code=422,
            content={
                "error": {"code": "invalid_input", "message": "Invalid request body"}
            },
        )

    @app.exception_handler(Exception)
    async def unexpected_error(request: Request, error: Exception):
        logger.exception("Application request failed", exc_info=error)
        return JSONResponse(
            status_code=500,
            content={
                "error": {
                    "code": "internal_error",
                    "message": "Application request failed",
                }
            },
        )
