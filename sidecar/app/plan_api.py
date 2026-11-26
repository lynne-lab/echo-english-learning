from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from . import db

router = APIRouter(prefix="/api/plan", tags=["plan"])

PLAN_DAYS = 24 * 7
TASK_KINDS = ("review", "listening", "dictation", "shadowing", "conversation")
WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]

TASKS = [
    {
        "kind": "review",
        "title": "复习生词",
        "minutes": 5,
        "description": "先清掉今天到期的 FSRS 卡片，再开始新材料。",
    },
    {
        "kind": "listening",
        "title": "精听",
        "minutes": 10,
        "description": "逐句听 1–2 分钟材料，查 5–8 个词并加入生词本。",
    },
    {
        "kind": "dictation",
        "title": "抠词默写",
        "minutes": 10,
        "description": "用同一段做抠词默写，提交后看漏词、拼写和听错。",
    },
    {
        "kind": "shadowing",
        "title": "跟读",
        "minutes": 10,
        "description": "选 3–5 句录音，A/B 对比节奏、重音和停顿。",
    },
    {
        "kind": "conversation",
        "title": "口语对话",
        "minutes": 10,
        "description": "和 AI 聊 3–5 个回合，结束看语法、表达和发音复盘。",
    },
]

PHASES: list[dict[str, Any]] = [
    {
        "key": "recovery",
        "title": "恢复期",
        "subtitle": "第 1–4 周",
        "start_week": 1,
        "end_week": 4,
        "accent": "美音主线，英音泛听",
        "focus": "重新打开耳朵，建立每天 45 分钟的节奏。",
        "goal": "0.75–1x 听懂 6 Minute English / VOA，默写准确率到 70%。",
        "materials": [
            {
                "title": "VOA Learning English · Everyday Grammar",
                "accent": "美音",
                "length": "3–5 分钟",
                "level": "A2–B1",
                "note": "语速慢、句子短，最适合重新打开耳朵。",
                "homepage": "https://learningenglish.voanews.com/",
            },
            {
                "title": "BBC 6 Minute English",
                "accent": "英音",
                "length": "6 分钟",
                "level": "A2–B1",
                "note": "两人对话，带文本和词汇表，精听和默写都合适。",
                "homepage": "https://www.bbc.co.uk/learningenglish/english/features/6-minute-english",
            },
            {
                "title": "ELLLO",
                "accent": "多口音",
                "length": "1–3 分钟",
                "level": "A1–B1",
                "note": "真实短对话，适合跟读和适应不同口音。",
                "homepage": "https://www.elllo.org/",
            },
            {
                "title": "EnglishPod",
                "accent": "美音",
                "length": "约 10 分钟",
                "level": "A2–B1",
                "note": "对话有慢速和常速两版，适合从慢速过渡到自然语速。",
                "homepage": "https://www.englishpod.com/",
            },
        ],
    },
    {
        "key": "growth",
        "title": "提升期",
        "subtitle": "第 5–12 周",
        "start_week": 5,
        "end_week": 12,
        "accent": "美音为主，英音补充",
        "focus": "从短对话走向自然对话，开始稳定输出。",
        "goal": "1x 听懂 All Ears English 约 70%，每天跟读 3–5 句。",
        "materials": [
            {
                "title": "All Ears English",
                "accent": "美音",
                "length": "15–20 分钟",
                "level": "B1–B2",
                "note": "自然对话、职场和日常表达，适合拆成两段精听。",
                "homepage": "https://www.allearsenglish.com/",
            },
            {
                "title": "The English We Speak",
                "accent": "英音",
                "length": "3 分钟",
                "level": "B1",
                "note": "每期一个习语，短句跟读神器。",
                "homepage": "https://www.bbc.co.uk/learningenglish/english/features/the-english-we-speak",
            },
            {
                "title": "Speak English with Vanessa",
                "accent": "美音",
                "length": "10–20 分钟",
                "level": "B1",
                "note": "吐字清晰，日常话题多，适合跟读。",
                "homepage": "https://www.youtube.com/@SpeakEnglishWithVanessa",
            },
            {
                "title": "TED-Ed",
                "accent": "多口音",
                "length": "3–6 分钟",
                "level": "B1–B2",
                "note": "动画加清晰旁白，从精听过渡到泛听。",
                "homepage": "https://ed.ted.com/",
            },
            {
                "title": "Easy English",
                "accent": "多口音",
                "length": "5–10 分钟",
                "level": "A2–B1",
                "note": "街头采访，真实短回答；暂停自己答，再对比。",
                "homepage": "https://www.youtube.com/@EasyEnglish",
            },
        ],
    },
    {
        "key": "real_speed",
        "title": "真实语速",
        "subtitle": "第 13–24 周",
        "start_week": 13,
        "end_week": 24,
        "accent": "美音主线，多口音泛听",
        "focus": "适应真实语速，把听懂的内容说出来。",
        "goal": "CNN 10 / NPR 第一遍懂 70%，能做 3–5 分钟英文自述。",
        "materials": [
            {
                "title": "TED Talks",
                "accent": "多口音",
                "length": "10–18 分钟",
                "level": "B2",
                "note": "演讲结构清晰，适合练复述和观点表达。",
                "homepage": "https://www.ted.com/talks",
            },
            {
                "title": "CNN 10",
                "accent": "美音",
                "length": "10 分钟",
                "level": "B1–B2",
                "note": "新闻语速适中，带文本，适合每日泛听。",
                "homepage": "https://www.cnn.com/cnn10",
            },
            {
                "title": "NPR Up First",
                "accent": "美音",
                "length": "12–15 分钟",
                "level": "B2",
                "note": "新闻对话，信息密度比 CNN 10 高。",
                "homepage": "https://www.npr.org/podcasts/510318/up-first",
            },
            {
                "title": "Planet Money",
                "accent": "美音",
                "length": "约 20 分钟",
                "level": "B2",
                "note": "故事型经济新闻，比纯新闻更好坚持。",
                "homepage": "https://www.npr.org/sections/money/",
            },
            {
                "title": "99% Invisible",
                "accent": "美音",
                "length": "30–45 分钟",
                "level": "B2",
                "note": "旁白清晰的设计故事，适合周末泛听。",
                "homepage": "https://99percentinvisible.org/",
            },
            {
                "title": "BBC Global News Podcast",
                "accent": "英音 / 多口音",
                "length": "约 30 分钟",
                "level": "B2–C1",
                "note": "后期挑战，不要在第一阶段使用。",
                "homepage": "https://www.bbc.co.uk/programmes/p02nq0gn",
            },
        ],
    },
]


