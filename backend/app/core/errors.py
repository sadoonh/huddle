from __future__ import annotations


class AppError(Exception):
    """Base class for domain errors translated to HTTP responses in main.py."""

    status_code = 400
    code = "application_error"

    def __init__(self, message: str, *, details: dict | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or {}


class NotFoundError(AppError):
    status_code = 404
    code = "not_found"


class ForbiddenError(AppError):
    status_code = 403
    code = "forbidden"


class ConflictError(AppError):
    status_code = 409
    code = "conflict"


class UnauthorizedError(AppError):
    status_code = 401
    code = "unauthorized"


class DomainValidationError(AppError):
    status_code = 422
    code = "validation_error"
