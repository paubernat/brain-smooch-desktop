import math

import pytest

from app.models import Label
from eval.metrics import (
    CoveragePoint,
    Record,
    accuracy,
    best_summary,
    breakdowns,
    confusion,
    coverage_curve,
    expected_calibration_error,
    false_libre_rate,
    false_no_rate,
    macro_f1,
    percentile,
    recommend_threshold,
    reliability_bins,
    summarize,
)

NO, LIM, LIB = Label.NO, Label.LIMITADO, Label.LIBRE
TRUE = [NO, NO, LIM, LIM, LIB, LIB]
PRED = [NO, LIB, LIM, NO, LIB, NO]


def test_accuracy_and_error_rates() -> None:
    assert accuracy(TRUE, PRED) == pytest.approx(3 / 6)
    assert false_libre_rate(TRUE, PRED) == pytest.approx(1 / 4)  # 1 de 4 NO/LIMITADO → LIBRE
    assert false_no_rate(TRUE, PRED) == pytest.approx(1 / 2)  # 1 de 2 LIBRE → NO
    assert math.isnan(accuracy([], []))
    assert math.isnan(false_no_rate([NO], [NO]))


def test_macro_f1_matches_manual_computation() -> None:
    # NO: tp=1 fp=2 fn=1 → f1=0.4; LIM: tp=1 fp=0 fn=1 → 2/3; LIB: tp=1 fp=1 fn=1 → 0.5
    assert macro_f1(TRUE, PRED) == pytest.approx((0.4 + 2 / 3 + 0.5) / 3)
    assert macro_f1([LIB, LIB], [LIB, LIB]) == 1.0


def test_confusion_rows_truth_cols_pred() -> None:
    assert confusion(TRUE, PRED) == [[1, 0, 1], [1, 1, 0], [1, 0, 1]]
    assert confusion([], []) == [[0, 0, 0]] * 3


def test_ece_and_reliability_bins() -> None:
    conf = [0.95, 0.95, 0.55, 0.55]
    correct = [True, True, True, False]
    bins = reliability_bins(conf, correct, n_bins=10)
    assert [b.count for b in bins if b.count] == [2, 2]
    assert bins[9].accuracy == 1.0 and bins[5].accuracy == 0.5
    expected = 0.5 * abs(1.0 - 0.95) + 0.5 * abs(0.5 - 0.55)
    assert expected_calibration_error(conf, correct) == pytest.approx(expected)
    assert reliability_bins([1.0], [True], n_bins=10)[9].count == 1  # 1.0 cae en el último bin


def test_coverage_curve_and_threshold_recommendation() -> None:
    conf = [0.95, 0.9, 0.7, 0.6]
    truth = [LIB, NO, LIM, NO]
    pred = [LIB, NO, LIB, LIM]
    curve = coverage_curve(conf, truth, pred, thresholds=[0.0, 0.8, 0.99])
    assert [p.coverage for p in curve[:2]] == [1.0, 0.5]
    assert curve[0].accuracy == 0.5 and curve[1].accuracy == 1.0
    assert curve[0].false_libre_rate == pytest.approx(1 / 3)
    assert curve[2].coverage == 0.0 and math.isnan(curve[2].accuracy)
    best = recommend_threshold(curve, min_accuracy=0.9, max_false_libre=0.0)
    assert best is not None and best.threshold == 0.8
    assert recommend_threshold([CoveragePoint(0.5, 1.0, 0.5, 0.2)]) is None


def test_percentile() -> None:
    assert percentile([100, 200, 300, 400], 50) == 250
    assert math.isnan(percentile([], 95))


def rec(model: str, truth: Label, pred: Label, conf: float = 0.8, **kw: object) -> Record:
    return Record(
        video_id="v", model_key=model, config="A", truth=truth, pred=pred,
        confidence=conf, cost_usd=0.001, latency_ms=100, **kw,  # type: ignore[arg-type]
    )  # fmt: skip


def test_summarize_breakdowns_and_ranking() -> None:
    safe = [rec("safe", NO, NO), rec("safe", LIB, LIM, is_short=True), rec("safe", LIM, LIM)]
    risky = [rec("risky", NO, LIB), rec("risky", LIB, LIB, is_short=True), rec("risky", LIM, LIM)]
    s_safe, s_risky = summarize(safe), summarize(risky)
    assert s_safe.n == 3 and s_safe.cost_per_video == pytest.approx(0.001)
    assert s_safe.latency_p50 == 100
    assert s_risky.false_libre_rate == 0.5
    # Igual acierto, pero el que tiene falso LIBRE pierde.
    best = best_summary([s_risky, s_safe])
    assert best is not None and best.model_key == "safe"
    parts = breakdowns(safe)
    assert parts["shorts"].n == 1 and parts["videos"].n == 2
    assert parts["without_transcript"].n == 3 and parts["with_transcript"].n == 0
