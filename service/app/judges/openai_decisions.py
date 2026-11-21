"""OpenAI Decisions API (`POST /v1/decisions`, `gpt-6-luna`; docs/judges-api-notes.md §2).

`input` = un mensaje `user` con la ficha como `input_text` y las imágenes como `input_image`.
`questions` es un array con nombre: `choice` principal + `predicate` auxiliares. Las respuestas
llegan en el mismo orden; se emparejan por `name` (con el índice como respaldo).

Cualquier pregunta puede devolver `{"type": "refusal"}`. Si se rechaza la principal, el
veredicto es LIMITADO con confianza 0 y `aux.refused = True`. OpenAI no define `confidence`
para choice, así que se usa la probabilidad máxima (el valor del proveedor queda en `aux`).
"""

from typing import Any

from app.judges.base import (
    FALLBACK_LABEL,
    HttpJudge,
    JudgeError,
    confidence_from_probs,
    label_probs,
    parse_label,
    state_json,
)
from app.models import FichaView, Verdict
from app.policy import Policy

OPENAI_URL = "https://api.openai.com/v1/decisions"
OPENAI_MODEL = "gpt-6-luna"
STATE_PREFIX = "Ficha del vídeo de YouTube (JSON):\n"


class OpenAIDecisionsJudge(HttpJudge):
    name = "openai/decisions"
    provider = "openai"
    model = OPENAI_MODEL
    url = OPENAI_URL

    def build_request(self, ficha: FichaView, policy: Policy) -> dict[str, Any]:
        q = policy.question
        content: list[dict[str, Any]] = [
            {"type": "input_text", "text": STATE_PREFIX + state_json(ficha)}
        ]
        content += [
            {"type": "input_image", "image_url": img.data_url} for img in self.images(ficha)
        ]
        questions: list[dict[str, Any]] = [
            {
                "type": "choice",
                "name": q.id,
                "instructions": q.instructions.strip(),
                "choices": [
                    {"value": label.value, "description": o.description.strip()}
                    for label, o in q.options.items()
                ],
            }
        ]
        questions += [
            {"type": "predicate", "name": aux.id, "instructions": aux.text}
            for aux in policy.auxiliary_questions
        ]
        return {
            "model": self.model,
            "input": [{"role": "user", "content": content}],
            "questions": questions,
        }

    def parse_response(self, data: dict[str, Any], policy: Policy, latency_ms: int) -> Verdict:
        answers = data.get("answers")
        if not isinstance(answers, list):
            raise JudgeError("OpenAI response without `answers` array")
        names = [policy.question.id, *(a.id for a in policy.auxiliary_questions)]
        by_name = _answers_by_name(answers, names)
        refused = [name for name, answer in by_name.items() if answer.get("type") == "refusal"]
        aux: dict[str, Any] = {"refused_questions": refused}
        for question in policy.auxiliary_questions:
            answer = by_name.get(question.id, {})
            aux[question.id] = (
                answer.get("probability") if answer.get("type") == "predicate" else None
            )

        main = by_name.get(policy.question.id)
        input_tokens = int((data.get("usage") or {}).get("input_tokens") or 0)
        common = {
            "input_tokens": input_tokens,
            "cost_usd": self.cost(input_tokens),
            "latency_ms": latency_ms,
            "raw": data,
        }
        if main is None or main.get("type") == "refusal":
            aux["refused"] = True
            return Verdict(label=FALLBACK_LABEL, probs={}, confidence=0.0, aux=aux, **common)
        if main.get("type") != "choice":
            raise JudgeError(f"Unexpected answer type for main question: {main.get('type')!r}")

        aux["refused"] = False
        probs = label_probs(
            {p.get("value"): p.get("probability", 0.0) for p in main.get("probabilities") or []}
        )
        label = parse_label(main.get("choice"))
        if label is None:
            label = FALLBACK_LABEL
            aux["unparsed_choice"] = main.get("choice")
        aux["provider_confidence"] = main.get("confidence")
        return Verdict(
            label=label, probs=probs, confidence=confidence_from_probs(probs), aux=aux, **common
        )

    async def decide(self, ficha: FichaView, policy: Policy) -> Verdict:
        data, latency_ms = await self.post(self.build_request(ficha, policy))
        return self.parse_response(data, policy, latency_ms)


def _answers_by_name(answers: list[Any], names: list[str]) -> dict[str, dict[str, Any]]:
    """Empareja respuestas por `name`; si falta (refusal sin nombre), por posición."""
    result: dict[str, dict[str, Any]] = {}
    for index, answer in enumerate(answers):
        if not isinstance(answer, dict):
            continue
        name = answer.get("name")
        if name is None and index < len(names):
            name = names[index]
        if isinstance(name, str):
            result[name] = answer
    return result
