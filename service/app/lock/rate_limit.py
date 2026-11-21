"""Límite de intentos de contraseña con espera creciente (PLAN-FASE2 §6).

Los 3 primeros fallos seguidos son libres; desde ahí cada fallo obliga a esperar el doble
(2 s, 4 s, 8 s… hasta 15 min). Un acierto lo reinicia. Se guarda en `settings` para que
reiniciar el servicio no lo reinicie.
"""

import time
from collections.abc import Callable

from pydantic import BaseModel

from app import db
from app.settings_store import load_model, save_model

SETTINGS_KEY = "lock_attempts"
FREE_ATTEMPTS = 3
BASE_DELAY_S = 2.0
MAX_DELAY_S = 900.0


class AttemptState(BaseModel):
    failures: int = 0
    blocked_until: float = 0.0  # segundos de época


def delay_after(failures: int) -> float:
    """Espera impuesta tras `failures` fallos seguidos."""
    if failures < FREE_ATTEMPTS:
        return 0.0
    return min(BASE_DELAY_S * 2 ** (failures - FREE_ATTEMPTS), MAX_DELAY_S)


class LoginLimiter:
    def __init__(self, database: db.Database, clock: Callable[[], float] = time.time) -> None:
        self._db = database
        self._clock = clock

    def _state(self) -> AttemptState:
        return load_model(self._db, SETTINGS_KEY, AttemptState)

    def retry_after(self) -> float:
        """Segundos que faltan para poder intentarlo (0 = ya)."""
        return max(0.0, self._state().blocked_until - self._clock())

    def failure(self) -> float:
        state = self._state()
        failures = state.failures + 1
        wait = delay_after(failures)
        save_model(
            self._db,
            SETTINGS_KEY,
            AttemptState(failures=failures, blocked_until=self._clock() + wait),
        )
        return wait

    def success(self) -> None:
        save_model(self._db, SETTINGS_KEY, AttemptState())
