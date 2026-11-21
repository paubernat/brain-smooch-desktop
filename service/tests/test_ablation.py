"""Ablación sin red: FakeJudge sobre una base de datos temporal."""

from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

import pytest
import respx

from app import db
from app.config import Settings
from app.judges.base import JudgeError, RetryableJudgeError
from app.models import ChannelInfo, FichaIn, FichaView, Label, Verdict
from app.policy import Policy, load_policy, model_hash, parse_policy
from app.pricing import ModelPrice, Pricing
from eval import ablation
from eval.configs import config_levels
from eval.report import write_report
from tests.helpers import POLICY_FIXTURE, ficha_payload

# (video_id, channel_id, label, labeled_at, split, is_short, transcript_status)
VIDEOS = [
    ("vid-a1", "UC_A", Label.LIBRE, "2026-01-01T00:00:01+00:00", "test", True, "ok"),
    ("vid-a2", "UC_A", Label.LIBRE, "2026-01-01T00:00:02+00:00", "test", False, "none"),
    ("vid-a3", "UC_A", Label.NO, "2026-01-01T00:00:03+00:00", "test", False, "ok"),
    ("vid-b1", "UC_B", Label.NO, "2026-01-01T00:00:04+00:00", "test", True, "none"),
    ("vid-b2", "UC_B", Label.LIMITADO, "2026-01-01T00:00:05+00:00", "test", False, "ok"),
    ("vid-dev", "UC_B", Label.LIMITADO, "2026-01-01T00:00:06+00:00", "dev", False, "ok"),
]
TRUTH = {v[0]: v[2] for v in VIDEOS}


@dataclass
class FakeJudge:
    """Acierta si ve el canal (L2); si no, dice LIBRE (para generar falsos LIBRE)."""

    name: str = "fake/model"
    provider: str = "fake"
    model: str = "m"
    supports_images: bool = True
    calls: list[FichaView] = field(default_factory=list)

    async def decide(self, ficha: FichaView, policy: Policy) -> Verdict:
        self.calls.append(ficha)
        assert ficha.video is not None
        video_id = ficha.video.title  # el título de las fichas de prueba es el video_id
        label = TRUTH[video_id] if ficha.channel is not None else Label.LIBRE
        probs = {lb: (0.8 if lb == label else 0.1) for lb in Label}
        return Verdict(
            label=label, probs=probs, confidence=0.8, input_tokens=1000,
            cost_usd=0.001, latency_ms=50,
        )  # fmt: skip


@dataclass
class FlakyJudge(FakeJudge):
    failures: int = 2
    error: type[JudgeError] = RetryableJudgeError

    async def decide(self, ficha: FichaView, policy: Policy) -> Verdict:
        if self.failures > 0:
            self.failures -= 1
            raise self.error("HTTP 429")
        return await super().decide(ficha, policy)


@pytest.fixture
def policy() -> Policy:
    return load_policy(POLICY_FIXTURE)


@pytest.fixture
def seeded(database: db.Database) -> db.Database:
    with database.connect() as conn:
        for channel in ("UC_A", "UC_B"):
            db.upsert_channel(conn, ChannelInfo(channel_id=channel, description=f"{channel} desc"))
        for video_id, channel, label, labeled_at, split, is_short, status in VIDEOS:
            payload = ficha_payload(
                video_id, channel_id=channel, transcript_status=status, is_short=is_short
            )
            payload["metadata"]["title"] = video_id
            db.upsert_video(
                conn,
                FichaIn.model_validate(payload),
                description_clean="clean",
                transcript_excerpt="[00:00] text" if status == "ok" else "",
                l2_status="ok",
                l4_status="none",
            )
            db.upsert_label(conn, video_id, label, None)
            conn.execute(
                "UPDATE labels SET labeled_at = ?, split = ? WHERE video_id = ?",
                (labeled_at, split, video_id),
            )
    return database


async def no_sleep(_: float) -> None:
    return None


def test_configs_and_l0_suffix() -> None:
    assert {lv.value for lv in config_levels("E")} == {"L1", "L2", "L3", "L4"}
    assert {lv.value for lv in config_levels("A+L0")} == {"L0", "L1"}
    with pytest.raises(ValueError):
        config_levels("Z")


def test_l0_uses_only_earlier_labels_of_same_channel(seeded: db.Database) -> None:
    videos = {v.ficha.video_id: v for v in ablation.load_dataset(seeded, None)}
    view = ablation.build_view(seeded, videos["vid-a2"], "A+L0")
    assert view.channel_history == {Label.NO: 0, Label.LIMITADO: 0, Label.LIBRE: 1}
    first = ablation.build_view(seeded, videos["vid-a1"], "A+L0")
    assert first.channel_history == {Label.NO: 0, Label.LIMITADO: 0, Label.LIBRE: 0}
    assert ablation.build_view(seeded, videos["vid-a2"], "A").channel_history is None


