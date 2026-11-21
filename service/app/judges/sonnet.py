"""OPCIONAL, solo experimentos: Claude Sonnet 5.5 con salida estructurada
(`output_config.format`, docs/judges-api-notes.md §3).

La JSON llega en el bloque `text`. `stop_reason: "refusal"` → LIMITADO con confianza 0 y
`aux.refused = True`. `messages`, `max_tokens` y `usage` son la forma básica de la Messages
API (las notas solo cubren lo específico de structured outputs y visión).
"""

import json
from typing import Any

from app.anthropic_api import (
    ANTHROPIC_URL,
    SONNET_MODEL,
    anthropic_headers,
    output_text,
    structured_request,
    usage_tokens,
)
from app.judges.base import (
    FALLBACK_LABEL,
    HttpJudge,
    JudgeError,
    confidence_from_probs,
    label_probs,
    parse_label,
    state_json,
)
from app.models import FichaView, Label, Verdict
from app.policy import Policy

__all__ = ["ANTHROPIC_URL", "SonnetJudge"]

MAX_TOKENS = 1024


def output_schema(policy: Policy) -> dict[str, Any]:
    labels = [label.value for label in Label]
    aux_ids = [a.id for a in policy.auxiliary_questions]
    return {
        "type": "object",
        "properties": {
            "label": {"type": "string", "enum": labels},
            "probs": {
                "type": "object",
                "properties": {label: {"type": "number"} for label in labels},
                "required": labels,
                "additionalProperties": False,
            },
            "reason": {"type": "string"},
            **{aux_id: {"type": "boolean"} for aux_id in aux_ids},
        },
        "required": ["label", "probs", "reason", *aux_ids],
        "additionalProperties": False,
    }


def build_prompt(ficha: FichaView, policy: Policy) -> str:
    q = policy.question
    options = "\n".join(
        f"- {label.value}: {o.description.strip()}" for label, o in q.options.items()
    )
    aux = "\n".join(f"- {a.id}: {a.text}" for a in policy.auxiliary_questions)
    return (
        f"{q.instructions.strip()}\n\nOpciones:\n{options}\n\n"
        "Devuelve `label`, la probabilidad de cada opción en `probs` (que sumen 1), un `reason` "
        f"breve y estas preguntas auxiliares como booleanos:\n{aux}\n\n"
        f"Ficha del vídeo (JSON):\n{state_json(ficha)}"
    )


class SonnetJudge(HttpJudge):
    name = "anthropic/sonnet"
    provider = "anthropic"
    model = SONNET_MODEL
    url = ANTHROPIC_URL

    def headers(self) -> dict[str, str]:
        return anthropic_headers(self.api_key)

    def build_request(self, ficha: FichaView, policy: Policy) -> dict[str, Any]:
        # Imágenes antes del texto (recomendación de la documentación de visión).
        content: list[dict[str, Any]] = [
            {
                "type": "image",
                "source": {"type": "base64", "media_type": i.media_type, "data": i.data},
            }
            for i in self.images(ficha)
        ]
        content.append({"type": "text", "text": build_prompt(ficha, policy)})
        return structured_request(self.model, MAX_TOKENS, content, output_schema(policy))

    def parse_response(self, data: dict[str, Any], policy: Policy, latency_ms: int) -> Verdict:
        input_tokens, output_tokens = usage_tokens(data)
        common = {
            "input_tokens": input_tokens,
            "cost_usd": self.cost(input_tokens, output_tokens),
            "latency_ms": latency_ms,
            "raw": data,
        }
        stop_reason = data.get("stop_reason")
        if stop_reason == "refusal":
            aux = {"refused": True, "stop_reason": stop_reason}
            return Verdict(label=FALLBACK_LABEL, probs={}, confidence=0.0, aux=aux, **common)

        text = output_text(data)
        try:
            parsed = json.loads(text) if isinstance(text, str) else None
        except json.JSONDecodeError as exc:
            raise JudgeError(f"Unparseable structured output (stop_reason={stop_reason})") from exc
        if not isinstance(parsed, dict):
            raise JudgeError(f"Missing structured output (stop_reason={stop_reason})")

        probs = label_probs(parsed.get("probs") or {})
        label = parse_label(parsed.get("label"))
        aux: dict[str, Any] = {"refused": False, "reason": parsed.get("reason")}
        if label is None:
            label = FALLBACK_LABEL
            aux["unparsed_choice"] = parsed.get("label")
        for question in policy.auxiliary_questions:
            value = parsed.get(question.id)
            aux[question.id] = float(value) if isinstance(value, bool) else None
        return Verdict(
            label=label, probs=probs, confidence=confidence_from_probs(probs), aux=aux, **common
        )

    async def decide(self, ficha: FichaView, policy: Policy) -> Verdict:
        data, latency_ms = await self.post(self.build_request(ficha, policy))
        return self.parse_response(data, policy, latency_ms)
