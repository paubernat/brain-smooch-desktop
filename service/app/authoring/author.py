"""Operaciones del editor agéntico: borrador desde preferencias, mejora con errores,
recalibración con las etiquetas pendientes y edición con una instrucción libre."""

import re
from typing import Any

from app.authoring import prompts
from app.authoring.client import AuthoringError, ClaudeAuthorClient
from app.authoring.models import (
    DraftResult,
    EditResult,
    ErrorExample,
    EvalSnapshot,
    FeedbackExample,
    FeedbackRef,
    Preferences,
    RefineResult,
    RefreshResult,
)
from app.models import Label
from app.policy import AuxQuestion, PolicyContent, PolicyOption, PolicyQuestion

MAX_ERROR_EXAMPLES = 25
MAX_FEEDBACK_EXAMPLES = 60
MAX_INSTRUCTION_CHARS = 2000
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
    return RefineResult(
        content=content_from_output(data, draft),
        rationale=str(data.get("rationale") or "").strip(),
        changelog=_changelog(data.get("changelog")),
        usage=usage,
    )


def select_feedback(examples: list[FeedbackExample]) -> list[FeedbackExample]:
    """Como mucho MAX_FEEDBACK_EXAMPLES: primero las que tienen motivo, luego las más recientes."""
    newest_first = sorted(examples, key=lambda e: e.labeled_at, reverse=True)
    ranked = sorted(newest_first, key=lambda e: not e.reason)  # estable: conserva el orden
    return ranked[:MAX_FEEDBACK_EXAMPLES]


async def refresh_with_feedback(
    client: ClaudeAuthorClient,
    current: PolicyContent,
    examples: list[FeedbackExample],
    base_version: int,
) -> RefreshResult:
    """Política revisada a partir de las etiquetas dev pendientes (motivos con peso alto).

    `feedback` lista exactamente las etiquetas enviadas: son las que se marcarán como
    incorporadas si el usuario guarda la propuesta.
    """
    selected = select_feedback(examples)
    if not selected:
        raise ValueError("no pending dev labels to learn from")
    data, usage = await client.complete(
        prompts.REFRESH_SYSTEM,
        prompts.refresh_user_message(current, selected),
        prompts.refresh_schema(),
    )
    return RefreshResult(
        content=content_from_output(data, current),
        rationale=str(data.get("rationale") or "").strip(),
        changelog=_changelog(data.get("changelog")),
        usage=usage,
        base_version=base_version,
        feedback=[FeedbackRef(video_id=e.video_id, labeled_at=e.labeled_at) for e in selected],
    )


async def edit_with_instruction(
    client: ClaudeAuthorClient, policy: PolicyContent, instruction: str
) -> EditResult:
    """Aplica una instrucción libre («quita lo de Fireship») a la política, sin guardar."""
    instruction = instruction.strip()
    if not instruction:
        raise ValueError("instruction is empty")
    data, usage = await client.complete(
        prompts.EDIT_SYSTEM,
        prompts.edit_user_message(policy, instruction[:MAX_INSTRUCTION_CHARS]),
        prompts.edit_schema(),
    )
    return EditResult(
        content=content_from_output(data, policy),
        changelog=" ".join(str(data.get("changelog") or "").split()),
        usage=usage,
    )


def _changelog(raw: Any) -> list[str]:
    return [str(item).strip() for item in raw or [] if str(item).strip()]


def content_from_output(data: dict[str, Any], base: PolicyContent) -> PolicyContent:
    """Salida estructurada → `PolicyContent`. El id de la pregunta, las reglas fijas (`rules`) y
    las webs bloqueadas (`blocked_sites`) salen de `base`, y también las listas de canales salvo
    que la salida traiga las suyas (recalibración y edición)."""
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
        channel_lists=_channel_lists(data.get("channel_lists"), base),
        rules=base.rules.model_copy(),
        blocked_sites=list(base.blocked_sites),
    )


def _channel_lists(raw: Any, base: PolicyContent) -> dict[Label, list[str]]:
    """Listas de la salida (sin vacíos ni duplicados; cada canal en una sola lista) o las de
    `base` si la salida no trae listas."""
    if not isinstance(raw, dict):
        return base.channel_lists
    lists: dict[Label, list[str]] = {}
    seen: set[str] = set()
    for label in Label:
        names = raw.get(label.value)
        lists[label] = []
        for name in names if isinstance(names, list) else []:
            clean = " ".join(str(name).split())
            if clean and clean.casefold() not in seen:
                seen.add(clean.casefold())
                lists[label].append(clean)
    return lists


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
