from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from . import db, srs

router = APIRouter(prefix="/api/reviews", tags=["reviews"])


def _local_day_start() -> str:
    local_now = datetime.now().astimezone()
    start = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
    return start.astimezone(timezone.utc).isoformat()


def _quota(conn: Any) -> tuple[int, int, int]:
    limit = int(db.get_setting("daily_new_limit", "20") or 20)
    introduced_today = int(
        conn.execute(
            """
            SELECT COUNT(*) FROM review_cards
            WHERE introduced_at IS NOT NULL AND introduced_at >= ?
            """,
            (_local_day_start(),),
        ).fetchone()[0]
    )
    return limit, introduced_today, max(0, limit - introduced_today)


def _summary(conn: Any) -> dict[str, Any]:
    now = srs.now_utc().isoformat()
    due = int(
        conn.execute(
            "SELECT COUNT(*) FROM review_cards WHERE last_review IS NOT NULL AND due <= ?",
            (now,),
        ).fetchone()[0]
    )
    new_total = int(
        conn.execute(
            "SELECT COUNT(*) FROM review_cards WHERE last_review IS NULL"
        ).fetchone()[0]
    )
    limit, introduced_today, remaining = _quota(conn)
    next_due_row = conn.execute(
        """
        SELECT MIN(due) FROM review_cards
        WHERE last_review IS NOT NULL AND due > ?
        """,
        (now,),
    ).fetchone()
    reviews_today = int(
        conn.execute(
            "SELECT COUNT(*) FROM review_logs WHERE reviewed_at >= ?",
            (_local_day_start(),),
        ).fetchone()[0]
    )
    total_words = int(conn.execute("SELECT COUNT(*) FROM words").fetchone()[0])
    next_due = next_due_row[0] if next_due_row else None
    return {
        "due_reviews": due,
        "new_total": new_total,
        "new_today": introduced_today,
        "new_available": min(new_total, remaining),
        "daily_new_limit": limit,
        "reviews_today": reviews_today,
        "total_words": total_words,
        "next_due": next_due,
        "next_due_label": srs.next_due_label(next_due),
    }


def _occurrences(conn: Any, word_ids: list[str]) -> dict[str, dict[str, Any]]:
    if not word_ids:
        return {}
    placeholders = ",".join("?" for _ in word_ids)
    rows = conn.execute(
        f"""
        SELECT o.word_id, o.context, o.surface, o.material_id,
               s.start, s.end, m.title AS material_title
        FROM word_occurrences o
        JOIN sentences s ON s.id = o.sentence_id
        LEFT JOIN materials m ON m.id = o.material_id
        WHERE o.word_id IN ({placeholders})
        ORDER BY o.created_at ASC, s.start ASC
        """,
        tuple(word_ids),
    ).fetchall()
    result: dict[str, dict[str, Any]] = {}
    for row in rows:
        result.setdefault(row["word_id"], dict(row))
    return result


def _card(row: Any, occurrence: dict[str, Any] | None) -> dict[str, Any]:
    return {
        "card_id": row["card_id"],
        "word_id": row["word_id"],
        "lemma": row["lemma"],
        "phonetic": row["phonetic"],
        "translation": row["translation"],
        "definition": row["definition"],
        "state": row["state"],
        "state_name": srs.state_name(row["last_review"], row["state"]),
        "due": row["due"],
        "last_review": row["last_review"],
        "introduced_at": row["introduced_at"],
        "reps": row["reps"],
        "lapses": row["lapses"],
        "due_label": "现在" if row["last_review"] is None else srs.next_due_label(row["due"]),
        "occurrence": occurrence,
    }


@router.get("/summary")
def get_summary() -> dict[str, Any]:
    with db.get_conn() as conn:
        return _summary(conn)


