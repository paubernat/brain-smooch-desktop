"""Reglas fijas de la política (PLAN §8): deciden el veredicto antes de llamar al modelo.

Solo para producción (bloqueador, PLAN §13). La ablación evalúa el modelo y NO las aplica.

Orden: primero las reglas que dan NO (lista NO de canales, directos, etiqueta IA) y después
las listas LIMITADO/LIBRE de canales. Así un interruptor «No a…» gana siempre a un canal en
LIBRE: el error grave del proyecto es un falso LIBRE.
"""

from typing import Literal

from pydantic import BaseModel

from app.models import FichaOut, Label
from app.policy import PolicyContent

RuleId = Literal["channel_list", "block_live", "block_ai_labeled"]


class RuleDecision(BaseModel):
    label: Label
    rule: RuleId
    reason: str


def apply_rules(ficha: FichaOut, policy: PolicyContent) -> RuleDecision | None:
    """Veredicto fijo si alguna regla aplica; `None` si hay que preguntar al modelo."""
    meta = ficha.metadata
    if _in_channel_list(meta.channel_name, policy, Label.NO):
        return RuleDecision(label=Label.NO, rule="channel_list", reason="Canal en la lista NO")
    if policy.rules.block_live and meta.live is not None and meta.live.live_or_upcoming:
        what = "Directo en curso" if meta.live.is_live_now else "Directo programado"
        return RuleDecision(label=Label.NO, rule="block_live", reason=what)
    if policy.rules.block_ai_labeled and meta.ai_disclosure and meta.ai_disclosure.labeled:
        return RuleDecision(
            label=Label.NO,
            rule="block_ai_labeled",
            reason="Etiqueta de YouTube: contenido alterado o sintético",
        )
    for label in (Label.LIMITADO, Label.LIBRE):
        if _in_channel_list(meta.channel_name, policy, label):
            return RuleDecision(
                label=label, rule="channel_list", reason=f"Canal en la lista {label}"
            )
    return None


def _in_channel_list(channel: str | None, policy: PolicyContent, label: Label) -> bool:
    if not channel:
        return False
    name = channel.strip().casefold()
    return any(name == c.strip().casefold() for c in policy.channel_lists.get(label, []))
