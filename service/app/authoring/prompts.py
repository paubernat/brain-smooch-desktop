"""Prompts y esquemas de salida del editor agéntico de la política.

Todo el texto que ve Claude está aquí; `author.py` solo arma las llamadas.
"""

import json
from typing import Any

from app.authoring.models import ErrorExample, EvalSnapshot, Preferences
from app.models import Label
from app.policy import PolicyContent

LABELS = [label.value for label in Label]

_RULES = """\
Redactas la política de decisión de un filtro personal de YouTube. Un modelo clasificador lee \
la política junto con una ficha del vídeo (título, canal, descripción, palabras clave, extracto \
de la transcripción…) y elige una de tres opciones:
- LIBRE: el dueño puede verlo sin límite.
- LIMITADO: se permite, pero con cupo de tiempo.
- NO: se bloquea.

Cómo escribir la política (en español, concisa y discriminativa):
- `instructions`: 2–4 frases que expliquen al clasificador para qué usa YouTube el dueño y \
cómo decidir.
- `options`: una descripción por opción, de 80 palabras como mucho. Prioriza criterios que se \
puedan observar en la ficha (tema, formato, tipo de canal, señales de calidad o de relleno) y \
ejemplos concretos (canales, juegos, deportes, formatos) sacados del texto del usuario. Las \
tres opciones no deben solaparse; si un caso podría caer en dos, dilo y resuélvelo.
- Principio: ante la duda, LIMITADO. Escríbelo de forma explícita en la descripción de LIMITADO.
- Los Shorts se juzgan con los mismos criterios que los vídeos largos.
- `auxiliary_questions`: de 3 a 6 preguntas de sí/no que ayuden a depurar errores (no deciden \
el veredicto). `id` en snake_case y en inglés (p. ej. `is_gaming`); `instructions`, una \
pregunta corta en español.
- No inventes preferencias que el usuario no haya expresado. Sin markdown dentro de los textos.
"""

DRAFT_SYSTEM = (
    _RULES
    + """
Tarea: convierte las preferencias del usuario, escritas en lenguaje natural, en un primer \
borrador de la política. `rationale`: 2–4 frases para el usuario sobre las decisiones de \
redacción y las ambigüedades que has resuelto.
"""
)

REFINE_SYSTEM = (
    _RULES
    + """
Tarea: recibes un borrador de la política y vídeos del conjunto de desarrollo que el \
clasificador ha fallado con ese borrador (con la etiqueta del usuario y la predicha). Corrige \
la política para que esos casos salgan bien sin sobreajustar: generaliza a criterios (no \
copies títulos ni ids de vídeo), conserva lo que ya funciona y, si hay que elegir, prefiere \
errores hacia LIMITADO antes que falsos LIBRE (el error grave es predecir LIBRE cuando el \
usuario dijo NO o LIMITADO). Si una etiqueta del usuario contradice sus preferencias, \
respeta la etiqueta. `rationale`: 2–4 frases sobre el diagnóstico. `changelog`: lista breve de \
cambios, una frase cada uno.
"""
)


def _string() -> dict[str, str]:
    return {"type": "string"}


def _draft_properties() -> dict[str, Any]:
    return {
        "instructions": _string(),
        "options": {
            "type": "object",
            "properties": {label: _string() for label in LABELS},
            "required": LABELS,
            "additionalProperties": False,
        },
        "auxiliary_questions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"id": _string(), "instructions": _string()},
                "required": ["id", "instructions"],
                "additionalProperties": False,
            },
        },
        "rationale": _string(),
    }


def draft_schema() -> dict[str, Any]:
    properties = _draft_properties()
    return {
        "type": "object",
        "properties": properties,
        "required": list(properties),
        "additionalProperties": False,
    }


def refine_schema() -> dict[str, Any]:
    properties = {**_draft_properties(), "changelog": {"type": "array", "items": _string()}}
    return {
        "type": "object",
        "properties": properties,
        "required": list(properties),
        "additionalProperties": False,
    }


def _policy_json(content: PolicyContent) -> str:
    q = content.question
    data = {
        "instructions": q.instructions.strip(),
        "options": {label.value: q.options[label].description.strip() for label in q.options},
        "auxiliary_questions": [
            {"id": a.id, "instructions": a.text} for a in content.auxiliary_questions
        ],
    }
    return json.dumps(data, ensure_ascii=False, indent=2)


def _preferences_text(prefs: Preferences) -> str:
    sections = []
    for title, text, examples in (
        ("LIBRE (sí, sin límite)", prefs.libre, prefs.examples.libre),
        ("LIMITADO (con cupo)", prefs.limitado, prefs.examples.limitado),
        ("NO", prefs.no, prefs.examples.no),
    ):
        body = text.strip() or "(sin indicar)"
        if examples.strip():
            body += f"\nVídeos de ejemplo:\n{examples.strip()}"
        sections.append(f"## {title}\n{body}")
    return "\n\n".join(sections)


def draft_user_message(prefs: Preferences, reference: PolicyContent) -> str:
    return (
        "Preferencias del usuario:\n\n"
        f"{_preferences_text(prefs)}\n\n"
        "Política actual, solo como referencia de estructura, tono y longitud (no copies su "
        "contenido si las preferencias no lo respaldan):\n"
        f"{_policy_json(reference)}"
    )


def refine_user_message(
    draft: PolicyContent,
    errors: list[ErrorExample],
    snapshot: EvalSnapshot | None,
    prefs: Preferences | None,
) -> str:
    parts = [f"Borrador actual:\n{_policy_json(draft)}"]
    if snapshot is not None:
        parts.append(
            f"Resultado en dev: {snapshot.n} vídeos, acierto {snapshot.accuracy:.0%}, "
            f"{snapshot.false_libre} falsos LIBRE."
        )
    if prefs is not None and not prefs.is_empty():
        parts.append(f"Preferencias originales del usuario:\n\n{_preferences_text(prefs)}")
    lines = [
        json.dumps(
            {
                "usuario": e.truth.value,
                "predicho": e.predicted.value,
                "confianza": round(e.confidence, 2),
                "ficha": e.summary,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )
        for e in errors
    ]
    parts.append("Vídeos mal clasificados (uno por línea, JSON):\n" + "\n".join(lines))
    return "\n\n".join(parts)
