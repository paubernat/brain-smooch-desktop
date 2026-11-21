"""Puerta de los cambios que relajan (PLAN-FASE2 §6, H3).

- Sin contraseña creada (antes del onboarding) todo se aplica: no hay a quién pedirla.
- Con contraseña: un cambio que relaja exige sesión de administrador (cookie) y el token
  CSRF en `X-CSRF-Token`; si no, `401` (sin sesión) o `403` (CSRF incorrecto).
- Si además hay espera configurada, el cambio no se aplica: se crea una solicitud y la API
  responde `202` (excepción `RelaxDeferred`, convertida en respuesta en `main.py`).
- Endurecer nunca pide nada.
"""

from typing import Any

from fastapi import HTTPException, Request

from app.lock.password import PasswordVault
from app.lock.requests import RelaxRequest, RelaxRequestStore, RequestKind
from app.lock.sessions import Session, SessionManager


class RelaxDeferred(Exception):
    def __init__(self, request: RelaxRequest) -> None:
        super().__init__(f"relax request {request.id} scheduled for {request.apply_after}")
        self.request = request


class LockGuard:
    def __init__(
        self, vault: PasswordVault, sessions: SessionManager, requests: RelaxRequestStore
    ) -> None:
        self.vault = vault
        self.sessions = sessions
        self.requests = requests

    def admin_session(self, request: Request) -> Session:
        """Sesión válida con CSRF correcto, o la excepción HTTP adecuada."""
        session = self.sessions.from_request(request)
        if session is None:
            raise HTTPException(status_code=401, detail="admin session required")
        if not self.sessions.csrf_ok(session, request):
            raise HTTPException(status_code=403, detail="invalid CSRF token")
        return session

    def authorize(
        self,
        request: Request,
        relaxations: list[str],
        *,
        kind: RequestKind,
        payload: dict[str, Any],
        base_version: int | None = None,
    ) -> None:
        """Vuelve sin hacer nada si el cambio se puede aplicar ya."""
        if not relaxations or not self.vault.is_set():
            return
        session = self.sessions.from_request(request)
        if session is None:
            raise HTTPException(
                status_code=401,
                detail=f"admin session required to relax: {', '.join(relaxations)}",
            )
        if not self.sessions.csrf_ok(session, request):
            raise HTTPException(status_code=403, detail="invalid CSRF token")
        delay = self.vault.settings().relax_delay_hours
        if delay > 0:
            created = self.requests.create(
                kind, payload, relaxations, delay, base_version=base_version
            )
            raise RelaxDeferred(created)
        if self.sessions.single_use:
            self.sessions.revoke(session.token)
