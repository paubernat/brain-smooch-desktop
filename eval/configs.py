"""Configuraciones de niveles de la ablación (PLAN §10.1).

`+L0` (p. ej. `D+L0`) añade el historial del canal, evaluado aparte con validación temporal.
"""

from app.models import InfoLevel

L1, L2, L3, L4 = InfoLevel.L1, InfoLevel.L2, InfoLevel.L3, InfoLevel.L4
CONFIG_LEVELS: dict[str, frozenset[InfoLevel]] = {
    "A": frozenset({L1}),
    "B": frozenset({L1, L2}),
    "C": frozenset({L1, L3}),
    "D": frozenset({L1, L2, L3}),
    "E": frozenset({L1, L2, L3, L4}),
    "F": frozenset({L1, L4}),
}
L0_SUFFIX = "+L0"


def config_levels(config: str) -> frozenset[InfoLevel]:
    with_l0 = config.endswith(L0_SUFFIX)
    base = config.removesuffix(L0_SUFFIX)
    if base not in CONFIG_LEVELS:
        raise ValueError(f"Unknown config {config!r}; use {', '.join(CONFIG_LEVELS)} (+L0)")
    levels = CONFIG_LEVELS[base]
    return levels | {InfoLevel.L0} if with_l0 else levels


def describe(config: str) -> str:
    return "+".join(sorted(level.value for level in config_levels(config)))
