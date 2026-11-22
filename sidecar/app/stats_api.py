from __future__ import annotations

import json
from datetime import date, datetime, time as dt_time, timedelta, timezone
from typing import Any

from fastapi import APIRouter

from . import db

router = APIRouter(prefix="/api/stats", tags=["stats"])

WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]


def _local_tz():
    return datetime.now().astimezone().tzinfo


def _local_today() -> date:
    return datetime.now().astimezone().date()


def _day_start_utc(day: date) -> str:
    local = datetime.combine(day, dt_time(0, 0), tzinfo=_local_tz())
    return local.astimezone(timezone.utc).isoformat()


def _local_date(iso: str) -> date:
    return datetime.fromisoformat(iso).astimezone().date()


@router.get("")
def get_stats() -> dict[str, Any]:
    today = _local_today()
    tz = _local_tz()
    year_start = today - timedelta(days=370)
    range_start_iso = _day_start_utc(year_start)
    today_start = _day_start_utc(today)
    tomorrow_start = _day_start_utc(today + timedelta(days=1))
    thirty_days_ago = today - timedelta(days=29)
    thirty_start_iso = _day_start_utc(thirty_days_ago)
    heatmap_start = today - timedelta(days=today.weekday()) - timedelta(weeks=15)

    with db.get_conn() as conn:
        review_rows = conn.execute(
            "SELECT rating, reviewed_at FROM review_logs WHERE reviewed_at >= ?",
            (range_start_iso,),
        ).fetchall()
        attempt_rows = conn.execute(
            """
            SELECT accuracy, word_total, scored_total, word_correct, errors_json, created_at
            FROM dictation_attempts WHERE created_at >= ?
            """,
            (range_start_iso,),
        ).fetchall()
        recent_sessions = conn.execute(
            """
            SELECT id, material_title, mode, item_count, completed_count, accuracy, created_at
            FROM dictation_sessions ORDER BY created_at DESC LIMIT 5
            """
        ).fetchall()
        state_row = conn.execute(
            """
            SELECT
                COALESCE(SUM(CASE WHEN last_review IS NULL THEN 1 ELSE 0 END), 0) AS new,
                COALESCE(SUM(CASE WHEN last_review IS NOT NULL AND state = 1 THEN 1 ELSE 0 END), 0) AS learning,
                COALESCE(SUM(CASE WHEN last_review IS NOT NULL AND state = 2 THEN 1 ELSE 0 END), 0) AS review,
                COALESCE(SUM(CASE WHEN last_review IS NOT NULL AND state = 3 THEN 1 ELSE 0 END), 0) AS relearning
            FROM review_cards
            """
        ).fetchone()
        totals = {
            "words": int(conn.execute("SELECT COUNT(*) FROM words").fetchone()[0]),
            "materials": int(conn.execute("SELECT COUNT(*) FROM materials").fetchone()[0]),
            "sentences": int(conn.execute("SELECT COUNT(*) FROM sentences").fetchone()[0]),
            "occurrences": int(
                conn.execute("SELECT COUNT(*) FROM word_occurrences").fetchone()[0]
            ),
            "dictation_sessions": int(
                conn.execute("SELECT COUNT(*) FROM dictation_sessions").fetchone()[0]
            ),
        }
        forecast_rows = conn.execute(
            """
            SELECT due FROM review_cards
            WHERE last_review IS NOT NULL AND due < ?
            """,
            (_day_start_utc(today + timedelta(days=7)),),
        ).fetchall()

    review_dates: list[tuple[date, int]] = [
        (_local_date(row["reviewed_at"]), int(row["rating"])) for row in review_rows
    ]
    attempt_dates: list[tuple[date, Any]] = [
        (_local_date(row["created_at"]), row) for row in attempt_rows
    ]

    review_day_counts: dict[date, int] = {}
    for day, _rating in review_dates:
        review_day_counts[day] = review_day_counts.get(day, 0) + 1
    attempt_day_counts: dict[date, int] = {}
    for day, _row in attempt_dates:
        attempt_day_counts[day] = attempt_day_counts.get(day, 0) + 1

    activity_days = set(review_day_counts) | set(attempt_day_counts)
    studied_today = today in activity_days
    streak_day = today if studied_today else today - timedelta(days=1)
    streak = 0
    while streak_day in activity_days:
        streak += 1
        streak_day -= timedelta(days=1)

    reviews_last_30 = [rating for day, rating in review_dates if day >= thirty_days_ago]
    retention = (
        sum(1 for rating in reviews_last_30 if rating >= 3) / len(reviews_last_30)
        if reviews_last_30
        else None
    )

    errors = {"missing": 0, "extra": 0, "typo": 0, "wrong": 0, "punctuation": 0}
    dictation_word_total = 0
    dictation_word_correct = 0
    dictation_attempts_30 = 0
    for day, row in attempt_dates:
        if day < thirty_days_ago:
            continue
        dictation_attempts_30 += 1
        dictation_word_total += int(row["scored_total"] or 0)
        dictation_word_correct += int(row["word_correct"] or 0)
        try:
            parsed = json.loads(row["errors_json"] or "{}")
        except (TypeError, ValueError):
            parsed = {}
        for key in errors:
            errors[key] += int(parsed.get(key, 0))
    dictation_accuracy = (
        dictation_word_correct / dictation_word_total if dictation_word_total else None
    )

    heatmap: list[dict[str, Any]] = []
    day = heatmap_start
    while day <= today:
        heatmap.append(
            {
                "date": day.isoformat(),
                "weekday": day.weekday(),
                "count": review_day_counts.get(day, 0) + attempt_day_counts.get(day, 0),
            }
        )
        day += timedelta(days=1)

    daily = []
    for offset in range(6, -1, -1):
        day = today - timedelta(days=offset)
        daily.append(
            {
                "date": day.isoformat(),
                "label": "今天" if offset == 0 else WEEKDAY_LABELS[day.weekday()],
                "reviews": review_day_counts.get(day, 0),
                "dictations": attempt_day_counts.get(day, 0),
            }
        )

    forecast_counts: dict[date, int] = {today + timedelta(days=offset): 0 for offset in range(7)}
    for row in forecast_rows:
        due_day = _local_date(row["due"])
        if due_day < today:
            due_day = today
        if due_day in forecast_counts:
            forecast_counts[due_day] += 1
    forecast = []
    for offset in range(7):
        day = today + timedelta(days=offset)
        label = "今天" if offset == 0 else "明天" if offset == 1 else f"{day.month}/{day.day}"
        forecast.append({"date": day.isoformat(), "label": label, "count": forecast_counts[day]})

    today_reviews = review_day_counts.get(today, 0)
    today_dictations = attempt_day_counts.get(today, 0)

    sessions_payload = []
    for row in recent_sessions:
        sessions_payload.append(
            {
                "id": row["id"],
                "material_title": row["material_title"],
                "mode": row["mode"],
                "item_count": row["item_count"],
                "completed_count": row["completed_count"],
                "accuracy": row["accuracy"],
                "created_at": row["created_at"],
                "completed": row["completed_count"] >= row["item_count"],
            }
        )

    return {
        "streak": streak,
        "studied_today": studied_today,
        "today": {"reviews": today_reviews, "dictations": today_dictations},
        "totals": totals,
        "retention": retention,
        "dictation_accuracy": dictation_accuracy,
        "dictation_attempts": dictation_attempts_30,
        "review_states": {
            "new": int(state_row["new"]),
            "learning": int(state_row["learning"]),
            "review": int(state_row["review"]),
            "relearning": int(state_row["relearning"]),
        },
        "heatmap": heatmap,
        "daily": daily,
        "forecast": forecast,
        "errors": errors,
        "recent_sessions": sessions_payload,
    }