@router.get("/queue")
def get_queue(
    limit: int = Query(default=20, ge=1, le=100),
    ahead: bool = False,
) -> dict[str, Any]:
    now = srs.now_utc().isoformat()
    with db.get_conn() as conn:
        due_rows = conn.execute(
            """
            SELECT rc.*, w.lemma, w.phonetic, w.translation, w.definition
            FROM review_cards rc
            JOIN words w ON w.id = rc.word_id
            WHERE rc.last_review IS NOT NULL AND rc.due <= ?
            ORDER BY rc.due ASC
            LIMIT ?
            """,
            (now, limit),
        ).fetchall()

        _limit, _introduced, remaining = _quota(conn)
        new_limit = min(remaining, max(0, limit - len(due_rows)))
        new_rows = []
        if new_limit > 0:
            new_rows = conn.execute(
                """
                SELECT rc.*, w.lemma, w.phonetic, w.translation, w.definition
                FROM review_cards rc
                JOIN words w ON w.id = rc.word_id
                WHERE rc.last_review IS NULL
                ORDER BY rc.created_at ASC
                LIMIT ?
                """,
                (new_limit,),
            ).fetchall()

        rows = list(due_rows) + list(new_rows)
        if ahead and len(rows) < limit:
            # "继续复习": today's queue is finished, so pull cards that are not
            # due yet. Cards already reviewed today go last so the learner is
            # not shown the same words again right away while older ones exist.
            future_rows = conn.execute(
                """
                SELECT rc.*, w.lemma, w.phonetic, w.translation, w.definition
                FROM review_cards rc
                JOIN words w ON w.id = rc.word_id
                WHERE rc.last_review IS NOT NULL AND rc.due > ?
                ORDER BY CASE WHEN rc.last_review >= ? THEN 1 ELSE 0 END ASC,
                         rc.due ASC
                LIMIT ?
                """,
                (now, _local_day_start(), limit - len(rows)),
            ).fetchall()
            rows += list(future_rows)

        occurrences = _occurrences(conn, [row["word_id"] for row in rows])
        cards = [_card(row, occurrences.get(row["word_id"])) for row in rows]
        summary = _summary(conn)
    return {"cards": cards, "summary": summary}


@router.get("/{word_id}/preview")
def preview_word(word_id: str) -> dict[str, Any]:
    with db.get_conn() as conn:
        row = conn.execute(
            """
            SELECT rc.*, w.lemma
            FROM review_cards rc
            JOIN words w ON w.id = rc.word_id
            WHERE rc.word_id = ?
            """,
            (word_id,),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="复习卡片不存在")
    return {
        "word_id": word_id,
        "state_name": srs.state_name(row["last_review"], row["state"]),
        "due": row["due"],
        "previews": srs.previews(row),
    }


class RateRequest(BaseModel):
    rating: int = Field(ge=1, le=4)
    duration_ms: int | None = Field(default=None, ge=0, le=3_600_000)


@router.post("/{word_id}/rate")
def rate_word(word_id: str, payload: RateRequest) -> dict[str, Any]:
    with db.get_conn() as conn:
        row = conn.execute(
            """
            SELECT rc.*, w.lemma
            FROM review_cards rc
            JOIN words w ON w.id = rc.word_id
            WHERE rc.word_id = ?
            """,
            (word_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="复习卡片不存在")

        now = srs.now_utc()
        result = srs.apply_review(row, payload.rating, payload.duration_ms, now=now)
        was_new = row["last_review"] is None
        lapses = int(row["lapses"]) + (
            1 if payload.rating == 1 and not was_new and int(row["state"]) == 2 else 0
        )
        introduced_at = row["introduced_at"]
        if introduced_at is None and was_new:
            introduced_at = now.isoformat(timespec="seconds")

        conn.execute(
            """
            UPDATE review_cards
            SET state = ?, step = ?, stability = ?, difficulty = ?, due = ?,
                last_review = ?, introduced_at = ?, reps = reps + 1,
                lapses = ?, updated_at = ?
            WHERE word_id = ?
            """,
            (
                result["state"],
                result["step"],
                result["stability"],
                result["difficulty"],
                result["due"].isoformat(timespec="seconds"),
                now.isoformat(timespec="seconds"),
                introduced_at,
                lapses,
                now.isoformat(timespec="seconds"),
                word_id,
            ),
        )
        conn.execute(
            """
            INSERT INTO review_logs
                (card_id, word_id, rating, state_before, state_after,
                 due_before, due_after, reviewed_at, duration_ms,
                 interval_days, stability, difficulty)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                row["card_id"],
                word_id,
                payload.rating,
                row["state"],
                result["state"],
                row["due"],
                result["due"].isoformat(timespec="seconds"),
                now.isoformat(timespec="seconds"),
                payload.duration_ms,
                result["interval_days"],
                result["stability"],
                result["difficulty"],
            ),
        )
        summary = _summary(conn)

    return {
        "word_id": word_id,
        "rating": payload.rating,
        "due": result["due"].isoformat(timespec="seconds"),
        "interval": result["interval_label"],
        "state_name": result["state_name"],
        "summary": summary,
    }