async def test_end_to_end_ablation_and_report(
    seeded: db.Database, policy: Policy, tmp_path: Path
) -> None:
    judge = FakeJudge()
    videos = ablation.load_dataset(seeded, "test")
    assert len(videos) == 5
    jobs = ablation.build_jobs(seeded, videos, [judge], ["A", "B"])
    result = await ablation.run_jobs(seeded, jobs, policy, concurrency=2, sleep=no_sleep)

    assert result.calls == 10 and not result.failures
    by_config = {c: [r for r in result.records if r.config == c] for c in ("A", "B")}
    assert all(r.correct for r in by_config["B"])  # con L2 acierta
    assert sum(r.pred == Label.LIBRE for r in by_config["A"]) == 5
    assert sum(v.channel is None for v in judge.calls) == 5  # A no ve el canal

    md_path, html_path = write_report(
        result.records, tmp_path, report_date=date(2026, 11, 21), split="test",
        policy_version=policy.policy_version,
    )  # fmt: skip
    md = md_path.read_text(encoding="utf-8")
    assert md_path.name == "2026-11-21.md"
    assert "## Recomendación" in md and "`fake/model`" in md and "config `B`" in md
    assert "falso LIBRE" in md
    html = html_path.read_text(encoding="utf-8")
    assert html.count("data:image/png;base64,") == 2
    assert "<h2>Recomendación</h2>" in html


async def test_verdict_cache_avoids_repeated_calls(seeded: db.Database, policy: Policy) -> None:
    judge = FakeJudge()
    videos = ablation.load_dataset(seeded, "test")
    jobs = ablation.build_jobs(seeded, videos, [judge], ["C"])
    await ablation.run_jobs(seeded, jobs, policy, sleep=no_sleep)
    assert len(judge.calls) == 5

    again = await ablation.run_jobs(seeded, jobs, policy, sleep=no_sleep)
    assert len(judge.calls) == 5 and again.calls == 0
    assert all(r.cached for r in again.records) and len(again.records) == 5

    text = (POLICY_FIXTURE).read_text(encoding="utf-8")
    assert parse_policy(text + "\n# comentario\n").policy_version == policy.policy_version
    question = policy.question.model_copy(update={"instructions": "Otras instrucciones."})
    changed = policy.model_copy(update={"question": question})
    changed.sha256 = model_hash(changed)
    await ablation.run_jobs(seeded, jobs, changed, sleep=no_sleep)
    assert len(judge.calls) == 10  # nueva policy_version → nuevas llamadas
    with seeded.connect() as conn:
        (count,) = conn.execute("SELECT COUNT(*) FROM verdicts WHERE judge = 'fake'").fetchone()
    assert count == 10


async def test_dry_run_estimate_counts_calls_and_cost(seeded: db.Database, policy: Policy) -> None:
    pricing = Pricing(models={"fake/model": ModelPrice(input_per_mtok=1.0, image_tokens=100)})
    judge = FakeJudge()
    videos = ablation.load_dataset(seeded, "test")
    jobs = ablation.build_jobs(seeded, videos, [judge], ["A", "E"])
    rows = {r.config: r for r in ablation.estimate(seeded, jobs, policy, pricing)}
    assert rows["A"].calls == 5 and rows["A"].cached == 0
    expected_a = sum(
        -(-(len(j.view.to_state_json()) + policy.prompt_chars()) // 4)
        for j in jobs
        if j.config == "A"
    )
    assert rows["A"].est_tokens == expected_a
    assert rows["A"].est_cost_usd == pytest.approx(expected_a / 1e6)
    assert not judge.calls  # el dry-run no llama al juez

    await ablation.run_jobs(seeded, [j for j in jobs if j.config == "A"], policy, sleep=no_sleep)
    rows = {r.config: r for r in ablation.estimate(seeded, jobs, policy, pricing)}
    assert rows["A"].calls == 0 and rows["A"].cached == 5 and rows["A"].est_cost_usd == 0
    assert "TOTAL: 5 calls, 5 cached" in ablation.format_estimate(list(rows.values()))


@respx.mock
async def test_cli_dry_run_makes_no_requests(
    seeded: db.Database, settings: Settings, capsys: pytest.CaptureFixture[str]
) -> None:
    args = ablation.parse_args(
        ["--models", "liquid/d1.2-ultra,openai/decisions", "--configs", "A,E,D+L0", "--dry-run"]
    )
    assert await ablation.run(args, settings) == 0
    out = capsys.readouterr().out
    assert "5 labeled videos" in out
    assert "TOTAL: 30 calls, 0 cached" in out
    assert not respx.calls


async def test_retries_with_exponential_backoff(policy: Policy) -> None:
    delays: list[float] = []

    async def fake_sleep(delay: float) -> None:
        delays.append(delay)

    judge = FlakyJudge(failures=2)
    view = FichaView.model_validate({"video": {"title": "vid-a1"}, "channel": {}})
    verdict = await ablation.call_with_retries(judge, view, policy, sleep=fake_sleep)
    assert verdict.label == Label.LIBRE
    assert len(delays) == 2
    assert 1.0 <= delays[0] <= 1.1 and 2.0 <= delays[1] <= 2.2

    with pytest.raises(RetryableJudgeError):
        await ablation.call_with_retries(
            FlakyJudge(failures=10), view, policy, max_retries=3, sleep=fake_sleep
        )


async def test_non_retryable_errors_are_reported_as_failures(
    seeded: db.Database, policy: Policy
) -> None:
    judge = FlakyJudge(failures=100, error=JudgeError)
    videos = ablation.load_dataset(seeded, "test")[:2]
    jobs = ablation.build_jobs(seeded, videos, [judge], ["A"])
    result = await ablation.run_jobs(seeded, jobs, policy, sleep=no_sleep)
    assert len(result.failures) == 2 and not result.records
    assert judge.failures == 98  # sin reintentos para 4xx
