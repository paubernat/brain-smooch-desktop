"""Ajustes del bloqueo en Firefox (PLAN-FASE2 §5, H1) y decisión del gate.

- `mode`: `off` (solo etiquetado: la extensión no bloquea nada) o `soft` (el gate pausa el
  vídeo hasta el veredicto y aplica NO / LIMITADO / LIBRE). Por defecto `off`; el cohete del
  onboarding lo pasa a `soft`.
- `service_timeout_s`: si el servicio no responde en ese tiempo, la extensión bloquea
  (fail-closed).
- `decision_timeout_s`: tiempo máximo con la capa «Decidiendo…» (ficha + juez); al pasarlo,
  bloqueo con opción de reintentar.
- `block_shorts_feed`: bloquear el feed de Shorts en scroll (Short → Short).
"""

from typing import Literal

from pydantic import BaseModel, Field

from app.models import Label

SETTINGS_KEY = "enforcement"

EnforcementMode = Literal["off", "soft"]
GateAction = Literal["allow", "limit", "block"]

_ACTIONS: dict[Label, GateAction] = {
    Label.NO: "block",
    Label.LIMITADO: "limit",
    Label.LIBRE: "allow",
}


class EnforcementSettings(BaseModel):
    mode: EnforcementMode = "off"
    service_timeout_s: float = Field(default=6.0, ge=1.0, le=30.0)
    decision_timeout_s: float = Field(default=45.0, ge=5.0, le=180.0)
    block_shorts_feed: bool = True


class GateDecision(BaseModel):
    """Qué hace la extensión con el vídeo. `label` es la etiqueta efectiva: con confianza
    por debajo del umbral un veredicto del modelo pasa a LIMITADO (nunca LIBRE por duda)."""

    action: GateAction
    label: Label
    low_confidence: bool = False
    # Para explicar el bloqueo aunque el veredicto esté oculto en el panel (la extensión lo
    # traduce): quién decidió, qué regla y con qué confianza.
    source: Literal["rule", "model"] = "model"
    rule: str | None = None
    confidence: float = 1.0


def gate_decision(
    label: Label,
    confidence: float,
    *,
    from_rule: bool,
    min_confidence: float,
    rule: str | None = None,
) -> GateDecision:
    # El umbral solo rebaja LIBRE: un LIBRE dudoso pasa a LIMITADO. Un NO del modelo bloquea
    # siempre (antes un NO dudoso pasaba a LIMITADO, y subir el umbral acababa relajando).
    low = not from_rule and label == Label.LIBRE and confidence < min_confidence
    effective = Label.LIMITADO if low else label
    return GateDecision(
        action=_ACTIONS[effective],
        label=effective,
        low_confidence=low,
        source="rule" if from_rule else "model",
        rule=rule if from_rule else None,
        confidence=round(confidence, 4),
    )
