"""Prompts y esquemas de salida del editor agéntico de la política.

Todo el texto que ve Claude está aquí; `author.py` solo arma las llamadas.
"""

import json
from typing import Any

from app.authoring.models import ErrorExample, EvalSnapshot, FeedbackExample, Preferences
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

_CHANNEL_RULES = """\
- `channel_lists`: nombres de canal por opción; son reglas fijas que se aplican antes del \
clasificador. Cámbialas solo cuando el usuario lo pida de forma explícita (p. ej. «añade este \
canal a LIMITADO»); si no, devuélvelas tal cual. Un canal no puede estar en dos listas.
"""

REFRESH_SYSTEM = (
    _RULES
    + _CHANNEL_RULES
    + """
Tarea: recibes la política vigente y los vídeos que el usuario ha etiquetado desde la última \
revisión (su etiqueta y, a veces, un motivo escrito por él). Revisa la política para que \
recoja esas decisiones:
- Los motivos del usuario son criterios explícitos y tienen prioridad alta: incorpóralos, \
generalizados, en la opción que corresponda. Si un motivo pide algo concreto (mover un tema de \
categoría, añadir un canal a una lista), hazlo.
- Las etiquetas sin motivo son evidencia: busca patrones (temas, formatos, tipos de canal) y \
generaliza; no copies títulos ni ids de vídeo.
- Si una etiqueta contradice la política, manda la etiqueta. Conserva lo que no contradigan.
- Si hay que elegir, prefiere errores hacia LIMITADO antes que falsos LIBRE.
- Si los ejemplos no justifican cambios, devuelve la política igual y dilo en el changelog.
- Si llega una «Indicación del usuario para esta revisión», es una orden explícita con \
prioridad alta: aplícala (aunque pida cambiar listas de canales) y, si choca con alguna \
etiqueta, manda la indicación. Menciónala en el changelog.
`rationale`: 2–4 frases sobre lo que has aprendido de las etiquetas. `changelog`: lista breve \
de cambios, una frase cada uno.
"""
)

EDIT_SYSTEM = (
    _RULES
    + _CHANNEL_RULES
    + """
Tarea: aplica a la política la instrucción del usuario, y solo esa. Cambia lo mínimo necesario \
y deja el resto del texto idéntico (mismas frases, mismo orden). Si la instrucción pide quitar \
algo, quítalo de todos los sitios donde aparezca (descripciones y listas de canales). \
`changelog`: una sola frase en español que describa el cambio hecho.
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


def _channel_lists_property() -> dict[str, Any]:
    names = {"type": "array", "items": _string()}
    return {
        "type": "object",
        "properties": dict.fromkeys(LABELS, names),
        "required": LABELS,
        "additionalProperties": False,
    }


def _object(properties: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": properties,
        "required": list(properties),
        "additionalProperties": False,
    }


def draft_schema() -> dict[str, Any]:
    return _object(_draft_properties())


def refine_schema() -> dict[str, Any]:
    return _object({**_draft_properties(), "changelog": {"type": "array", "items": _string()}})


def refresh_schema() -> dict[str, Any]:
    return _object(
        {
            **_draft_properties(),
            "channel_lists": _channel_lists_property(),
            "changelog": {"type": "array", "items": _string()},
        }
    )


def edit_schema() -> dict[str, Any]:
    properties = {k: v for k, v in _draft_properties().items() if k != "rationale"}
    return _object(
        {**properties, "channel_lists": _channel_lists_property(), "changelog": _string()}
    )


def _policy_json(content: PolicyContent, with_channels: bool = False) -> str:
    q = content.question
    data: dict[str, Any] = {
        "instructions": q.instructions.strip(),
        "options": {label.value: q.options[label].description.strip() for label in q.options},
        "auxiliary_questions": [
            {"id": a.id, "instructions": a.text} for a in content.auxiliary_questions
        ],
    }
    if with_channels:
        data["channel_lists"] = {
            label.value: content.channel_lists.get(label, []) for label in Label
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


def _feedback_line(example: FeedbackExample) -> str:
    item: dict[str, Any] = {"usuario": example.label.value}
    if example.reason:
        item["motivo"] = example.reason
    item["ficha"] = example.summary
    return json.dumps(item, ensure_ascii=False, separators=(",", ":"))


def refresh_user_message(
    current: PolicyContent, examples: list[FeedbackExample], instruction: str = ""
) -> str:
    with_reason = [e for e in examples if e.reason]
    without_reason = [e for e in examples if not e.reason]
    parts = [f"Política vigente:\n{_policy_json(current, with_channels=True)}"]
    if instruction.strip():
        parts.append(
            "Indicación del usuario para esta revisión (orden explícita, prioridad alta; "
            f"manda sobre las etiquetas):\n{instruction.strip()}"
        )
    if with_reason:
        parts.append(
            "Etiquetas con motivo del usuario (criterios explícitos, prioridad alta; "
            "una por línea, JSON):\n" + "\n".join(map(_feedback_line, with_reason))
        )
    if without_reason:
        parts.append(
            "Etiquetas sin motivo (evidencia; una por línea, JSON):\n"
            + "\n".join(map(_feedback_line, without_reason))
        )
    return "\n\n".join(parts)


def edit_user_message(policy: PolicyContent, instruction: str) -> str:
    return (
        f"Política actual:\n{_policy_json(policy, with_channels=True)}\n\n"
        f"Instrucción del usuario:\n{instruction.strip()}"
    )