def _local_today() -> date:
    return datetime.now().astimezone().date()


def _now_iso() -> str:
    return db.now_iso()


def _active_plan(conn: Any) -> dict[str, Any] | None:
    row = conn.execute(
        """
        SELECT * FROM study_plans
        WHERE archived_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
        """
    ).fetchone()
    return dict(row) if row else None


def _material(conn: Any, material_id: str | None) -> dict[str, Any] | None:
    if not material_id:
        return None
    row = conn.execute(
        """
        SELECT m.id, m.title, m.status, m.media_type, m.duration,
               (SELECT COUNT(*) FROM sentences s WHERE s.material_id = m.id) AS sentence_count
        FROM materials m
        WHERE m.id = ?
        """,
        (material_id,),
    ).fetchone()
    return dict(row) if row else None


def _material_options(conn: Any) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT m.id, m.title, m.status, m.media_type, m.duration,
               (SELECT COUNT(*) FROM sentences s WHERE s.material_id = m.id) AS sentence_count
        FROM materials m
        ORDER BY CASE WHEN m.status = 'ready' THEN 0 ELSE 1 END, m.created_at DESC
        """
    ).fetchall()
    return [dict(row) for row in rows]


def _phase_for_week(week: int) -> dict[str, Any]:
    for phase in PHASES:
        if phase["start_week"] <= week <= phase["end_week"]:
            return phase
    return PHASES[-1]


def _completed_by_day(conn: Any, plan_id: str) -> dict[date, set[str]]:
    rows = conn.execute(
        """
        SELECT day, kind FROM study_plan_tasks
        WHERE plan_id = ? AND completed_at IS NOT NULL
        """,
        (plan_id,),
    ).fetchall()
    result: dict[date, set[str]] = {}
    for row in rows:
        try:
            day = date.fromisoformat(row["day"])
        except ValueError:
            continue
        result.setdefault(day, set()).add(row["kind"])
    return result


def _progress(
    completed: dict[date, set[str]],
    start: date,
    today: date,
) -> dict[str, Any]:
    elapsed = max(0, min(PLAN_DAYS, (today - start).days + 1))
    active_days = len(completed)
    full_days = sum(1 for kinds in completed.values() if len(kinds) >= len(TASKS))
    completed_total = sum(len(kinds) for kinds in completed.values())
    completion_rate = (
        min(1.0, completed_total / (max(1, elapsed) * len(TASKS))) if elapsed else 0.0
    )

    streak = 0
    cursor = today if today in completed else today - timedelta(days=1)
    while cursor >= start and cursor in completed:
        streak += 1
        cursor -= timedelta(days=1)

    week_days: list[dict[str, Any]] = []
    for offset in range(6, -1, -1):
        day = today - timedelta(days=offset)
        in_plan = start <= day <= start + timedelta(days=PLAN_DAYS - 1)
        total = len(TASKS) if in_plan else 0
        done = len(completed.get(day, set())) if in_plan else 0
        week_days.append(
            {
                "date": day.isoformat(),
                "label": WEEKDAY_LABELS[day.weekday()],
                "completed": done,
                "total": total,
                "is_today": day == today,
            }
        )

    return {
        "completed_today": len(completed.get(today, set())),
        "completed_total": completed_total,
        "active_days": active_days,
        "full_days": full_days,
        "streak": streak,
        "completion_rate": round(completion_rate, 3),
        "week_days": week_days,
    }


def _task_payload(
    conn: Any,
    kind: str,
    material_id: str | None,
    completed: set[str],
) -> dict[str, Any]:
    definition = next(task for task in TASKS if task["kind"] == kind)
    if kind == "review":
        route = "/review"
        action_label = "开始"
    elif kind == "conversation":
        route = "/talk"
        action_label = "开始"
    elif material_id:
        route = {
            "listening": f"/player/{material_id}",
            "dictation": f"/dictation/{material_id}",
            "shadowing": f"/shadow/{material_id}",
        }[kind]
        action_label = "开始"
    else:
        route = "/library"
        action_label = "去选素材"
    return {
        **definition,
        "completed": kind in completed,
        "route": route,
        "action_label": action_label,
    }


def _plan_payload(
    conn: Any,
    plan: dict[str, Any],
    today: date,
) -> dict[str, Any]:
    start = date.fromisoformat(plan["start_date"])
    raw_day_index = (today - start).days + 1
    day_index = max(0, min(PLAN_DAYS, raw_day_index))
    week_number = min(24, max(1, (max(1, day_index) - 1) // 7 + 1))
    finished = raw_day_index > PLAN_DAYS
    material = _material(conn, plan.get("material_id"))
    material_id = material["id"] if material else None
    completed = _completed_by_day(conn, plan["id"])
    today_done = completed.get(today, set())
    progress = _progress(completed, start, today)

    return {
        "id": plan["id"],
        "start_date": plan["start_date"],
        "end_date": (start + timedelta(days=PLAN_DAYS - 1)).isoformat(),
        "week_number": week_number,
        "day_index": day_index,
        "total_days": PLAN_DAYS,
        "finished": finished,
        "phase": _phase_for_week(week_number),
        "material": material,
        "tasks": [
            _task_payload(conn, task["kind"], material_id, today_done) for task in TASKS
        ],
        "progress": progress,
    }


def _response(conn: Any, today: date) -> dict[str, Any]:
    plan = _active_plan(conn)
    return {
        "plan": _plan_payload(conn, plan, today) if plan else None,
        "phases": PHASES,
        "materials": _material_options(conn),
    }


class PlanStart(BaseModel):
    material_id: str | None = None
    start_date: str | None = None


class PlanPatch(BaseModel):
    material_id: str | None = None


class TaskToggle(BaseModel):
    completed: bool


def _validate_material(conn: Any, material_id: str | None) -> str | None:
    if material_id is None:
        return None
    material_id = material_id.strip()
    if not material_id:
        return None
    row = conn.execute("SELECT id FROM materials WHERE id = ?", (material_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=400, detail="素材不存在")
    return material_id


@router.get("")
def get_plan() -> dict[str, Any]:
    today = _local_today()
    with db.get_conn() as conn:
        return _response(conn, today)


@router.post("")
def start_plan(payload: PlanStart) -> dict[str, Any]:
    today = _local_today()
    start = today
    if payload.start_date:
        try:
            start = date.fromisoformat(payload.start_date)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="开始日期格式不正确") from exc

    with db.get_conn() as conn:
        material_id = _validate_material(conn, payload.material_id)
        now = _now_iso()
        conn.execute(
            "UPDATE study_plans SET archived_at = ?, updated_at = ? WHERE archived_at IS NULL",
            (now, now),
        )
        conn.execute(
            """
            INSERT INTO study_plans
                (id, start_date, material_id, created_at, updated_at, archived_at)
            VALUES (?, ?, ?, ?, ?, NULL)
            """,
            (uuid.uuid4().hex, start.isoformat(), material_id, now, now),
        )
        return _response(conn, today)


@router.patch("")
def update_plan(payload: PlanPatch) -> dict[str, Any]:
    today = _local_today()
    with db.get_conn() as conn:
        plan = _active_plan(conn)
        if not plan:
            raise HTTPException(status_code=404, detail="还没有开始学习计划")
        if "material_id" in payload.model_fields_set:
            material_id = _validate_material(conn, payload.material_id)
            conn.execute(
                "UPDATE study_plans SET material_id = ?, updated_at = ? WHERE id = ?",
                (material_id, _now_iso(), plan["id"]),
            )
        return _response(conn, today)


@router.post("/tasks/{kind}")
def toggle_task(kind: str, payload: TaskToggle) -> dict[str, Any]:
    if kind not in TASK_KINDS:
        raise HTTPException(status_code=400, detail="未知的任务类型")
    today = _local_today()
    day = today.isoformat()
    with db.get_conn() as conn:
        plan = _active_plan(conn)
        if not plan:
            raise HTTPException(status_code=404, detail="还没有开始学习计划")
        if payload.completed:
            conn.execute(
                """
                INSERT INTO study_plan_tasks (plan_id, day, kind, completed_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(plan_id, day, kind)
                DO UPDATE SET completed_at = excluded.completed_at
                """,
                (plan["id"], day, kind, _now_iso()),
            )
        else:
            conn.execute(
                "DELETE FROM study_plan_tasks WHERE plan_id = ? AND day = ? AND kind = ?",
                (plan["id"], day, kind),
            )
        return _response(conn, today)


@router.delete("")
def reset_plan() -> dict[str, bool]:
    with db.get_conn() as conn:
        plan = _active_plan(conn)
        if not plan:
            raise HTTPException(status_code=404, detail="还没有开始学习计划")
        conn.execute("DELETE FROM study_plans WHERE id = ?", (plan["id"],))
    return {"ok": True}
