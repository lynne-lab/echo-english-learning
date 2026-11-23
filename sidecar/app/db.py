from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterator

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS materials (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_url TEXT,
    file_path TEXT,
    media_type TEXT NOT NULL DEFAULT 'audio',
    duration REAL,
    status TEXT NOT NULL DEFAULT 'processing',
    stage TEXT,
    progress REAL NOT NULL DEFAULT 0,
    error TEXT,
    language TEXT NOT NULL DEFAULT 'en',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sentences (
    id TEXT PRIMARY KEY,
    material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    idx INTEGER NOT NULL,
    start REAL NOT NULL,
    end REAL NOT NULL,
    text TEXT NOT NULL,
    original_text TEXT,
    words_json TEXT,
    UNIQUE(material_id, idx)
);

CREATE TABLE IF NOT EXISTS words (
    id TEXT PRIMARY KEY,
    lemma TEXT NOT NULL UNIQUE,
    phonetic TEXT,
    definition TEXT,
    translation TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS word_occurrences (
    id TEXT PRIMARY KEY,
    word_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
    sentence_id TEXT NOT NULL REFERENCES sentences(id) ON DELETE CASCADE,
    material_id TEXT NOT NULL,
    context TEXT,
    surface TEXT,
    note TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(word_id, sentence_id)
);

CREATE TABLE IF NOT EXISTS review_cards (
    card_id INTEGER PRIMARY KEY AUTOINCREMENT,
    word_id TEXT NOT NULL UNIQUE REFERENCES words(id) ON DELETE CASCADE,
    state INTEGER NOT NULL DEFAULT 1,
    step INTEGER,
    stability REAL,
    difficulty REAL,
    due TEXT NOT NULL,
    last_review TEXT,
    introduced_at TEXT,
    reps INTEGER NOT NULL DEFAULT 0,
    lapses INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS review_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id INTEGER NOT NULL,
    word_id TEXT NOT NULL,
    rating INTEGER NOT NULL,
    state_before INTEGER,
    state_after INTEGER,
    due_before TEXT,
    due_after TEXT,
    reviewed_at TEXT NOT NULL,
    duration_ms INTEGER,
    interval_days REAL,
    stability REAL,
    difficulty REAL
);

CREATE TABLE IF NOT EXISTS dictation_sessions (
    id TEXT PRIMARY KEY,
    material_id TEXT NOT NULL,
    material_title TEXT NOT NULL,
    mode TEXT NOT NULL,
    item_count INTEGER NOT NULL,
    items_json TEXT NOT NULL,
    completed_count INTEGER NOT NULL DEFAULT 0,
    correct_count INTEGER NOT NULL DEFAULT 0,
    word_total INTEGER NOT NULL DEFAULT 0,
    scored_total INTEGER NOT NULL DEFAULT 0,
    word_correct INTEGER NOT NULL DEFAULT 0,
    accuracy REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    completed_at TEXT,
    last_index INTEGER NOT NULL DEFAULT 0,
    last_active_at TEXT
);

CREATE TABLE IF NOT EXISTS dictation_attempts (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES dictation_sessions(id) ON DELETE CASCADE,
    material_id TEXT NOT NULL,
    sentence_id TEXT NOT NULL,
    sentence_text TEXT NOT NULL,
    user_text TEXT NOT NULL,
    accuracy REAL NOT NULL,
    word_total INTEGER NOT NULL,
    scored_total INTEGER NOT NULL,
    word_correct INTEGER NOT NULL,
    diff_json TEXT NOT NULL,
    errors_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(session_id, sentence_id)
);

CREATE TABLE IF NOT EXISTS recordings (
    id TEXT PRIMARY KEY,
    material_id TEXT NOT NULL,
    sentence_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    mime_type TEXT,
    duration REAL NOT NULL DEFAULT 0,
    recognized_text TEXT,
    accuracy REAL,
    feedback_json TEXT,
    created_at TEXT NOT NULL,
    transcribed_at TEXT,
    azure_json TEXT,
    azure_scored_at TEXT
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS learning_progress (
    module TEXT NOT NULL,
    material_id TEXT NOT NULL,
    sentence_id TEXT,
    sentence_idx INTEGER,
    position REAL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (module, material_id)
);

CREATE TABLE IF NOT EXISTS module_state (
    module TEXT PRIMARY KEY,
    state_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS study_plans (
    id TEXT PRIMARY KEY,
    start_date TEXT NOT NULL,
    material_id TEXT REFERENCES materials(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT
);

CREATE TABLE IF NOT EXISTS study_plan_tasks (
    plan_id TEXT NOT NULL REFERENCES study_plans(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    kind TEXT NOT NULL,
    completed_at TEXT NOT NULL,
    PRIMARY KEY (plan_id, day, kind)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_sentences_material ON sentences(material_id, idx);
CREATE INDEX IF NOT EXISTS idx_occurrences_word ON word_occurrences(word_id);
CREATE INDEX IF NOT EXISTS idx_occurrences_sentence ON word_occurrences(sentence_id);
CREATE INDEX IF NOT EXISTS idx_review_cards_due ON review_cards(due);
CREATE INDEX IF NOT EXISTS idx_review_logs_reviewed ON review_logs(reviewed_at);
CREATE INDEX IF NOT EXISTS idx_dictation_sessions_created ON dictation_sessions(created_at);
CREATE INDEX IF NOT EXISTS idx_dictation_attempts_session ON dictation_attempts(session_id);
CREATE INDEX IF NOT EXISTS idx_recordings_sentence ON recordings(sentence_id, created_at);
CREATE INDEX IF NOT EXISTS idx_recordings_material ON recordings(material_id);
"""

MATERIAL_FIELDS = {
    "title",
    "source_type",
    "source_url",
    "file_path",
    "media_type",
    "duration",
    "status",
    "stage",
    "progress",
    "error",
    "language",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@contextmanager
def get_conn() -> Iterator[sqlite3.Connection]:
    if config.settings is None:
        raise RuntimeError("settings is not initialised")
    conn = sqlite3.connect(str(config.settings.db_path), timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _ensure_column(conn: sqlite3.Connection, table: str, column: str, ddl: str) -> None:
    columns = {row[1] for row in conn.execute(f'PRAGMA table_info("{table}")').fetchall()}
    if column not in columns:
        conn.execute(f'ALTER TABLE "{table}" ADD COLUMN "{column}" {ddl}')


def init_db() -> None:
    with get_conn() as conn:
        conn.executescript(SCHEMA)
        # Phase 2 migration: occurrences remember the exact word form that was clicked.
        _ensure_column(conn, "word_occurrences", "surface", "TEXT")

        # Phase 3/4 migration: optional Azure pronunciation assessment result.
        _ensure_column(conn, "recordings", "azure_json", "TEXT")
        _ensure_column(conn, "recordings", "azure_scored_at", "TEXT")

        # v0.8: resumable dictation sessions and exact listening position.
        _ensure_column(
            conn,
            "dictation_sessions",
            "last_index",
            "INTEGER NOT NULL DEFAULT 0",
        )
        _ensure_column(conn, "dictation_sessions", "last_active_at", "TEXT")
        _ensure_column(conn, "learning_progress", "position", "REAL")
        conn.execute(
            """
            UPDATE dictation_sessions
            SET last_active_at = created_at
            WHERE last_active_at IS NULL
            """
        )

        conn.execute(
            "INSERT OR IGNORE INTO settings(key, value) VALUES('whisper_model', 'small.en')"
        )
        conn.execute(
            "INSERT OR IGNORE INTO settings(key, value) VALUES('daily_new_limit', '20')"
        )

        # 应用重启后，之前没跑完的任务不会再恢复，标记为可重试的错误。
        conn.execute(
            """
            UPDATE materials
            SET status = 'error',
                stage = '任务已中断',
                error = COALESCE(error, '应用重启导致任务中断，请点击重试'),
                updated_at = ?
            WHERE status = 'processing'
            """,
            (now_iso(),),
        )

        # 给 Phase 1 已有的生词补上 FSRS 卡片。
        now = now_iso()
        conn.execute(
            """
            INSERT OR IGNORE INTO review_cards
                (word_id, state, step, stability, difficulty, due, last_review,
                 introduced_at, reps, lapses, created_at, updated_at)
            SELECT id, 1, NULL, NULL, NULL, ?, NULL, NULL, 0, 0, ?, ?
            FROM words
            """,
            (now, now, now),
        )


def get_setting(key: str, default: str | None = None) -> str | None:
    with get_conn() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default


def set_setting(key: str, value: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO settings(key, value) VALUES(?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )


def update_material(material_id: str, **fields: Any) -> None:
    updates = {k: v for k, v in fields.items() if k in MATERIAL_FIELDS}
    if not updates:
        return
    if "progress" in updates:
        updates["progress"] = max(0.0, min(1.0, float(updates["progress"])))
    updates["updated_at"] = now_iso()
    assignments = ", ".join(f"{key} = ?" for key in updates)
    values = list(updates.values()) + [material_id]
    with get_conn() as conn:
        conn.execute(f"UPDATE materials SET {assignments} WHERE id = ?", values)


def get_material(material_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute(
            """
            SELECT m.*,
                   (SELECT COUNT(*) FROM sentences s WHERE s.material_id = m.id) AS sentence_count
            FROM materials m
            WHERE m.id = ?
            """,
            (material_id,),
        ).fetchone()
    return dict(row) if row else None


def list_materials() -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT m.*,
                   (SELECT COUNT(*) FROM sentences s WHERE s.material_id = m.id) AS sentence_count
            FROM materials m
            ORDER BY m.created_at DESC
            """
        ).fetchall()
    return [dict(row) for row in rows]


def get_sentence(sentence_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM sentences WHERE id = ?", (sentence_id,)).fetchone()
    return dict(row) if row else None


def list_sentences(material_id: str) -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM sentences WHERE material_id = ? ORDER BY idx ASC",
            (material_id,),
        ).fetchall()
    return [dict(row) for row in rows]
