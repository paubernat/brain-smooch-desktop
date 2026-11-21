"""Las dos operaciones del editor agéntico: borrador desde preferencias y mejora con errores."""

import re
from typing import Any

from app.authoring import prompts
from app.authoring.client import AuthoringError, ClaudeAuthorClient
from app.authoring.models import (
    DraftResult,
    ErrorExample,
    EvalSnapshot,
    Preferences,
    RefineResult,
)
from app.models import Label
from app.policy import AuxQuestion, PolicyContent, PolicyOption, PolicyQuestion

MAX_ERROR_EXAMPLES = 25
_NON_ID = re.compile(r"[^a-z0-9_]+")


async def draft_from_preferences(
    client: ClaudeAuthorClient, prefs: Preferences, base: PolicyContent
) -> DraftResult:
    """Primer borrador a partir del texto libre del usuario. Conserva las listas de canales
    y el id de la pregunta de `base` (la política actual)."""
    if prefs.is_empty():
        raise ValueError("preferences are empty")
    data, usage = await client.complete(
        prompts.DRAFT_SYSTEM, prompts.draft_user_message(prefs, base), prompts.draft_schema()
    )
    return DraftResult(
        content=content_from_output(data, base),
        rationale=str(data.get("rationale") or "").strip(),
        usage=usage,
    )


async def refine_with_errors(
    client: ClaudeAuthorClient,
    draft: PolicyContent,
    errors: list[ErrorExample],
    snapshot: EvalSnapshot | None = None,
    prefs: Preferences | None = None,
) -> RefineResult:
    """Borrador revisado + changelog a partir de los vídeos dev mal clasificados.

    Se priorizan los falsos LIBRE y, dentro de cada grupo, los errores más confiados.
    """
    if not errors:
        raise ValueError("no misclassified examples to learn from")
    ranked = sorted(errors, key=lambda e: (e.predicted != Label.LIBRE, -e.confidence))
    data, usage = await client.complete(
        prompts.REFINE_SYSTEM,
        prompts.refine_user_message(draft, ranked[:MAX_ERROR_EXAMPLES], snapshot, prefs),
        prompts.refine_schema(),
    )
    changelog = [str(item).strip() for item in data.get("changelog") or [] if str(item).strip()]
    return RefineResult(
        content=content_from_output(data, draft),
        rationale=str(data.get("rationale") or "").strip(),
        changelog=changelog,
        usage=usage,
    )


def content_from_output(data: dict[str, Any], base: PolicyContent) -> PolicyContent:
    """Salida estructurada → `PolicyContent` (listas de canales e id de pregunta de `base`)."""
    instructions = str(data.get("instructions") or "").strip()
    options_raw = data.get("options") or {}
    options = {}
    for label in Label:
        text = str(options_raw.get(label.value) or "").strip()
        if not text:
            raise AuthoringError(f"Draft has no description for {label.value}")
        options[label] = PolicyOption(description=text)
    if not instructions:
        raise AuthoringError("Draft has no instructions")
    return PolicyContent(
        question=PolicyQuestion(id=base.question.id, instructions=instructions, options=options),
        auxiliary_questions=_aux_questions(data.get("auxiliary_questions") or []),
        channel_lists=base.channel_lists,
    )


def aux_id(raw: str, index: int) -> str:
    slug = _NON_ID.sub("_", raw.strip().lower()).strip("_")
    return slug or f"aux_{index + 1}"


def _aux_questions(items: list[Any]) -> list[AuxQuestion]:
    questions: list[AuxQuestion] = []
    seen: set[str] = set()
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            continue
        question_id = aux_id(str(item.get("id") or ""), index)
        if question_id in seen:
            continue
        seen.add(question_id)
        text = str(item.get("instructions") or "").strip() or None
        questions.append(AuxQuestion(id=question_id, instructions=text))
    return questions
