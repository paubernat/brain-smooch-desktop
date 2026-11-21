"""Contraseña del custodio (PLAN-FASE2 §6): solo se guarda el hash argon2id.

Vive en la tabla `settings` (clave `lock`) junto con el nombre del custodio y la espera
opcional para relajar. Nunca se devuelve el hash por la API.
"""

from datetime import UTC, datetime

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from pydantic import BaseModel, Field

from app import db
from app.settings_store import load_model, save_model

SETTINGS_KEY = "lock"
MIN_PASSWORD_LENGTH = 8
MAX_PASSWORD_LENGTH = 256
MAX_RELAX_DELAY_HOURS = 168


class LockSettings(BaseModel):
    password_hash: str | None = None
    custodian: str = ""
    created_at: str | None = None
    # Espera entre pedir una relajación (con contraseña) y que se aplique. 0 = sin espera.
    relax_delay_hours: int = Field(default=0, ge=0, le=MAX_RELAX_DELAY_HOURS)


class PasswordError(ValueError):
    """Contraseña que no cumple los requisitos (longitud, confirmación)."""


def check_new_password(password: str, confirm: str) -> None:
    if password != confirm:
        raise PasswordError("passwords do not match")
    if not MIN_PASSWORD_LENGTH <= len(password) <= MAX_PASSWORD_LENGTH:
        raise PasswordError(
            f"password must be {MIN_PASSWORD_LENGTH}-{MAX_PASSWORD_LENGTH} characters long"
        )


class PasswordVault:
    """Lee y escribe `LockSettings`. `hasher` es inyectable (tests con parámetros baratos)."""

    def __init__(self, database: db.Database, hasher: PasswordHasher | None = None) -> None:
        self._db = database
        self._hasher = hasher or PasswordHasher()  # argon2id con los parámetros por defecto

    def settings(self) -> LockSettings:
        return load_model(self._db, SETTINGS_KEY, LockSettings)

    def save(self, value: LockSettings) -> LockSettings:
        return save_model(self._db, SETTINGS_KEY, value)

    def is_set(self) -> bool:
        return self.settings().password_hash is not None

    def set_password(self, password: str, *, custodian: str | None = None) -> LockSettings:
        current = self.settings()
        updated = current.model_copy(
            update={
                "password_hash": self._hasher.hash(password),
                "custodian": current.custodian if custodian is None else custodian.strip(),
                "created_at": datetime.now(UTC).isoformat(timespec="seconds"),
            }
        )
        return self.save(updated)

    def verify(self, password: str) -> bool:
        stored = self.settings().password_hash
        if stored is None:
            return False
        try:
            return self._hasher.verify(stored, password)
        except (VerificationError, InvalidHashError):
            return False
