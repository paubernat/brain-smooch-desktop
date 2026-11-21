"""Sesiones de administrador de la web local (PLAN-FASE2 §6).

Tras introducir la contraseña: cookie `HttpOnly` + `SameSite=Strict` de 10 minutos y un token
CSRF que el cliente manda en la cabecera `X-CSRF-Token` en cada acción que relaja. Las
sesiones viven en memoria: reiniciar el servicio las cierra todas.
"""

import hmac
import secrets
import time
from collections.abc import Callable
from dataclasses import dataclass

from fastapi import Request, Response

SESSION_TTL_S = 600
# Con `admin_session_s = 0` la sesión es de un solo uso: sirve para la siguiente acción que
# relaja (con este margen para hacerla) y se cierra en cuanto se usa.
SINGLE_USE_GRACE_S = 60
COOKIE_NAME = "bs_admin"
CSRF_HEADER = "X-CSRF-Token"

Clock = Callable[[], float]


@dataclass(frozen=True)
class Session:
    token: str
    csrf: str
    expires_at: float  # segundos de época


class SessionManager:
    def __init__(self, ttl_s: float = SESSION_TTL_S, clock: Clock = time.time) -> None:
        self.single_use = ttl_s <= 0
        self._ttl_s = SINGLE_USE_GRACE_S if self.single_use else ttl_s
        self._clock = clock
        self._sessions: dict[str, Session] = {}

    def create(self) -> Session:
        self._purge()
        session = Session(
            token=secrets.token_urlsafe(32),
            csrf=secrets.token_urlsafe(32),
            expires_at=self._clock() + self._ttl_s,
        )
        self._sessions[session.token] = session
        return session

    @property
    def ttl_s(self) -> float:
        return self._ttl_s

    def get(self, token: str | None) -> Session | None:
        if not token:
            return None
        session = self._sessions.get(token)
        if session is None or session.expires_at <= self._clock():
            self._sessions.pop(token, None)
            return None
        return session

    def from_request(self, request: Request) -> Session | None:
        return self.get(request.cookies.get(COOKIE_NAME))

    def csrf_ok(self, session: Session, request: Request) -> bool:
        sent = request.headers.get(CSRF_HEADER, "")
        return hmac.compare_digest(sent.encode(), session.csrf.encode())

    def revoke(self, token: str | None) -> None:
        if token:
            self._sessions.pop(token, None)

    def revoke_all(self) -> None:
        self._sessions.clear()

    def _purge(self) -> None:
        now = self._clock()
        for token in [t for t, s in self._sessions.items() if s.expires_at <= now]:
            del self._sessions[token]


def set_session_cookie(response: Response, session: Session, ttl_s: float = SESSION_TTL_S) -> None:
    response.set_cookie(
        COOKIE_NAME,
        session.token,
        max_age=int(ttl_s),
        httponly=True,
        samesite="strict",
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(COOKIE_NAME, path="/", httponly=True, samesite="strict")
