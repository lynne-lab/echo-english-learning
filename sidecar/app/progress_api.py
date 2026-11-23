from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from . import db

router = APIRouter(prefix="/api/progress", tags=["progress"])

# Modules that remember the last sentence they were on. Dictation progress is
# derived from attempts instead (see dictation_api).
VALID_MODULES = {"player", "shadowing"}


class ProgressSave(BaseModel):
    sentence_id: str | None = None
    sentence_idx: int | None = None
    position: float | None = None


def _check_module(module: str) -> None:
    if module not in VALID_MODULES:
        raise HTTPException(status_code=400, detail="不支持的进度模块")


@router.get("/{module}")
def list_progress(module: str) -> list[dict[str, Any]]:
    _check_module(module)
    with db.get_conn() as conn:
        rows = conn.execute(
            """
            SELECT module, material_id, sentence_id, sentence_idx, position,
                   updated_at
            FROM learning_progress
            WHERE module = ?
            """,
            (module,),
        ).fetchall()
    return [dict(row) for row in rows]


@router.get("/{module}/{material_id}")
def get_progress(module: str, material_id: str) -> dict[str, Any] | None:
    _check_module(module)
    with db.get_conn() as conn:
        row = conn.execute(
            """
            SELECT module, material_id, sentence_id, sentence_idx, position,
                   updated_at
            FROM learning_progress
            WHERE module = ? AND material_id = ?
            """,
            (module, material_id),
        ).fetchone()
    return dict(row) if row else None


@router.put("/{module}/{material_id}")
def save_progress(
    module: str, material_id: str, payload: ProgressSave
) -> dict[str, Any]:
    _check_module(module)

    sentence_idx = payload.sentence_idx
    if payload.sentence_id:
        sentence = db.get_sentence(payload.sentence_id)
        if not sentence or sentence["material_id"] != material_id:
            raise HTTPException(status_code=404, detail="句子不属于这个素材")
        if sentence_idx is None:
            sentence_idx = int(sentence["idx"])

    now = db.now_iso()
    with db.get_conn() as conn:
        conn.execute(
            """
            INSERT INTO learning_progress
                (module, material_id, sentence_id, sentence_idx, position,
                 updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(module, material_id) DO UPDATE SET
                sentence_id = excluded.sentence_id,
                sentence_idx = excluded.sentence_idx,
                position = excluded.position,
                updated_at = excluded.updated_at
            """,
            (
                module,
                material_id,
                payload.sentence_id,
                sentence_idx,
                payload.position,
                now,
            ),
        )
        row = conn.execute(
            """
            SELECT module, material_id, sentence_id, sentence_idx, position,
                   updated_at
            FROM learning_progress
            WHERE module = ? AND material_id = ?
            """,
            (module, material_id),
        ).fetchone()
    return dict(row)
