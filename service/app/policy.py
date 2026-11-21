"""Política de decisión (`policy/policy.yaml`, PLAN §8).

`policy_version` = "<model_version>-<sha256[:8]>", la clave de la caché de veredictos. El hash
cubre solo lo que lee el modelo (instrucciones de la pregunta, descripciones de las opciones y
preguntas auxiliares), no `channel_lists`, `rules` ni `blocked_sites`: editar esas listas no
invalida la caché. `model_version` es la versión en la que cambió por última vez esa parte
(la escribe `PolicyStore.save`; un fichero antiguo sin ella usa `version`).
"""

import hashlib
import json
import re
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, Field, field_validator

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


class PolicyRules(BaseModel):
    """Reglas fijas (como `channel_lists`): se aplican antes del modelo en producción y no
    participan en la ablación (PLAN §8). Ver `app.rules.apply_rules`."""

    # NO a los vídeos con la etiqueta de YouTube «Contenido alterado o sintético».
    block_ai_labeled: bool = False
    # NO a los directos en curso y programados (las grabaciones las decide el modelo).
    block_live: bool = False


_DOMAIN_LABEL = re.compile(r"^(?!-)[a-z0-9-]{1,63}(?<!-)$")
_TLD = re.compile(r"^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$")


def normalize_domain(raw: str) -> str:
    """`https://www.Reddit.com/r/x` → `reddit.com`. ValueError si no es un dominio válido.

    Misma regla que la extensión (`extension/src/sites.ts`): sin esquema, ruta, puerto ni
    `www.`; al menos dos etiquetas y un TLD alfabético (o punycode). Las IP no valen.
    """
    text = raw.strip().lower()
    text = re.sub(r"^[a-z][a-z0-9+.-]*://", "", text)
    host = re.split(r"[/?#]", text, maxsplit=1)[0]
    host = host.rsplit("@", 1)[-1].split(":", 1)[0].rstrip(".")
    host = host.removeprefix("www.")
    labels = host.split(".")
    if (
        len(host) > 253
        or len(labels) < 2
        or not all(_DOMAIN_LABEL.match(label) for label in labels)
        or not _TLD.match(labels[-1])
    ):
        raise ValueError(f"invalid domain: {raw!r}")
    return host


class PolicyContent(BaseModel):
    """Parte editable de la política (todo menos `version` y el hash)."""

    question: PolicyQuestion
    auxiliary_questions: list[AuxQuestion] = Field(default_factory=list)
    channel_lists: dict[Label, list[str]] = Field(default_factory=dict)
    rules: PolicyRules = Field(default_factory=PolicyRules)
    # Webs que la extensión bloquea enteras (dominio y subdominios), fuera de YouTube. No
    # pasan por el juez ni por la ablación; Claude nunca las cambia.
    blocked_sites: list[str] = Field(default_factory=list)

    @field_validator("blocked_sites")
    @classmethod
    def _normalize_sites(cls, sites: list[str]) -> list[str]:
        out: list[str] = []
        for site in sites:
            domain = normalize_domain(site)
            if domain not in out:
                out.append(domain)
        return out


class Policy(PolicyContent):
    version: int
    # Versión en la que cambió por última vez la parte que lee el modelo (None: ficheros
    # anteriores a este campo → `version`).
    model_version: int | None = None
    sha256: str = ""  # hash de la parte que lee el modelo (`model_hash`)

    def content(self) -> PolicyContent:
        return PolicyContent.model_validate(
            self.model_dump(include=set(PolicyContent.model_fields))
        )

    @property
    def policy_version(self) -> str:
        return f"{self.model_version or self.version}-{self.sha256[:8]}"

    def prompt_chars(self) -> int:
        """Caracteres de texto de la política que viajan en cada llamada (para estimar tokens)."""
        q = self.question
        total = len(q.instructions) + sum(len(k) + len(o.description) for k, o in q.options.items())
        return total + sum(len(a.id) + len(a.text) for a in self.auxiliary_questions)


def policy_hash(text: str) -> str:
    """Hash del fichero entero (esquema antiguo de `policy_version`; solo para migrar)."""
    normalized = text.replace("\r\n", "\n").encode("utf-8")
    return hashlib.sha256(normalized).hexdigest()


def model_hash(content: PolicyContent) -> str:
    """Hash de lo que lee el modelo: pregunta (instrucciones y descripciones) y auxiliares.

    JSON canónico de los textos sin espacios extremos: ni el formato del YAML, ni los
    comentarios, ni las listas de canales / webs / reglas lo cambian."""
    q = content.question
    payload = {
        "question": {
            "id": q.id,
            "type": q.type,
            "instructions": q.instructions.strip(),
            "options": {
                str(label): option.description.strip()
                for label, option in sorted(q.options.items(), key=lambda kv: str(kv[0]))
            },
        },
        "auxiliary_questions": [
            {"id": a.id.strip(), "type": a.type, "instructions": (a.instructions or "").strip()}
            for a in content.auxiliary_questions
        ],
    }
    text = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


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
    data.pop("sha256", None)
    policy = Policy.model_validate(data)
    policy.sha256 = model_hash(policy)
    return policy


def legacy_policy_version(text: str) -> str:
    """`policy_version` del esquema anterior: versión + hash del fichero entero."""
    data = yaml.load(text, Loader=_PolicyLoader) or {}
    return f"{data.get('version')}-{policy_hash(text)[:8]}"


def load_policy(path: Path) -> Policy:
    return parse_policy(path.read_text(encoding="utf-8"))
