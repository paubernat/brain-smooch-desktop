"""Liquid AI decision models `d1.2-ultra` / `d1.2` (docs/judges-api-notes.md §1).

`POST https://api.liquid.ai/decisions/v1/systemone`. `questions` es un objeto por nombre:
la pregunta principal es `choice` y las auxiliares `noul`. Las imágenes van en `images` como
data URLs (máx. 8). Respuesta: `answers.<id>` con `choice`/`probabilities`/`confidence`
(choice) o `noul` = P(sí). Liquid define `confidence`, así que se usa tal cual.
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

LIQUID_URL = "https://api.liquid.ai/decisions/v1/systemone"
MAX_IMAGES = 8


class LiquidJudge(HttpJudge):
    provider = "liquid"
    url = LIQUID_URL

    def __init__(self, model: str, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.model = model
        self.name = f"liquid/{model}"

    def build_request(self, ficha: FichaView, policy: Policy) -> dict[str, Any]:
        q = policy.question
        questions: dict[str, Any] = {
            q.id: {
                "type": "choice",
                "instructions": q.instructions.strip(),
                "criteria": {label.value: o.description.strip() for label, o in q.options.items()},
            }
        }
        for aux in policy.auxiliary_questions:
            questions[aux.id] = {"type": "noul", "instructions": aux.text}
        body: dict[str, Any] = {
            "model": self.model,
            "state": state_json(ficha),
            "questions": questions,
        }
        images = self.images(ficha, MAX_IMAGES)
        if images:
            body["images"] = [img.data_url for img in images]
        return body

    def parse_response(self, data: dict[str, Any], policy: Policy, latency_ms: int) -> Verdict:
        answers = data.get("answers")
        if not isinstance(answers, dict):
            raise JudgeError("Liquid response without `answers` object")
        main = answers.get(policy.question.id)
        if not isinstance(main, dict):
            raise JudgeError(f"Liquid response without answer for {policy.question.id!r}")
        probs = label_probs(main.get("probabilities") or {})
        label = parse_label(main.get("choice"))
        aux: dict[str, Any] = {}
        if label is None:
            label = FALLBACK_LABEL
            aux["unparsed_choice"] = main.get("choice")
        confidence = main.get("confidence")
        for question in policy.auxiliary_questions:
            answer = answers.get(question.id)
            aux[question.id] = answer.get("noul") if isinstance(answer, dict) else None
        input_tokens = int((data.get("usage") or {}).get("input_tokens") or 0)
        return Verdict(
            label=label,
            probs=probs,
            confidence=float(confidence)
            if confidence is not None
            else confidence_from_probs(probs),
            aux=aux,
            input_tokens=input_tokens,
            cost_usd=self.cost(input_tokens),
            latency_ms=latency_ms,
            raw=data,
        )

    async def decide(self, ficha: FichaView, policy: Policy) -> Verdict:
        data, latency_ms = await self.post(self.build_request(ficha, policy))
        return self.parse_response(data, policy, latency_ms)
