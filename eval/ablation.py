"""Ablación: modelos × configuraciones de niveles sobre el conjunto etiquetado (PLAN §10).

Uso (desde service/):
    uv run python -m eval.ablation --models liquid/d1.2-ultra,openai/decisions \\
        --configs A,B,C,D,E,F --split test [--dry-run] [--concurrency 4]

Configuraciones A–F (§10.1). Añadir `+L0` a una configuración (p. ej. `D+L0`) incluye el
historial del canal con validación temporal: solo cuentan etiquetas del mismo canal con
`labeled_at` anterior al del vídeo.

Caché: tabla `verdicts`, clave (video_id, judge, model, config, policy_version). Una llamada
pagada no se repite mientras la política no cambie.
"""

import argparse
import asyncio
import logging
import random
import sys
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

import httpx

from app import db
from app.config import REPO_ROOT, Settings, get_settings
from app.judges.base import Judge, JudgeError, RetryableJudgeError
from app.judges.registry import JUDGES, create_judge
from app.models import FichaOut, FichaView, InfoLevel, Label, Split, Verdict, build_ficha_view
from app.policy import Policy, load_policy
from app.pricing import Pricing, load_pricing
from eval.configs import CONFIG_LEVELS, config_levels
from eval.metrics import Record

log = logging.getLogger("eval.ablation")

REPORTS_DIR = REPO_ROOT / "eval" / "reports"
Sleep = Callable[[float], Awaitable[None]]


def parse_list(text: str) -> list[str]:
    return [item.strip() for item in text.split(",") if item.strip()]


# --- dataset y trabajos ------------------------------------------------------------------------


@dataclass(frozen=True)
class LabeledVideo:
    ficha: FichaOut
    truth: Label
    labeled_at: str


@dataclass
class Job:
    video: LabeledVideo
    judge: Judge
    config: str
    view: FichaView

    @property
    def video_id(self) -> str:
        return self.video.ficha.video_id


def load_dataset(
    database: db.Database, split: Split | None, *, include_seen: bool = False
) -> list[LabeledVideo]:
    """Vídeos etiquetados. Por defecto sin los etiquetados después de ver el veredicto del
    juez en directo (`verdict_seen_before_label`): esa etiqueta ya no mide al modelo."""
    videos: list[LabeledVideo] = []
    with database.connect() as conn:
        for video_id in db.list_labeled_video_ids(conn, split, include_seen=include_seen):
            ficha = db.load_ficha(conn, video_id)
            if ficha is None or ficha.label is None:
                continue
            videos.append(LabeledVideo(ficha, ficha.label.label, ficha.label.labeled_at))
    return videos


def build_view(database: db.Database, video: LabeledVideo, config: str) -> FichaView:
    levels = config_levels(config)
    history = None
    if InfoLevel.L0 in levels:
        with database.connect() as conn:
            history = db.channel_history_before(
                conn, video.ficha.metadata.channel_id, video.labeled_at, video.ficha.video_id
            )
    return build_ficha_view(video.ficha, levels, channel_history=history)


def build_jobs(
    database: db.Database,
    videos: Sequence[LabeledVideo],
    judges: Sequence[Judge],
    configs: Sequence[str],
) -> list[Job]:
    jobs: list[Job] = []
    for judge in judges:
        for config in configs:
            for video in videos:
                view = judge_view(build_view(database, video, config), judge)
                jobs.append(Job(video, judge, config, view))
    return jobs


def find_cached(
    database: db.Database, video_id: str, judge: Judge, config: str, policy: Policy
) -> Verdict | None:
    """Caché de veredictos: (video_id, judge, model, config, policy_version)."""
    with database.connect() as conn:
        return db.find_verdict(
            conn,
            video_id=video_id,
            judge=judge.provider,
            model=judge.model,
            config=config,
            policy_version=policy.policy_version,
        )


def store_cached(
    database: db.Database,
    video_id: str,
    judge: Judge,
    config: str,
    policy: Policy,
    verdict: Verdict,
) -> None:
    with database.connect() as conn:
        db.insert_verdict(
            conn,
            video_id=video_id,
            judge=judge.provider,
            model=judge.model,
            config=config,
            policy_version=policy.policy_version,
            verdict=verdict,
        )


def judge_view(view: FichaView, judge: Judge) -> FichaView:
    """Sin imágenes para los jueces que no las admiten."""
    if not judge.supports_images:
        view.images = None
    return view


