"""Política de decisión (`policy/policy.yaml`, PLAN §8).

`policy_version` = "<version>-<sha256[:8]>" del fichero (con saltos de línea normalizados a
`\\n` para que el hash no dependa de cómo git haya hecho el checkout en Windows).
"""

import hashlib
import re
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, Field

from app.models import Label


class PolicyOption(BaseModel):
    description: str = ""


class PolicyQuestion(BaseModel):
    id: str
    type: Literal["choice"] = "choice"
    instructions: str
    options: dict[Label, PolicyOption]


class AuxQuestion(BaseModel):
    """Pregunta booleana auxiliar: ayuda a depurar, no decide el veredicto."""

    id: str
    type: Literal["boolean"] = "boolean"
    instructions: str | None = None

    @property
    def text(self) -> str:
        return self.instructions or f"¿{self.id.replace('_', ' ')}?"


class PolicyContent(BaseModel):
    """Parte editable de la política (todo menos `version` y el hash)."""

    question: PolicyQuestion
    auxiliary_questions: list[AuxQuestion] = Field(default_factory=list)
    channel_lists: dict[Label, list[str]] = Field(default_factory=dict)


class Policy(PolicyContent):
    version: int
    sha256: str = ""

    def content(self) -> PolicyContent:
        return PolicyContent.model_validate(
            self.model_dump(include=set(PolicyContent.model_fields))
        )

    @property
    def policy_version(self) -> str:
        return f"{self.version}-{self.sha256[:8]}"

    def prompt_chars(self) -> int:
        """Caracteres de texto de la política que viajan en cada llamada (para estimar tokens)."""
        q = self.question
        total = len(q.instructions) + sum(len(k) + len(o.description) for k, o in q.options.items())
        return total + sum(len(a.id) + len(a.text) for a in self.auxiliary_questions)


def policy_hash(text: str) -> str:
    normalized = text.replace("\r\n", "\n").encode("utf-8")
    return hashlib.sha256(normalized).hexdigest()


class _PolicyLoader(yaml.SafeLoader):
    """YAML 1.1 lee `NO:` como `False`; aquí solo `true`/`false` son booleanos."""


_PolicyLoader.yaml_implicit_resolvers = {
    first: [(tag, regex) for tag, regex in resolvers if tag != "tag:yaml.org,2002:bool"]
    for first, resolvers in yaml.SafeLoader.yaml_implicit_resolvers.items()
}
_PolicyLoader.add_implicit_resolver(
    "tag:yaml.org,2002:bool", re.compile(r"^(?:true|True|TRUE|false|False|FALSE)$"), list("tTfF")
)


def parse_policy(text: str) -> Policy:
    data = yaml.load(text, Loader=_PolicyLoader) or {}  # SafeLoader sin bools YAML 1.1
    data["sha256"] = policy_hash(text)
    return Policy.model_validate(data)


def load_policy(path: Path) -> Policy:
    return parse_policy(path.read_text(encoding="utf-8"))
