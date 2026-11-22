"""Aplica las solicitudes de relajación cuya espera ha vencido.

Se llama cada minuto desde el `lifespan` y al listar las solicitudes. Una solicitud de
política se aplica solo si la política no ha cambiado desde que se pidió
(`base_version`); si cambió, queda en `conflict` y hay que volver a pedirla.
"""

import logging
from typing import Any

from pydantic import ValidationError

from app.authoring.models import FeedbackRef
from app.enforcement import SETTINGS_KEY as ENFORCEMENT_KEY
from app.enforcement import EnforcementSettings
from app.live_judge import LiveSettings, save_live_settings
from app.lock.requests import RequestKind, RequestStatus
from app.policy import PolicyContent
from app.policy_feedback import mark_incorporated
from app.policy_store import PolicyConflictError
from app.quota.rules import QuotaSettings
from app.settings_store import save_model
from app.state import AppState

log = logging.getLogger(__name__)


def _apply(ctx: AppState, kind: RequestKind, payload: dict[str, Any], base: int | None) -> None:
    match kind:
        case "policy":
            content = PolicyContent.model_validate(payload["content"])
            saved = ctx.policies.save(content, expected_version=base)
            refs = [FeedbackRef.model_validate(r) for r in payload.get("incorporate", [])]
            mark_incorporated(ctx.database, refs, saved.version)
            ctx.enforce.notify_policy_changed()
        case "live":
            save_live_settings(ctx.database, LiveSettings.model_validate(payload))
        case "enforcement":
            save_model(ctx.database, ENFORCEMENT_KEY, EnforcementSettings.model_validate(payload))
        case "quota":
            ctx.quota.save_settings(QuotaSettings.model_validate(payload))
        case "lock":
            vault = ctx.lock.vault
            vault.save(vault.settings().model_copy(update=payload))


def apply_due(ctx: AppState) -> int:
    applied = 0
    for due in ctx.lock.requests.due():
        status: RequestStatus = "applied"
        try:
            _apply(ctx, due.request.kind, due.payload, due.base_version)
            applied += 1
        except (PolicyConflictError, ValidationError, ValueError, KeyError) as exc:
            log.warning("relax request %d not applied: %s", due.request.id, exc)
            status = "conflict"
        ctx.lock.requests.resolve(due.request.id, status)
    return applied
