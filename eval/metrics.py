"""Métricas de la ablación (PLAN §10.2). Funciones puras sobre listas de `Record`."""

import math
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field

import numpy as np
from sklearn.metrics import confusion_matrix, f1_score

from app.models import Label

LABELS: tuple[Label, ...] = (Label.NO, Label.LIMITADO, Label.LIBRE)
DEFAULT_THRESHOLDS: tuple[float, ...] = (0.0, 0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95)
NAN = float("nan")


@dataclass(frozen=True)
class Record:
    """Un veredicto de un modelo × configuración sobre un vídeo etiquetado."""

    video_id: str
    model_key: str
    config: str
    truth: Label
    pred: Label
    confidence: float
    probs: dict[Label, float] = field(default_factory=dict)
    cost_usd: float = 0.0
    latency_ms: int = 0
    input_tokens: int = 0
    is_short: bool = False
    has_transcript: bool = False
    ai_labeled: bool = False  # etiqueta de YouTube «Contenido alterado o sintético»
    is_live: bool = False  # directo en curso, programado o grabación de un directo
    title: str = ""
    cached: bool = False
    refused: bool = False

    @property
    def correct(self) -> bool:
        return self.truth == self.pred


@dataclass(frozen=True)
class ReliabilityBin:
    lower: float
    upper: float
    count: int
    mean_confidence: float
    accuracy: float


@dataclass(frozen=True)
class CoveragePoint:
    threshold: float
    coverage: float  # fracción decidida automáticamente (confianza ≥ umbral)
    accuracy: float  # acierto dentro de lo cubierto
    false_libre_rate: float  # falso LIBRE dentro de lo cubierto


@dataclass(frozen=True)
class Summary:
    model_key: str
    config: str
    n: int
    accuracy: float
    macro_f1: float
    false_libre_rate: float
    false_no_rate: float
    ece: float
    cost_per_video: float
    latency_p50: float
    latency_p95: float
    confusion: list[list[int]]
    reliability: list[ReliabilityBin]
    coverage: list[CoveragePoint]
    refusals: int = 0


# --- métricas de clasificación -----------------------------------------------------------------


def accuracy(y_true: Sequence[Label], y_pred: Sequence[Label]) -> float:
    if not y_true:
        return NAN
    return sum(t == p for t, p in zip(y_true, y_pred, strict=True)) / len(y_true)


def macro_f1(y_true: Sequence[Label], y_pred: Sequence[Label]) -> float:
    """Macro-F1 sobre las clases presentes en la verdad o en la predicción."""
    if not y_true:
        return NAN
    present = [label for label in LABELS if label in y_true or label in y_pred]
    return float(
        f1_score(
            [t.value for t in y_true],
            [p.value for p in y_pred],
            labels=[label.value for label in present],
            average="macro",
            zero_division=0,
        )
    )


def false_libre_rate(y_true: Sequence[Label], y_pred: Sequence[Label]) -> float:
    """Error grave: verdad NO o LIMITADO, predicho LIBRE."""
    pairs = [(t, p) for t, p in zip(y_true, y_pred, strict=True) if t != Label.LIBRE]
    if not pairs:
        return NAN
    return sum(p == Label.LIBRE for _, p in pairs) / len(pairs)


def false_no_rate(y_true: Sequence[Label], y_pred: Sequence[Label]) -> float:
    """Error molesto: verdad LIBRE, predicho NO."""
    pairs = [(t, p) for t, p in zip(y_true, y_pred, strict=True) if t == Label.LIBRE]
    if not pairs:
        return NAN
    return sum(p == Label.NO for _, p in pairs) / len(pairs)


def confusion(y_true: Sequence[Label], y_pred: Sequence[Label]) -> list[list[int]]:
    """Filas = verdad, columnas = predicción, en el orden de `LABELS`."""
    if not y_true:
        return [[0] * len(LABELS) for _ in LABELS]
    matrix = confusion_matrix(
        [t.value for t in y_true], [p.value for p in y_pred], labels=[lb.value for lb in LABELS]
    )
    return matrix.astype(int).tolist()


# --- calibración y cobertura -------------------------------------------------------------------


def reliability_bins(
    confidences: Sequence[float], correct: Sequence[bool], n_bins: int = 10
) -> list[ReliabilityBin]:
    """Bins de igual anchura en [0, 1]; el último incluye el 1.0."""
    bins: list[ReliabilityBin] = []
    for i in range(n_bins):
        lower, upper = i / n_bins, (i + 1) / n_bins
        idx = [
            j
            for j, c in enumerate(confidences)
            if lower <= c < upper or (i == n_bins - 1 and c == upper)
        ]
        if idx:
            mean_conf = sum(confidences[j] for j in idx) / len(idx)
            acc = sum(correct[j] for j in idx) / len(idx)
        else:
            mean_conf = acc = NAN
        bins.append(ReliabilityBin(lower, upper, len(idx), mean_conf, acc))
    return bins


