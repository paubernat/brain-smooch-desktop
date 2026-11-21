"""Migración de la caché de veredictos al esquema nuevo de `policy_version`.

Antes: `<version>-<sha256 del fichero entero[:8]>`. Ahora: `<model_version>-<sha256 de lo que
lee el modelo[:8]>` (ver `app.policy`). Para no perder veredictos ya pagados, al arrancar se
recalcula la clave antigua y la nueva de la política actual y de cada versión archivada en
`policy/history/` y se renombran las filas de `verdicts`. Se ejecuta una sola vez (ajuste
`policy_version_scheme`). Las evaluaciones de candidatos que nunca se guardaron no tienen
fichero del que recalcular su clave y quedan como estaban (la caché simplemente no las usa).
"""

import logging
from pathlib import Path

from app import db
from app.policy import legacy_policy_version, parse_policy

SCHEME_KEY = "policy_version_scheme"
SCHEME = 2

log = logging.getLogger(__name__)


def _policy_files(policy_path: Path, history_dir: Path) -> list[Path]:
    files = sorted(history_dir.glob("v*.yaml")) if history_dir.is_dir() else []
    return [*files, policy_path] if policy_path.exists() else files


def migrate_verdict_keys(database: db.Database, policy_path: Path, history_dir: Path) -> int:
    """Renombra las claves de la caché al esquema nuevo. Devuelve las filas movidas."""
    with database.connect() as conn:
        if db.get_setting(conn, SCHEME_KEY) == SCHEME:
            return 0
        moved = 0
        for path in _policy_files(policy_path, history_dir):
            try:
                text = path.read_text(encoding="utf-8")
                old, new = legacy_policy_version(text), parse_policy(text).policy_version
            except Exception as exc:  # un fichero archivado roto no debe impedir arrancar
                log.warning("skipping %s in the policy_version migration: %s", path.name, exc)
                continue
            if old != new:
                cursor = conn.execute(
                    "UPDATE verdicts SET policy_version = ? WHERE policy_version = ?", (new, old)
                )
                moved += cursor.rowcount
        db.put_setting(conn, SCHEME_KEY, SCHEME)
    if moved:
        log.info("policy_version migration: %d cached verdicts kept", moved)
    return moved