def cached_verdict(database: db.Database, job: Job, policy: Policy) -> Verdict | None:
    return find_cached(database, job.video_id, job.judge, job.config, policy)


def store_verdict(database: db.Database, job: Job, policy: Policy, verdict: Verdict) -> None:
    store_cached(database, job.video_id, job.judge, job.config, policy, verdict)


# --- dry-run -----------------------------------------------------------------------------------


@dataclass
class Estimate:
    model_key: str
    config: str
    calls: int = 0  # llamadas nuevas (no cacheadas)
    cached: int = 0
    est_tokens: int = 0
    est_cost_usd: float = 0.0


def estimate_job_tokens(job: Job, policy: Policy, pricing: Pricing) -> int:
    chars = len(job.view.to_state_json()) + policy.prompt_chars()
    images = len(job.view.images or []) if job.judge.supports_images else 0
    return pricing.estimate_tokens(job.judge.name, chars, images)


def estimate(
    database: db.Database, jobs: Sequence[Job], policy: Policy, pricing: Pricing
) -> list[Estimate]:
    rows: dict[tuple[str, str], Estimate] = {}
    for job in jobs:
        key = (job.judge.name, job.config)
        row = rows.setdefault(key, Estimate(*key))
        if cached_verdict(database, job, policy) is not None:
            row.cached += 1
            continue
        tokens = estimate_job_tokens(job, policy, pricing)
        row.calls += 1
        row.est_tokens += tokens
        row.est_cost_usd += pricing.cost(job.judge.name, tokens)
    return list(rows.values())


def format_estimate(rows: Sequence[Estimate]) -> str:
    lines = [
        f"{'model':<22} {'config':<7} {'calls':>6} {'cached':>7} {'tokens':>10} {'cost $':>10}"
    ]
    for r in rows:
        lines.append(
            f"{r.model_key:<22} {r.config:<7} {r.calls:>6} {r.cached:>7} "
            f"{r.est_tokens:>10} {r.est_cost_usd:>10.4f}"
        )
    calls = sum(r.calls for r in rows)
    cost = sum(r.est_cost_usd for r in rows)
    lines.append(f"TOTAL: {calls} calls, {sum(r.cached for r in rows)} cached, ~${cost:.4f}")
    return "\n".join(lines)


# --- ejecución ---------------------------------------------------------------------------------


async def call_with_retries(
    judge: Judge,
    view: FichaView,
    policy: Policy,
    *,
    max_retries: int = 5,
    base_delay: float = 1.0,
    max_delay: float = 60.0,
    sleep: Sleep = asyncio.sleep,
) -> Verdict:
    """Reintenta 429/5xx/transporte con backoff exponencial (respeta `Retry-After`)."""
    attempt = 0
    while True:
        try:
            return await judge.decide(view, policy)
        except RetryableJudgeError as exc:
            if attempt >= max_retries:
                raise
            delay = exc.retry_after
            if delay is None:
                delay = min(max_delay, base_delay * 2**attempt) * (1 + random.random() * 0.1)
            log.info("%s: retry %d in %.1fs (%s)", judge.name, attempt + 1, delay, exc)
            await sleep(delay)
            attempt += 1


@dataclass
class Failure:
    video_id: str
    model_key: str
    config: str
    error: str


@dataclass
class RunResult:
    records: list[Record] = field(default_factory=list)
    failures: list[Failure] = field(default_factory=list)
    calls: int = 0


def to_record(job: Job, verdict: Verdict, cached: bool) -> Record:
    meta = job.video.ficha.metadata
    return Record(
        video_id=job.video_id,
        model_key=job.judge.name,
        config=job.config,
        truth=job.video.truth,
        pred=verdict.label,
        confidence=verdict.confidence,
        probs=dict(verdict.probs),
        cost_usd=verdict.cost_usd,
        latency_ms=verdict.latency_ms,
        input_tokens=verdict.input_tokens,
        is_short=meta.is_short,
        has_transcript=job.video.ficha.transcript.status == "ok",
        ai_labeled=bool(meta.ai_disclosure and meta.ai_disclosure.labeled),
        is_live=bool(meta.live and meta.live.any_live),
        title=meta.title,
        cached=cached,
        refused=bool(verdict.aux.get("refused")),
    )


