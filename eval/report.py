"""Informe de la ablación (PLAN §10.4): `eval/reports/<YYYY-MM-DD>.md` + `.html`.

Contenido: tabla resumen, desgloses, matriz de confusión del mejor par, calibración,
curva cobertura/acierto (PNG en base64 en el HTML), los 10 errores más confiados y una
recomendación (menor falso LIBRE → mayor macro-F1 → menor coste).
"""

import base64
import html
import io
import math
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

from eval.configs import describe
from eval.metrics import (
    LABELS,
    Record,
    Summary,
    breakdowns,
    group_records,
    rank_key,
    recommend_threshold,
    summarize,
)

MIN_ACCURACY = 0.9  # acierto mínimo dentro de lo decidido automáticamente
MAX_FALSE_LIBRE = 0.0  # falso LIBRE tolerado dentro de lo decidido automáticamente
TOP_ERRORS = 10


@dataclass
class Table:
    headers: list[str]
    rows: list[list[str]]


@dataclass
class ReportData:
    title: str
    meta: list[str]
    summary: Table
    breakdown: Table
    best: Summary | None
    confusion: Table | None
    reliability: Table | None
    coverage: Table | None
    errors: Table | None
    recommendation: list[str]
    coverage_png: bytes | None
    reliability_png: bytes | None


# --- formato -----------------------------------------------------------------------------------


def pct(value: float) -> str:
    return "—" if math.isnan(value) else f"{value * 100:.1f}%"


def num(value: float, digits: int = 3) -> str:
    return "—" if math.isnan(value) else f"{value:.{digits}f}"


def usd(value: float) -> str:
    return "—" if math.isnan(value) else f"${value:.6f}"


def video_url(record: Record) -> str:
    if record.is_short:
        return f"https://www.youtube.com/shorts/{record.video_id}"
    return f"https://www.youtube.com/watch?v={record.video_id}"


def probs_text(record: Record) -> str:
    return " ".join(f"{label.value}={record.probs.get(label, 0.0):.2f}" for label in LABELS)


# --- construcción ------------------------------------------------------------------------------


def summary_table(summaries: Sequence[Summary]) -> Table:
    headers = ["modelo", "config", "n", "acierto", "macro-F1", "falso LIBRE", "falso NO", "ECE",
               "$/vídeo", "p50 ms", "p95 ms", "rechazos"]  # fmt: skip
    rows = [
        [
            s.model_key,
            s.config,
            str(s.n),
            pct(s.accuracy),
            num(s.macro_f1),
            pct(s.false_libre_rate),
            pct(s.false_no_rate),
            num(s.ece),
            usd(s.cost_per_video),
            num(s.latency_p50, 0),
            num(s.latency_p95, 0),
            str(s.refusals),
        ]
        for s in summaries
    ]
    return Table(headers, rows)


def breakdown_table(groups: dict[tuple[str, str], list[Record]], order: Sequence[Summary]) -> Table:
    subsets = ["shorts", "videos", "with_transcript", "without_transcript"]
    headers = ["modelo", "config"] + [f"{s} (n · acierto · falso LIBRE)" for s in subsets]
    rows = []
    for summary in order:
        parts = breakdowns(groups[(summary.model_key, summary.config)])
        cells = [
            f"{parts[s].n} · {pct(parts[s].accuracy)} · {pct(parts[s].false_libre_rate)}"
            for s in subsets
        ]
        rows.append([summary.model_key, summary.config, *cells])
    return Table(headers, rows)


def confusion_table(summary: Summary) -> Table:
    headers = ["verdad \\ predicho", *(label.value for label in LABELS)]
    rows = [
        [label.value, *(str(v) for v in row)]
        for label, row in zip(LABELS, summary.confusion, strict=True)
    ]
    return Table(headers, rows)


def reliability_table(summary: Summary) -> Table:
    rows = [
        [f"[{b.lower:.1f}, {b.upper:.1f})", str(b.count), num(b.mean_confidence), pct(b.accuracy)]
        for b in summary.reliability
        if b.count
    ]
    return Table(["bin", "n", "confianza media", "acierto"], rows)


def coverage_table(summary: Summary) -> Table:
    rows = [
        [f"{p.threshold:.2f}", pct(p.coverage), pct(p.accuracy), pct(p.false_libre_rate)]
        for p in summary.coverage
    ]
    return Table(["umbral", "cobertura", "acierto", "falso LIBRE"], rows)


def errors_table(records: Sequence[Record], limit: int = TOP_ERRORS) -> Table:
    errors = sorted((r for r in records if not r.correct), key=lambda r: -r.confidence)[:limit]
    rows = [
        [r.title, r.truth.value, r.pred.value, num(r.confidence, 2), probs_text(r), video_url(r)]
        for r in errors
    ]
    return Table(["título", "verdad", "veredicto", "confianza", "probabilidades", "enlace"], rows)


