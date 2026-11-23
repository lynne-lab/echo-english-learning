from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from . import db

router = APIRouter(prefix="/api/module-state", tags=["module-state"])

# Modules whose internal state is not tied to a single material.
VALID_MODULES = {"review"}


class StateSave(BaseModel):
    state: dict[str, Any]


def _check_module(module: str) -> None:
    if module not in VALID_MODULES:
        raise HTTPException(status_code=400, detail="不支持的模块")


@router.get("/{module}")
def get_state(module: str) -> dict[str, Any] | None:
    _check_module(module)
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT module, state_json, updated_at FROM module_state WHERE module = ?",
            (module,),
        ).fetchone()
    if not row:
        return None
    try:
        state = json.loads(row["state_json"])
    except (TypeError, ValueError):
        state = {}
    return {
        "module": row["module"],
        "state": state,
        "updated_at": row["updated_at"],
    }


@router.put("/{module}")
def save_state(module: str, payload: StateSave) -> dict[str, Any]:
    _check_module(module)
    now = db.now_iso()
    state_json = json.dumps(payload.state, ensure_ascii=False)
    with db.get_conn() as conn:
        conn.execute(
            """
            INSERT INTO module_state (module, state_json, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(module) DO UPDATE SET
                state_json = excluded.state_json,
                updated_at = excluded.updated_at
            """,
            (module, state_json, now),
        )
    return {"module": module, "state": payload.state, "updated_at": now}
