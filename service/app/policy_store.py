"""Lectura y escritura de `policy/policy.yaml` (editor de perfil).

- Cada guardado sube `version` y deja la versión anterior en `policy/history/v<N>.yaml`.
- Se escribe de forma atómica (fichero temporal + `os.replace`).
- Antes de escribir se valida el texto con el mismo parser que usan los jueces y se comprueba
  que releerlo da exactamente el mismo contenido (round-trip). Las claves `NO`/`LIBRE`
  siempre salen entre comillas para que YAML 1.1 no lea `NO` como `false`.
- Un candidato sin guardar se renderiza con la versión que tendría al guardarse: su
  `policy_version` coincide con el del fichero guardado y la caché de veredictos se reutiliza.
"""

import os
import re
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel

from app.models import Label
from app.policy import Policy, PolicyContent, load_policy, parse_policy

HEADER = (
    "# Política de decisión (PLAN §8). Editable a mano o desde «Configura tu perfil» en la\n"
    "# extensión. Cada guardado sube `version`; las anteriores quedan en policy/history/.\n"
)
HISTORY_NAME = re.compile(r"^v(\d+)\.yaml$")
# Palabras que YAML 1.1 resolvería como booleanos (o null): siempre entre comillas.
_AMBIGUOUS = re.compile(r"^(?:y|n|yes|no|on|off|true|false|null|~)$", re.IGNORECASE)


class PolicyConflictError(Exception):
    """La política cambió en disco desde que el cliente la leyó."""


class HistoryEntry(BaseModel):
    version: int
    file: str
    saved_at: str


FOLD_AT = 80  # textos más largos se escriben como bloque plegado (`>`), como a mano


class _FlowList(list[str]):
    """Lista que se escribe en una línea: `[Atrioc, dunkey]`."""


class _PolicyDumper(yaml.SafeDumper):
    pass


def _represent_str(dumper: yaml.SafeDumper, value: str) -> yaml.ScalarNode:
    tag = "tag:yaml.org,2002:str"
    if "\n" in value.strip():
        return dumper.represent_scalar(tag, value, style="|")
    if _AMBIGUOUS.match(value):
        return dumper.represent_scalar(tag, value, style='"')
    if len(value) > FOLD_AT:
        return dumper.represent_scalar(tag, value, style=">")
    return dumper.represent_scalar(tag, value)


def _represent_flow_list(dumper: yaml.SafeDumper, value: _FlowList) -> yaml.SequenceNode:
    return dumper.represent_sequence("tag:yaml.org,2002:seq", value, flow_style=True)


_PolicyDumper.add_representer(str, _represent_str)
_PolicyDumper.add_representer(_FlowList, _represent_flow_list)


def _document(content: PolicyContent, version: int) -> dict[str, Any]:
    q = content.question
    return {
        "version": version,
        "question": {
            "id": q.id,
            "type": q.type,
            "instructions": q.instructions.strip(),
            "options": {
                label.value: {"description": q.options[label].description.strip()}
                for label in Label
                if label in q.options
            },
        },
        "auxiliary_questions": [
            _aux_document(a.id, a.type, a.instructions) for a in content.auxiliary_questions
        ],
        "channel_lists": {
            label.value: _FlowList(
                c.strip() for c in content.channel_lists.get(label, []) if c.strip()
            )
            for label in Label
        },
        "rules": content.rules.model_dump(),
        "blocked_sites": _FlowList(content.blocked_sites),
    }


def _aux_document(aux_id: str, aux_type: str, instructions: str | None) -> dict[str, str]:
    doc = {"id": aux_id.strip(), "type": aux_type}
    if instructions and instructions.strip():
        doc["instructions"] = instructions.strip()
    return doc


def render_policy(content: PolicyContent, version: int) -> str:
    """YAML que se escribiría para `content` con `version`."""
    body = yaml.dump(
        _document(content, version),
        Dumper=_PolicyDumper,
        sort_keys=False,
        allow_unicode=True,
        width=100,
        default_flow_style=False,
    )
    return HEADER + body


def normalized(content: PolicyContent) -> PolicyContent:
    """Contenido tal y como debe quedar tras escribirlo y releerlo (textos sin espacios extremos).

    Se calcula sin pasar por YAML, para que el round-trip compare contra algo independiente.
    """
    document = _document(content, 0)
    del document["version"]
    return PolicyContent.model_validate(document)


def check_round_trip(text: str, content: PolicyContent) -> Policy:
    parsed = parse_policy(text)  # valida con el modelo Policy
    if parsed.content() != normalized(content):
        raise ValueError("Policy YAML does not round-trip to the same content")
    return parsed


def parse_policy_yaml(text: str) -> PolicyContent:
    """Contenido de un YAML pegado a mano (`version` se ignora: la asigna el guardado)."""
    data = parse_policy(text).model_dump(include=set(PolicyContent.model_fields))
    return PolicyContent.model_validate(data)


class PolicyStore:
    def __init__(self, path: Path, history_dir: Path) -> None:
        self.path = path
        self.history_dir = history_dir

    def load(self) -> Policy:
        return load_policy(self.path)

    def raw_text(self) -> str:
        return self.path.read_text(encoding="utf-8")

    def next_version(self) -> int:
        current = self.load().version if self.path.exists() else 0
        return max([current, *self._history_versions()]) + 1

    def candidate(self, content: PolicyContent) -> Policy:
        """Política sin guardar, con el `policy_version` que tendrá al guardarse."""
        return parse_policy(render_policy(content, self.next_version()))

    def save(self, content: PolicyContent, expected_version: int | None = None) -> Policy:
        current = self.load() if self.path.exists() else None
        if expected_version is not None and current and current.version != expected_version:
            raise PolicyConflictError(
                f"policy is at version {current.version}, expected {expected_version}"
            )
        version = self.next_version()
        text = render_policy(content, version)
        saved = check_round_trip(text, content)
        if current is not None:
            self._archive(current.version)
        _atomic_write(self.path, text)
        return saved

    def history(self) -> list[HistoryEntry]:
        entries = []
        for version in sorted(self._history_versions(), reverse=True):
            path = self.history_dir / f"v{version}.yaml"
            mtime = datetime.fromtimestamp(path.stat().st_mtime, tz=UTC)
            entries.append(
                HistoryEntry(version=version, file=path.name, saved_at=mtime.isoformat())
            )
        return entries

    def _history_versions(self) -> list[int]:
        if not self.history_dir.is_dir():
            return []
        matches = (HISTORY_NAME.match(p.name) for p in self.history_dir.iterdir())
        return [int(m.group(1)) for m in matches if m]

    def _archive(self, version: int) -> None:
        target = self.history_dir / f"v{version}.yaml"
        if target.exists():
            return
        self.history_dir.mkdir(parents=True, exist_ok=True)
        _atomic_write(target, self.raw_text())


def _atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