def recommendation(best: Summary | None) -> list[str]:
    if best is None:
        return ["Sin resultados: no hay recomendación."]
    levels = describe(best.config)
    lines = [
        f"**Modelo:** `{best.model_key}`. **Niveles:** {levels} (config `{best.config}`).",
        f"Falso LIBRE {pct(best.false_libre_rate)}, macro-F1 {num(best.macro_f1)}, "
        f"coste {usd(best.cost_per_video)}/vídeo.",
    ]
    point = recommend_threshold(best.coverage, MIN_ACCURACY, MAX_FALSE_LIBRE)
    if point is None:
        lines.append(
            f"**Umbral:** ninguno cumple acierto ≥ {pct(MIN_ACCURACY)} con falso LIBRE ≤ "
            f"{pct(MAX_FALSE_LIBRE)}; por debajo del umbral, LIMITADO por defecto."
        )
    else:
        lines.append(
            f"**Umbral:** confianza ≥ {point.threshold:.2f} → decide automáticamente el "
            f"{pct(point.coverage)} con acierto {pct(point.accuracy)}; el resto pasa al "
            "siguiente nivel de información o a LIMITADO."
        )
    return lines


def coverage_chart(summary: Summary) -> bytes:
    xs = [p.threshold for p in summary.coverage]
    fig, ax = plt.subplots(figsize=(6, 3.5), dpi=110)
    ax.plot(xs, [p.coverage for p in summary.coverage], marker="o", label="cobertura")
    ax.plot(xs, [p.accuracy for p in summary.coverage], marker="o", label="acierto")
    ax.set_xlabel("umbral de confianza")
    ax.set_ylim(0, 1.05)
    ax.grid(alpha=0.3)
    ax.legend()
    ax.set_title(f"Cobertura/acierto — {summary.model_key} · {summary.config}")
    return _png(fig)


def reliability_chart(summary: Summary) -> bytes:
    bins = [b for b in summary.reliability if b.count]
    fig, ax = plt.subplots(figsize=(4.5, 4.5), dpi=110)
    ax.plot([0, 1], [0, 1], linestyle="--", color="grey", label="calibración perfecta")
    ax.bar([(b.lower + b.upper) / 2 for b in bins], [b.accuracy for b in bins],
           width=0.09, alpha=0.7, label="acierto por bin")  # fmt: skip
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.set_xlabel("confianza")
    ax.set_ylabel("acierto")
    ax.legend(loc="upper left")
    ax.set_title(f"Fiabilidad (ECE {num(summary.ece)})")
    return _png(fig)


def _png(fig: plt.Figure) -> bytes:
    buffer = io.BytesIO()
    fig.tight_layout()
    fig.savefig(buffer, format="png")
    plt.close(fig)
    return buffer.getvalue()


def build_report(
    records: Sequence[Record],
    *,
    report_date: date,
    split: str,
    policy_version: str,
    failures: int = 0,
    charts: bool = True,
) -> ReportData:
    groups = group_records(records)
    summaries = sorted((summarize(rs) for rs in groups.values()), key=rank_key)
    best = summaries[0] if summaries else None
    best_records = groups[(best.model_key, best.config)] if best else []
    videos = len({r.video_id for r in records})
    return ReportData(
        title=f"Ablación {report_date.isoformat()}",
        meta=[
            f"Split `{split}` · {videos} vídeos · {len(records)} veredictos · "
            f"política `{policy_version}` · {failures} llamadas fallidas",
            "Orden: menor falso LIBRE, luego mayor macro-F1, luego menor coste.",
        ],
        summary=summary_table(summaries),
        breakdown=breakdown_table(groups, summaries),
        best=best,
        confusion=confusion_table(best) if best else None,
        reliability=reliability_table(best) if best else None,
        coverage=coverage_table(best) if best else None,
        errors=errors_table(best_records) if best else None,
        recommendation=recommendation(best),
        coverage_png=coverage_chart(best) if best and charts else None,
        reliability_png=reliability_chart(best) if best and charts else None,
    )


# --- render ------------------------------------------------------------------------------------


def _md_cell(text: str) -> str:
    return text.replace("|", "\\|").replace("\n", " ")


def md_table(table: Table) -> str:
    lines = ["| " + " | ".join(_md_cell(h) for h in table.headers) + " |",
             "|" + "---|" * len(table.headers)]  # fmt: skip
    lines += ["| " + " | ".join(_md_cell(c) for c in row) + " |" for row in table.rows]
    return "\n".join(lines)


