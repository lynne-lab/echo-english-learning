from __future__ import annotations

from datetime import datetime, time, timedelta, timezone
from typing import Any

from fsrs import Card, Rating, Scheduler, State

# 关闭 learning steps：新词评分后直接进入日级间隔，适合每日一次的复习流程。
scheduler = Scheduler(
    learning_steps=(),
    relearning_steps=(),
    enable_fuzzing=False,
    desired_retention=0.9,
)

RATING_NAMES = {1: "再来一次", 2: "有点难", 3: "记得", 4: "很简单"}
STATE_NAMES = {1: "learning", 2: "review", 3: "relearning"}


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value)


def state_name(last_review: str | None, state: int) -> str:
    if last_review is None:
        return "new"
    return STATE_NAMES.get(int(state), "review")


def _study_day(now: datetime):
    local_now = now.astimezone()
    if local_now.hour < 4:
        return local_now.date() - timedelta(days=1)
    return local_now.date()


def normalize_due(now: datetime, due: datetime) -> datetime:
    """Turn FSRS day intervals into a local 04:00 due time.

    This makes a card due "tomorrow" available all day tomorrow instead of at
    the exact minute it was reviewed. Intervals below a day keep their exact time.
    """
    delta_days = (due - now).total_seconds() / 86400
    if delta_days < 0.99:
        return due
    interval_days = max(1, round(delta_days))
    local_now = now.astimezone()
    due_day = _study_day(now) + timedelta(days=interval_days)
    local_due = datetime.combine(due_day, time(4, 0), tzinfo=local_now.tzinfo)
    return local_due.astimezone(timezone.utc)


def format_interval(now: datetime, due: datetime) -> str:
    seconds = max((due - now).total_seconds(), 0)
    if seconds < 3600:
        return f"{max(1, round(seconds / 60))} 分钟"
    if seconds < 86400:
        return f"{max(1, round(seconds / 3600))} 小时"
    days = seconds / 86400
    if days < 30:
        return f"{max(1, round(days))} 天"
    if days < 365:
        return f"{days / 30:.1f} 个月"
    return f"{days / 365:.1f} 年"


def _card_from_row(row: Any, due_override: datetime | None = None) -> Card:
    state = State(int(row["state"]))
    return Card(
        card_id=int(row["card_id"]),
        state=state,
        step=row["step"],
        stability=row["stability"],
        difficulty=row["difficulty"],
        due=due_override or parse_dt(row["due"]),
        last_review=parse_dt(row["last_review"]),
    )


def previews(row: Any, now: datetime | None = None) -> list[dict[str, Any]]:
    now = now or now_utc()
    card = _card_from_row(row)
    result: list[dict[str, Any]] = []
    for rating in (1, 2, 3, 4):
        next_card, _log = scheduler.review_card(
            card, Rating(rating), review_datetime=now
        )
        due = normalize_due(now, next_card.due)
        result.append(
            {
                "rating": rating,
                "label": RATING_NAMES[rating],
                "interval": format_interval(now, due),
                "due": due.isoformat(),
            }
        )
    return result


def apply_review(
    row: Any,
    rating: int,
    duration_ms: int | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    now = now or now_utc()
    card = _card_from_row(row)
    next_card, _log = scheduler.review_card(
        card,
        Rating(int(rating)),
        review_datetime=now,
        review_duration=duration_ms,
    )
    due = normalize_due(now, next_card.due)
    interval_days = max(0.0, (due - now).total_seconds() / 86400)
    return {
        "state": int(next_card.state),
        "step": next_card.step,
        "stability": next_card.stability,
        "difficulty": next_card.difficulty,
        "due": due,
        "last_review": now,
        "interval_days": interval_days,
        "interval_label": format_interval(now, due),
        "state_name": state_name(now.isoformat(), int(next_card.state)),
    }


def next_due_label(due: str | None) -> str | None:
    if not due:
        return None
    parsed = parse_dt(due)
    if not parsed:
        return None
    return format_interval(now_utc(), parsed)
