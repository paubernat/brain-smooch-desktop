"""¿Endurecer o relajar? (PLAN-FASE2 §2 y §6). Funciones puras.

Cada función compara el valor actual con el nuevo y devuelve la lista de relajaciones
(códigos legibles). Lista vacía = endurecer o neutro: se aplica sin contraseña. Ante la duda,
relajar (conservador):

- Canales: salir de la lista NO, pasar de LIMITADO a LIBRE, entrar en LIBRE o salir de
  LIMITADO sin ir a NO (sin lista decide el modelo, que podría decir LIBRE). Entrar en NO o
  en LIMITADO desde ninguna lista, o salir de LIBRE, endurece.
- Webs bloqueadas: quitar alguna. Reglas fijas: desactivar alguna.
- Textos que lee el modelo (instrucciones, descripciones, preguntas auxiliares): cualquier
  edición cuenta como relajar, porque no se puede saber si permite más o menos.
- Juez en directo: bajar el umbral de confianza o cambiar juez / niveles.
- Bloqueo: pasar a `off`, permitir el feed de Shorts. Cupo: subirlo.
- Candado: acortar la espera para relajar.
"""

from app.enforcement import EnforcementSettings
from app.live_judge import LiveSettings
from app.lock.password import LockSettings
from app.models import Label
from app.policy import PolicyContent, model_hash
from app.quota.rules import QuotaSettings

Relaxations = list[str]


def _tiers(content: PolicyContent) -> dict[str, tuple[Label, str]]:
    """Canal (sin mayúsculas) → (lista, nombre tal cual)."""
    out: dict[str, tuple[Label, str]] = {}
    for label in (Label.LIBRE, Label.LIMITADO, Label.NO):  # NO gana si está repetido
        for name in content.channel_lists.get(label, []):
            if name.strip():
                out[name.strip().casefold()] = (label, name.strip())
    return out


def _channel_relaxes(old: Label | None, new: Label | None) -> bool:
    if old == new:
        return False
    if old == Label.NO:
        return True
    if new == Label.LIBRE:
        return True
    return old == Label.LIMITADO and new is None


def policy_relaxations(old: PolicyContent, new: PolicyContent) -> Relaxations:
    out: Relaxations = []
    if model_hash(old) != model_hash(new):
        out.append("model_text")
    old_tiers, new_tiers = _tiers(old), _tiers(new)
    for key in sorted(old_tiers.keys() | new_tiers.keys()):
        before = old_tiers.get(key, (None, ""))[0]
        after, name = new_tiers.get(key) or old_tiers[key]
        if _channel_relaxes(before, after if key in new_tiers else None):
            out.append(f"channel:{name}")
    out += [f"site:{d}" for d in old.blocked_sites if d not in new.blocked_sites]
    old_rules, new_rules = old.rules.model_dump(), new.rules.model_dump()
    out += [f"rule:{k}" for k, v in old_rules.items() if v and not new_rules.get(k)]
    return out


def live_relaxations(old: LiveSettings, new: LiveSettings) -> Relaxations:
    out: Relaxations = []
    if new.min_confidence < old.min_confidence:
        out.append("live:min_confidence")
    if new.judge != old.judge:
        out.append("live:judge")
    if new.config != old.config:
        out.append("live:config")
    return out


def enforcement_relaxations(old: EnforcementSettings, new: EnforcementSettings) -> Relaxations:
    out: Relaxations = []
    if old.mode == "soft" and new.mode == "off":
        out.append("enforcement:off")
    if old.block_shorts_feed and not new.block_shorts_feed:
        out.append("enforcement:shorts_feed")
    return out


def quota_relaxations(old: QuotaSettings, new: QuotaSettings) -> Relaxations:
    return ["quota:raise"] if new.daily_minutes > old.daily_minutes else []


def lock_relaxations(old: LockSettings, new: LockSettings) -> Relaxations:
    return ["lock:delay"] if new.relax_delay_hours < old.relax_delay_hours else []