def html_table(table: Table) -> str:
    head = "".join(f"<th>{html.escape(h)}</th>" for h in table.headers)
    body = ""
    for row in table.rows:
        cells = []
        for cell in row:
            text = html.escape(cell)
            if cell.startswith("https://"):
                text = f'<a href="{text}">{text}</a>'
            cells.append(f"<td>{text}</td>")
        body += f"<tr>{''.join(cells)}</tr>"
    return f"<table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>"


def _sections(data: ReportData) -> list[tuple[str, Table | None]]:
    best_name = f"{data.best.model_key} · {data.best.config}" if data.best else "—"
    return [
        ("Resumen", data.summary),
        ("Desglose: Shorts/vídeos y con/sin transcripción", data.breakdown),
        (f"Matriz de confusión del mejor par ({best_name})", data.confusion),
        (f"Calibración del mejor par ({best_name})", data.reliability),
        (f"Cobertura con umbral ({best_name})", data.coverage),
        (f"Los {TOP_ERRORS} errores más confiados ({best_name})", data.errors),
    ]


def render_markdown(data: ReportData) -> str:
    parts = [f"# {data.title}", "", *data.meta, ""]
    for title, table in _sections(data):
        if table is not None:
            parts += [f"## {title}", "", md_table(table), ""]
    parts += ["## Recomendación", "", *(f"- {line}" for line in data.recommendation), ""]
    if data.coverage_png:
        parts += ["_Gráficas de cobertura y fiabilidad en el informe HTML._", ""]
    return "\n".join(parts)


CSS = """
:root { color-scheme: light dark; --fg:#1d1d1f; --bg:#fff; --muted:#666; --line:#ddd; }
@media (prefers-color-scheme: dark) {
  :root { --fg:#e8e8e8; --bg:#161616; --muted:#aaa; --line:#333; }
}
body { font: 14px/1.5 system-ui, sans-serif; color: var(--fg); background: var(--bg);
       max-width: 1100px; margin: 0 auto; padding: 16px; }
table { border-collapse: collapse; margin: 8px 0 24px; display: block; overflow-x: auto; }
th, td { border-bottom: 1px solid var(--line); padding: 4px 8px; text-align: left; }
th { color: var(--muted); font-weight: 600; }
img { max-width: 100%; height: auto; background: #fff; }
.meta { color: var(--muted); }
"""


def _md_inline(text: str) -> str:
    """Escapa y convierte **negrita** y `código` del texto de la recomendación."""
    out = html.escape(text)
    for marker, tag in (("**", "strong"), ("`", "code")):
        pieces = out.split(marker)
        out = "".join(
            piece if i % 2 == 0 else f"<{tag}>{piece}</{tag}>" for i, piece in enumerate(pieces)
        )
    return out


def render_html(data: ReportData) -> str:
    parts = [f"<h1>{html.escape(data.title)}</h1>"]
    parts += [f'<p class="meta">{_md_inline(m)}</p>' for m in data.meta]
    for title, table in _sections(data):
        if table is None:
            continue
        parts += [f"<h2>{html.escape(title)}</h2>", html_table(table)]
        if title.startswith("Calibración") and data.reliability_png:
            parts.append(_img(data.reliability_png, "Diagrama de fiabilidad"))
        if title.startswith("Cobertura") and data.coverage_png:
            parts.append(_img(data.coverage_png, "Curva cobertura/acierto"))
    parts.append("<h2>Recomendación</h2><ul>")
    parts += [f"<li>{_md_inline(line)}</li>" for line in data.recommendation]
    parts.append("</ul>")
    return (
        '<!doctype html><html lang="es"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        f"<title>{html.escape(data.title)}</title><style>{CSS}</style></head>"
        f"<body>{''.join(parts)}</body></html>"
    )


def _img(png: bytes, alt: str) -> str:
    encoded = base64.b64encode(png).decode("ascii")
    return f'<img alt="{html.escape(alt)}" src="data:image/png;base64,{encoded}">'


def write_report(
    records: Sequence[Record],
    out_dir: Path,
    *,
    report_date: date,
    split: str,
    policy_version: str,
    failures: int = 0,
) -> tuple[Path, Path]:
    data = build_report(
        records,
        report_date=report_date,
        split=split,
        policy_version=policy_version,
        failures=failures,
    )
    out_dir.mkdir(parents=True, exist_ok=True)
    md_path = out_dir / f"{report_date.isoformat()}.md"
    html_path = out_dir / f"{report_date.isoformat()}.html"
    md_path.write_text(render_markdown(data), encoding="utf-8")
    html_path.write_text(render_html(data), encoding="utf-8")
    return md_path, html_path
