from __future__ import annotations

import difflib
import json
import random
import re
import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from . import db

router = APIRouter(prefix="/api/dictation", tags=["dictation"])

WORD_RE = re.compile(r"[A-Za-z]+(?:['’\-][A-Za-z]+)*|\d+(?:[.,]\d+)*")
PUNCT_RE = re.compile(r"[.!?,;:…]")

STOPWORDS = {
    "the", "a", "an", "this", "that", "these", "those", "is", "are", "was",
    "were", "be", "been", "being", "am", "do", "does", "did", "have", "has",
    "had", "of", "to", "in", "on", "at", "for", "with", "and", "or", "but",
    "so", "if", "then", "i", "you", "he", "she", "it", "we", "they", "me",
    "him", "her", "us", "them", "my", "your", "his", "its", "our", "their",
    "will", "would", "can", "could", "should", "may", "might", "must", "not",
    "no", "yes", "as", "by", "from", "about", "into", "over", "after",
    "before", "up", "down", "out", "off", "than", "too", "very", "just",
    "also", "there", "here", "what", "which", "who", "whom", "whose", "when",
    "where", "why", "how", "some", "any", "all", "one", "two", "more", "most",
}


def _pair_replace(
    expected_words: list[str], actual_words: list[str]
) -> list[tuple[str | None, str | None, float]]:
    pairs: list[tuple[str | None, str | None, float]] = []
    used: set[int] = set()
    for expected in expected_words:
        best_index = None
        best_ratio = 0.0
        for index, actual in enumerate(actual_words):
            if index in used:
                continue
            ratio = difflib.SequenceMatcher(
                None, expected.lower(), actual.lower(), autojunk=False
            ).ratio()
            if ratio > best_ratio:
                best_ratio = ratio
                best_index = index
        if best_index is not None and best_ratio >= 0.55:
            used.add(best_index)
            pairs.append((expected, actual_words[best_index], best_ratio))
        else:
            pairs.append((expected, None, 0.0))
    for index, actual in enumerate(actual_words):
        if index not in used:
            pairs.append((None, actual, 0.0))
    return pairs


def grade_text(expected: str, actual: str) -> dict[str, Any]:
    expected_words = WORD_RE.findall(expected)
    actual_words = WORD_RE.findall(actual)
    matcher = difflib.SequenceMatcher(
        None,
        [word.lower() for word in expected_words],
        [word.lower() for word in actual_words],
        autojunk=False,
    )

    tokens: list[dict[str, Any]] = []
    errors = {"missing": 0, "extra": 0, "typo": 0, "wrong": 0, "punctuation": 0}
    correct = 0

    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            for offset in range(i2 - i1):
                tokens.append(
                    {
                        "kind": "correct",
                        "expected": expected_words[i1 + offset],
                        "actual": actual_words[j1 + offset],
                    }
                )
                correct += 1
        elif tag == "delete":
            for index in range(i1, i2):
                tokens.append(
                    {"kind": "missing", "expected": expected_words[index], "actual": None}
                )
                errors["missing"] += 1
        elif tag == "insert":
            for index in range(j1, j2):
                tokens.append(
                    {"kind": "extra", "expected": None, "actual": actual_words[index]}
                )
                errors["extra"] += 1
        else:
            pairs = _pair_replace(expected_words[i1:i2], actual_words[j1:j2])
            for expected_word, actual_word, ratio in pairs:
                if expected_word is not None and actual_word is not None:
                    kind = "typo" if ratio >= 0.55 else "wrong"
                    tokens.append(
                        {
                            "kind": kind,
                            "expected": expected_word,
                            "actual": actual_word,
                            "similarity": round(ratio, 2),
                        }
                    )
                    errors[kind] += 1
                elif expected_word is not None:
                    tokens.append(
                        {"kind": "missing", "expected": expected_word, "actual": None}
                    )
                    errors["missing"] += 1
                else:
                    tokens.append(
                        {"kind": "extra", "expected": None, "actual": actual_word}
                    )
                    errors["extra"] += 1

    expected_punct = "".join(PUNCT_RE.findall(expected))
    actual_punct = "".join(PUNCT_RE.findall(actual))
    punctuation_ok = expected_punct == actual_punct
    if not punctuation_ok:
        errors["punctuation"] = 1

    word_total = len(expected_words)
    scored_total = word_total + errors["extra"]
    accuracy = (correct / scored_total) if scored_total else (1.0 if not expected.strip() else 0.0)

    return {
        "tokens": tokens,
        "accuracy": round(accuracy, 4),
        "word_total": word_total,
        "word_correct": correct,
        "scored_total": scored_total,
        "errors": errors,
        "punctuation_ok": punctuation_ok,
        "expected_punctuation": expected_punct,
        "actual_punctuation": actual_punct,
    }