async def run_jobs(
    database: db.Database,
    jobs: Sequence[Job],
    policy: Policy,
    *,
    concurrency: int = 4,
    max_retries: int = 5,
    base_delay: float = 1.0,
    sleep: Sleep = asyncio.sleep,
) -> RunResult:
    result = RunResult()
    semaphore = asyncio.Semaphore(max(1, concurrency))

    async def run_one(job: Job) -> None:
        cached = cached_verdict(database, job, policy)
        if cached is not None:
            result.records.append(to_record(job, cached, cached=True))
            return
        async with semaphore:
            try:
                verdict = await call_with_retries(
                    job.judge,
                    job.view,
                    policy,
                    max_retries=max_retries,
                    base_delay=base_delay,
                    sleep=sleep,
                )
            except JudgeError as exc:
                log.warning("%s %s %s failed: %s", job.judge.name, job.config, job.video_id, exc)
                result.failures.append(Failure(job.video_id, job.judge.name, job.config, str(exc)))
                return
        result.calls += 1
        store_verdict(database, job, policy, verdict)
        result.records.append(to_record(job, verdict, cached=False))

    await asyncio.gather(*(run_one(job) for job in jobs))
    return result


# --- CLI ---------------------------------------------------------------------------------------


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="python -m eval.ablation", description=__doc__)
    parser.add_argument("--models", default="liquid/d1.2-ultra,liquid/d1.2,openai/decisions",
                        help=f"comma-separated: {', '.join(JUDGES)}")  # fmt: skip
    parser.add_argument("--configs", default=",".join(CONFIG_LEVELS),
                        help="comma-separated A..F, optionally with +L0 (e.g. D+L0)")  # fmt: skip
    parser.add_argument("--split", choices=["dev", "test"], default="test")
    parser.add_argument("--dry-run", action="store_true", help="show calls and estimated cost")
    parser.add_argument("--concurrency", type=int, default=4)
    parser.add_argument("--max-retries", type=int, default=5)
    parser.add_argument("--db", type=Path, default=None, help="SQLite path (default: data/)")
    parser.add_argument("--out", type=Path, default=REPORTS_DIR, help="reports directory")
    parser.add_argument("--no-report", action="store_true")
    parser.add_argument("--include-seen", action="store_true",
                        help="include labels given after seeing the live verdict")  # fmt: skip
    args = parser.parse_args(argv)
    args.models = parse_list(args.models)
    args.configs = parse_list(args.configs)
    for config in args.configs:
        config_levels(config)  # valida
    unknown = [m for m in args.models if m not in JUDGES]
    if unknown:
        parser.error(f"unknown models: {', '.join(unknown)}")
    return args


async def run(args: argparse.Namespace, settings: Settings) -> int:
    from eval.report import write_report  # import diferido: matplotlib solo si hace falta

    db_path = args.db or settings.db_path
    if not db_path.exists():
        print(f"Database not found: {db_path}", file=sys.stderr)
        return 1
    database = db.Database(db_path)
    database.init()
    policy = load_policy(settings.policy_path)
    pricing = load_pricing(settings.pricing_path)
    videos = load_dataset(database, args.split, include_seen=args.include_seen)
    print(f"{len(videos)} labeled videos in split {args.split!r}; policy {policy.policy_version}")
    with database.connect() as conn:
        seen = db.count_seen_labels(conn, args.split)
    if seen:
        action = "included (--include-seen)" if args.include_seen else "excluded"
        print(f"{seen} labels given after seeing the live verdict: {action}")

    async with httpx.AsyncClient(timeout=settings.judge_timeout_s) as client:
        judges = [
            create_judge(key, client, settings, pricing, require_key=not args.dry_run)
            for key in args.models
        ]
        jobs = build_jobs(database, videos, judges, args.configs)
        print(format_estimate(estimate(database, jobs, policy, pricing)))
        if args.dry_run:
            return 0
        result = await run_jobs(
            database, jobs, policy, concurrency=args.concurrency, max_retries=args.max_retries
        )

    print(
        f"{result.calls} new calls, {len(result.records)} verdicts, {len(result.failures)} failed"
    )
    for failure in result.failures[:20]:
        print(f"  FAILED {failure.model_key} {failure.config} {failure.video_id}: {failure.error}")
    if not args.no_report and result.records:
        md_path, html_path = write_report(
            result.records,
            args.out,
            report_date=date.today(),
            split=args.split,
            policy_version=policy.policy_version,
            failures=len(result.failures),
        )
        print(f"Report: {md_path}\n        {html_path}")
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    return asyncio.run(run(parse_args(argv), get_settings()))


if __name__ == "__main__":
    raise SystemExit(main())