def expected_calibration_error(
    confidences: Sequence[float], correct: Sequence[bool], n_bins: int = 10
) -> float:
    """ECE = Σ_b (n_b / N) · |acc_b − conf_b|."""
    total = len(confidences)
    if total == 0:
        return NAN
    return sum(
        b.count / total * abs(b.accuracy - b.mean_confidence)
        for b in reliability_bins(confidences, correct, n_bins)
        if b.count
    )


def coverage_curve(
    confidences: Sequence[float],
    y_true: Sequence[Label],
    y_pred: Sequence[Label],
    thresholds: Iterable[float] = DEFAULT_THRESHOLDS,
) -> list[CoveragePoint]:
    points: list[CoveragePoint] = []
    total = len(confidences)
    for threshold in thresholds:
        idx = [i for i, c in enumerate(confidences) if c >= threshold]
        truth = [y_true[i] for i in idx]
        pred = [y_pred[i] for i in idx]
        points.append(
            CoveragePoint(
                threshold=threshold,
                coverage=len(idx) / total if total else NAN,
                accuracy=accuracy(truth, pred),
                false_libre_rate=false_libre_rate(truth, pred),
            )
        )
    return points


def recommend_threshold(
    curve: Sequence[CoveragePoint], min_accuracy: float = 0.9, max_false_libre: float = 0.0
) -> CoveragePoint | None:
    """Umbral más bajo (máxima cobertura) que cumple acierto mínimo y falso LIBRE máximo."""
    for point in sorted(curve, key=lambda p: p.threshold):
        if not point.coverage or math.isnan(point.accuracy):
            continue
        fl = 0.0 if math.isnan(point.false_libre_rate) else point.false_libre_rate
        if point.accuracy >= min_accuracy and fl <= max_false_libre:
            return point
    return None


# --- coste y latencia --------------------------------------------------------------------------


def percentile(values: Sequence[float], q: float) -> float:
    if not values:
        return NAN
    return float(np.percentile(np.asarray(values, dtype=float), q))


def mean(values: Sequence[float]) -> float:
    return sum(values) / len(values) if values else NAN


# --- agregación --------------------------------------------------------------------------------


def summarize(
    records: Sequence[Record], thresholds: Iterable[float] = DEFAULT_THRESHOLDS, n_bins: int = 10
) -> Summary:
    y_true = [r.truth for r in records]
    y_pred = [r.pred for r in records]
    conf = [r.confidence for r in records]
    correct = [r.correct for r in records]
    # Los veredictos cacheados conservan la latencia de su llamada original.
    latencies = [float(r.latency_ms) for r in records]
    first = records[0] if records else None
    return Summary(
        model_key=first.model_key if first else "",
        config=first.config if first else "",
        n=len(records),
        accuracy=accuracy(y_true, y_pred),
        macro_f1=macro_f1(y_true, y_pred),
        false_libre_rate=false_libre_rate(y_true, y_pred),
        false_no_rate=false_no_rate(y_true, y_pred),
        ece=expected_calibration_error(conf, correct, n_bins),
        cost_per_video=mean([r.cost_usd for r in records]),
        latency_p50=percentile(latencies, 50),
        latency_p95=percentile(latencies, 95),
        confusion=confusion(y_true, y_pred),
        reliability=reliability_bins(conf, correct, n_bins),
        coverage=coverage_curve(conf, y_true, y_pred, thresholds),
        refusals=sum(r.refused for r in records),
    )


SUBSETS: dict[str, Callable[[Record], bool]] = {
    "shorts": lambda r: r.is_short,
    "videos": lambda r: not r.is_short,
    "with_transcript": lambda r: r.has_transcript,
    "without_transcript": lambda r: not r.has_transcript,
    "ai_labeled": lambda r: r.ai_labeled,
    "not_ai_labeled": lambda r: not r.ai_labeled,
    "live": lambda r: r.is_live,
    "not_live": lambda r: not r.is_live,
}


def breakdowns(records: Sequence[Record]) -> dict[str, Summary]:
    """Desglose Shorts vs. vídeos, con/sin transcripción, con/sin etiqueta IA y directos.

    Las reglas fijas (`block_ai_labeled`, `block_live`) no se aplican en la ablación: estos
    desgloses miden qué hace el modelo con esos vídeos sin la regla.
    """
    return {name: summarize([r for r in records if keep(r)]) for name, keep in SUBSETS.items()}


def group_records(records: Iterable[Record]) -> dict[tuple[str, str], list[Record]]:
    groups: dict[tuple[str, str], list[Record]] = {}
    for record in records:
        groups.setdefault((record.model_key, record.config), []).append(record)
    return groups


def _nan_to(value: float, default: float) -> float:
    return default if math.isnan(value) else value


def rank_key(summary: Summary) -> tuple[float, float, float]:
    """Orden de recomendación: menor falso LIBRE, luego mayor macro-F1, luego menor coste."""
    return (
        _nan_to(summary.false_libre_rate, 1.0),
        -_nan_to(summary.macro_f1, 0.0),
        _nan_to(summary.cost_per_video, math.inf),
    )


def best_summary(summaries: Iterable[Summary]) -> Summary | None:
    candidates = [s for s in summaries if s.n]
    return min(candidates, key=rank_key) if candidates else None