def _cloze_segments(text: str, rng: random.Random) -> list[dict[str, Any]]:
    matches = list(WORD_RE.finditer(text))
    if len(matches) <= 1:
        return [{"text": text, "blank": False}]

    words = [match.group(0) for match in matches]
    candidates = [
        index
        for index, word in enumerate(words)
        if len(word) >= 4 and word.lower() not in STOPWORDS
    ]
    if len(candidates) < 2:
        candidates = [index for index, word in enumerate(words) if len(word) >= 3]
    if not candidates:
        candidates = list(range(len(words)))

    target = max(1, min(len(candidates), round(len(words) * 0.3)))
    target = min(target, len(words) - 1)
    blank_indices = set(rng.sample(candidates, target)) if target > 0 else set()

    segments: list[dict[str, Any]] = []
    cursor = 0
    for index, match in enumerate(matches):
        if index not in blank_indices:
            continue
        prefix = text[cursor : match.start()]
        if prefix:
            segments.append({"text": prefix, "blank": False})
        segments.append({"text": match.group(0), "blank": True})
        cursor = match.end()
    tail = text[cursor:]
    if tail:
        segments.append({"text": tail, "blank": False})
    return segments or [{"text": text, "blank": False}]


def _session_summary(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "material_id": row["material_id"],
        "material_title": row["material_title"],
        "mode": row["mode"],
        "item_count": row["item_count"],
        "completed_count": row["completed_count"],
        "correct_count": row["correct_count"],
        "word_total": row["word_total"],
        "scored_total": row["scored_total"],
        "word_correct": row["word_correct"],
        "accuracy": row["accuracy"],
        "created_at": row["created_at"],
        "completed_at": row["completed_at"],
        "completed": row["completed_count"] >= row["item_count"],
    }


def _session_payload(row: Any, include_items: bool = True) -> dict[str, Any]:
    payload = _session_summary(row)
    if include_items:
        payload["items"] = json.loads(row["items_json"])
    return payload


class CreateSession(BaseModel):
    material_id: str
    mode: str = Field(pattern="^(full|cloze)$")
    count: int = Field(default=10, ge=0, le=200)


@router.post("/sessions")
def create_session(payload: CreateSession) -> dict[str, Any]:
    material = db.get_material(payload.material_id)
    if not material:
        raise HTTPException(status_code=404, detail="素材不存在")
    if material["status"] != "ready":
        raise HTTPException(status_code=400, detail="素材还在处理中，暂时不能默写")

    sentences = db.list_sentences(payload.material_id)
    if not sentences:
        raise HTTPException(status_code=400, detail="这个素材还没有可默写的句子")

    if 0 < payload.count < len(sentences):
        chosen = sorted(
            random.SystemRandom().sample(sentences, payload.count),
            key=lambda sentence: sentence["idx"],
        )
    else:
        chosen = sentences

    session_id = uuid.uuid4().hex
    now = db.now_iso()
    items: list[dict[str, Any]] = []
    for sentence in chosen:
        item = {
            "sentence_id": sentence["id"],
            "idx": sentence["idx"],
            "start": sentence["start"],
            "end": sentence["end"],
            "text": sentence["text"],
        }
        if payload.mode == "cloze":
            rng = random.Random(f"{session_id}:{sentence['id']}")
            item["cloze_segments"] = _cloze_segments(sentence["text"], rng)
        items.append(item)

    with db.get_conn() as conn:
        conn.execute(
            """
            INSERT INTO dictation_sessions
                (id, material_id, material_title, mode, item_count, items_json,
                 completed_count, correct_count, word_total, scored_total,
                 word_correct, accuracy, created_at, completed_at)
            VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, ?, NULL)
            """,
            (
                session_id,
                material["id"],
                material["title"],
                payload.mode,
                len(items),
                json.dumps(items, ensure_ascii=False),
                now,
            ),
        )
        row = conn.execute(
            "SELECT * FROM dictation_sessions WHERE id = ?", (session_id,)
        ).fetchone()
    return _session_payload(row)


@router.get("/sessions")
def list_sessions(limit: int = Query(default=20, ge=1, le=100)) -> list[dict[str, Any]]:
    with db.get_conn() as conn:
        rows = conn.execute(
            """
            SELECT * FROM dictation_sessions
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [_session_payload(row, include_items=False) for row in rows]


@router.delete("/sessions/{session_id}")
def delete_session(session_id: str) -> dict[str, bool]:
    with db.get_conn() as conn:
        cursor = conn.execute(
            "DELETE FROM dictation_sessions WHERE id = ?", (session_id,)
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="默写记录不存在")
    return {"ok": True}


@router.get("/sessions/{session_id}")
def get_session(session_id: str) -> dict[str, Any]:
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM dictation_sessions WHERE id = ?", (session_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="默写记录不存在")
        attempts = conn.execute(
            """
            SELECT * FROM dictation_attempts
            WHERE session_id = ?
            ORDER BY created_at ASC
            """,
            (session_id,),
        ).fetchall()

    payload = _session_payload(row)
    payload["attempts"] = []
    for attempt in attempts:
        item = dict(attempt)
        item["diff"] = json.loads(item.pop("diff_json"))
        item["errors"] = json.loads(item.pop("errors_json"))
        payload["attempts"].append(item)
    return payload


class AttemptRequest(BaseModel):
    sentence_id: str
    user_text: str = ""


@router.post("/sessions/{session_id}/attempts")
def submit_attempt(session_id: str, payload: AttemptRequest) -> dict[str, Any]:
    with db.get_conn() as conn:
        session = conn.execute(
            "SELECT * FROM dictation_sessions WHERE id = ?", (session_id,)
        ).fetchone()
        if not session:
            raise HTTPException(status_code=404, detail="默写记录不存在")

        items = json.loads(session["items_json"])
        item = next(
            (entry for entry in items if entry["sentence_id"] == payload.sentence_id),
            None,
        )
        if item is None:
            raise HTTPException(status_code=400, detail="这句话不属于本次默写")

        user_text = payload.user_text.strip()
        grade = grade_text(item["text"], user_text)
        now = db.now_iso()

        conn.execute(
            """
            INSERT INTO dictation_attempts
                (id, session_id, material_id, sentence_id, sentence_text,
                 user_text, accuracy, word_total, scored_total, word_correct,
                 diff_json, errors_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(session_id, sentence_id) DO UPDATE SET
                user_text = excluded.user_text,
                accuracy = excluded.accuracy,
                word_total = excluded.word_total,
                scored_total = excluded.scored_total,
                word_correct = excluded.word_correct,
                diff_json = excluded.diff_json,
                errors_json = excluded.errors_json,
                updated_at = excluded.updated_at
            """,
            (
                uuid.uuid4().hex,
                session_id,
                session["material_id"],
                item["sentence_id"],
                item["text"],
                user_text,
                grade["accuracy"],
                grade["word_total"],
                grade["scored_total"],
                grade["word_correct"],
                json.dumps({"tokens": grade["tokens"]}, ensure_ascii=False),
                json.dumps(grade["errors"], ensure_ascii=False),
                now,
                now,
            ),
        )

        aggregate = conn.execute(
            """
            SELECT COUNT(*) AS completed,
                   COALESCE(SUM(word_total), 0) AS word_total,
                   COALESCE(SUM(scored_total), 0) AS scored_total,
                   COALESCE(SUM(word_correct), 0) AS word_correct,
                   COALESCE(SUM(CASE WHEN accuracy >= 0.999 THEN 1 ELSE 0 END), 0) AS correct
            FROM dictation_attempts
            WHERE session_id = ?
            """,
            (session_id,),
        ).fetchone()

        completed = int(aggregate["completed"])
        word_total = int(aggregate["word_total"])
        scored_total = int(aggregate["scored_total"])
        word_correct = int(aggregate["word_correct"])
        correct = int(aggregate["correct"])
        accuracy = (word_correct / scored_total) if scored_total else 0.0
        completed_at = session["completed_at"]
        if completed >= session["item_count"] and not completed_at:
            completed_at = now

        conn.execute(
            """
            UPDATE dictation_sessions
            SET completed_count = ?, correct_count = ?, word_total = ?,
                scored_total = ?, word_correct = ?, accuracy = ?, completed_at = ?
            WHERE id = ?
            """,
            (
                completed,
                correct,
                word_total,
                scored_total,
                word_correct,
                round(accuracy, 4),
                completed_at,
                session_id,
            ),
        )
        updated = conn.execute(
            "SELECT * FROM dictation_sessions WHERE id = ?", (session_id,)
        ).fetchone()

    return {
        "accuracy": grade["accuracy"],
        "word_total": grade["word_total"],
        "word_correct": grade["word_correct"],
        "scored_total": grade["scored_total"],
        "errors": grade["errors"],
        "tokens": grade["tokens"],
        "punctuation_ok": grade["punctuation_ok"],
        "expected_punctuation": grade["expected_punctuation"],
        "actual_punctuation": grade["actual_punctuation"],
        "expected_text": item["text"],
        "session": _session_payload(updated, include_items=False),
    }
