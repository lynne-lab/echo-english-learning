from __future__ import annotations

import json
import re
import subprocess
import uuid
import wave
from pathlib import Path
from typing import Any

from . import azure_speech, config, db, llm, tencent_speech, transcribe, tts
from .media import probe_media
from .shadow_review import llm_settings

SCENARIOS: list[dict[str, str]] = [
    {
        "id": "daily",
        "title": "日常闲聊",
        "description": "生活、兴趣、今天发生的事",
        "setting": "casual everyday small talk with a friendly conversation partner",
    },
    {
        "id": "interview",
        "title": "求职面试",
        "description": "自我介绍、经历、职业规划",
        "setting": "a friendly job interview for an English-speaking role",
    },
    {
        "id": "travel",
        "title": "旅行出行",
        "description": "机场、酒店、问路、点餐",
        "setting": "travelling abroad and handling everyday travel situations",
    },
    {
        "id": "ielts",
        "title": "雅思口语",
        "description": "Part 1 / 2 / 3 风格问答",
        "setting": "an IELTS speaking practice session",
    },
    {
        "id": "work",
        "title": "职场沟通",
        "description": "会议、同事协作、汇报",
        "setting": "everyday workplace communication with an English-speaking colleague",
    },
    {
        "id": "restaurant",
        "title": "餐厅点餐",
        "description": "点单、口味、结账",
        "setting": "ordering food at a restaurant",
    },
]

LEVELS: dict[str, str] = {
    "beginner": "初级：能用简单句表达日常意思，词汇量有限",
    "intermediate": "中级：能完成日常交流，偶尔卡顿或用词不准",
    "advanced": "高级：表达比较流利，希望提升自然度和准确度",
}

OPENING_FALLBACK: dict[str, str] = {
    "daily": "Hi! It's great to see you. How has your day been so far?",
    "interview": "Thanks for coming in today. Could you start by telling me a little about yourself?",
    "travel": "Welcome! You've just landed in a new city. How was your flight?",
    "ielts": "Let's begin with a simple question. What do you usually do at the weekend?",
    "work": "Good morning! Before our meeting, how is your week going?",
    "restaurant": "Good evening! Welcome to our restaurant. Are you ready to order, or would you like to hear today's specials?",
}

TTS_RATE = "+0%"


class ConversationError(RuntimeError):
    pass


def _scenario(scenario_id: str) -> dict[str, str]:
    for item in SCENARIOS:
        if item["id"] == scenario_id:
            return item
    raise ValueError("未知的对话场景")


def scenarios() -> list[dict[str, str]]:
    return [{key: item[key] for key in ("id", "title", "description")} for item in SCENARIOS]


def _parse_json_object(value: str | None) -> dict[str, Any]:
    if not value:
        return {}
    text = value.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        text = text[start : end + 1]
    try:
        data = json.loads(text)
    except (TypeError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _turn_payload(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "role": row["role"],
        "text": row["text"],
        "meta": _parse_json_object(row["meta_json"]),
        "created_at": row["created_at"],
    }


def _conversation_payload(row: Any, turns: list[Any]) -> dict[str, Any]:
    report = _parse_json_object(row["report_json"])
    return {
        "id": row["id"],
        "scenario": row["scenario"],
        "scenario_title": row["scenario_title"],
        "level": row["level"],
        "voice": row["voice"],
        "model": row["model"],
        "status": row["status"],
        "report_markdown": row["report_markdown"],
        "report": report,
        "created_at": row["created_at"],
        "finished_at": row["finished_at"],
        "turns": [_turn_payload(turn) for turn in turns],
    }


def _load(conversation_id: str) -> Any:
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM conversations WHERE id = ?", (conversation_id,)
        ).fetchone()
    if not row:
        raise LookupError("对话不存在")
    return row


def _turns(conversation_id: str) -> list[Any]:
    with db.get_conn() as conn:
        return conn.execute(
            """
            SELECT * FROM conversation_turns
            WHERE conversation_id = ?
            ORDER BY created_at ASC, rowid ASC
            """,
            (conversation_id,),
        ).fetchall()


def get_conversation(conversation_id: str) -> dict[str, Any]:
    row = _load(conversation_id)
    return _conversation_payload(row, _turns(conversation_id))


def list_conversations(limit: int = 50) -> list[dict[str, Any]]:
    with db.get_conn() as conn:
        rows = conn.execute(
            """
            SELECT c.*,
                   (SELECT COUNT(*) FROM conversation_turns t
                    WHERE t.conversation_id = c.id) AS turn_count,
                   (SELECT COUNT(*) FROM conversation_turns t
                    WHERE t.conversation_id = c.id AND t.role = 'user') AS user_turn_count,
                   (SELECT t.text FROM conversation_turns t
                    WHERE t.conversation_id = c.id AND t.role = 'user'
                    ORDER BY t.created_at DESC, t.rowid DESC LIMIT 1) AS preview
            FROM conversations c
            ORDER BY c.created_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [
        {
            "id": row["id"],
            "scenario": row["scenario"],
            "scenario_title": row["scenario_title"],
            "level": row["level"],
            "voice": row["voice"],
            "status": row["status"],
            "turn_count": int(row["turn_count"]),
            "user_turn_count": int(row["user_turn_count"]),
            "preview": (row["preview"] or "")[:80],
            "created_at": row["created_at"],
            "finished_at": row["finished_at"],
        }
        for row in rows
    ]


def _system_prompt(scenario: dict[str, str], level: str) -> str:
    return f"""You are Echo, a warm and patient English speaking partner for a Chinese learner.
Scenario: {scenario['setting']}.
Learner level: {LEVELS.get(level, LEVELS['intermediate'])}.

Rules:
- Speak natural conversational English only.
- Always use grammatically correct, well-formed English; never imitate or repeat learner mistakes.
- Reply in 1-3 short sentences, then ask exactly one follow-up question.
- Match the learner's level: use simple words for beginners, richer phrasing for advanced learners.
- Never correct grammar or pronunciation during the conversation; keep the flow going.
- Do not mention that this is a practice exercise, a model, or a scenario prompt.
- If the learner is stuck, offer one simple sentence they could say, then continue."""


def _history(conversation_id: str, limit: int = 12) -> list[dict[str, str]]:
    with db.get_conn() as conn:
        rows = conn.execute(
            """
            SELECT role, text FROM conversation_turns
            WHERE conversation_id = ? AND role IN ('user', 'assistant')
            ORDER BY created_at DESC, rowid DESC
            LIMIT ?
            """,
            (conversation_id, limit),
        ).fetchall()
    messages = [
        {"role": row["role"], "content": row["text"]}
        for row in reversed(rows)
        if (row["text"] or "").strip()
    ]
    return messages


def _chat_json(
    messages: list[dict[str, str]],
    *,
    max_tokens: int,
    temperature: float,
    timeout: float,
) -> str:
    """Ask for a JSON object, retrying without response_format if unsupported."""
    settings = llm_settings()
    kwargs = {
        "base_url": settings["base_url"],
        "api_key": settings["api_key"],
        "model": settings["model"],
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "timeout": timeout,
    }
    try:
        return llm.chat(**kwargs, response_format={"type": "json_object"})
    except llm.LLMError as exc:
        message = str(exc).lower()
        if "response_format" in message or "http 400" in message:
            return llm.chat(**kwargs)
        raise


def _insert_turn(
    conversation_id: str,
    role: str,
    text: str,
    meta: dict[str, Any] | None = None,
    audio_path: str | None = None,
    duration: float | None = None,
) -> str:
    turn_id = uuid.uuid4().hex
    with db.get_conn() as conn:
        conn.execute(
            """
            INSERT INTO conversation_turns
                (id, conversation_id, role, text, meta_json, audio_path, duration, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                turn_id,
                conversation_id,
                role,
                text,
                json.dumps(meta or {}, ensure_ascii=False),
                audio_path,
                duration,
                db.now_iso(),
            ),
        )
    return turn_id


def _llm_reply(conversation_id: str, scenario: dict[str, str], level: str) -> str:
    settings = llm_settings()
    messages = [{"role": "system", "content": _system_prompt(scenario, level)}]
    messages.extend(_history(conversation_id))
    return llm.chat(
        base_url=settings["base_url"],
        api_key=settings["api_key"],
        model=settings["model"],
        messages=messages,
        max_tokens=180,
        temperature=0.75,
        timeout=60,
    )


def create_conversation(scenario_id: str, level: str, voice: str) -> dict[str, Any]:
    scenario = _scenario(scenario_id)
    if level not in LEVELS:
        level = "intermediate"
    if voice not in tts.voice_ids():
        voice = tts.DEFAULT_VOICE
    settings = llm_settings()
    conversation_id = uuid.uuid4().hex
    with db.get_conn() as conn:
        conn.execute(
            """
            INSERT INTO conversations
                (id, scenario, scenario_title, level, voice, model, status,
                 report_markdown, report_json, created_at, finished_at)
            VALUES (?, ?, ?, ?, ?, ?, 'active', '', '{}', ?, NULL)
            """,
            (
                conversation_id,
                scenario["id"],
                scenario["title"],
                level,
                voice,
                settings["model"],
                db.now_iso(),
            ),
        )
    try:
        opening = llm.chat(
            base_url=settings["base_url"],
            api_key=settings["api_key"],
            model=settings["model"],
            messages=[
                {"role": "system", "content": _system_prompt(scenario, level)},
                {
                    "role": "user",
                    "content": "Start the conversation now with a friendly opening (1-2 sentences) and your first question.",
                },
            ],
            max_tokens=140,
            temperature=0.7,
            timeout=60,
        )
    except llm.LLMError:
        with db.get_conn() as conn:
            conn.execute("DELETE FROM conversations WHERE id = ?", (conversation_id,))
        raise
    if not opening.strip():
        opening = OPENING_FALLBACK.get(scenario["id"], "Hi! How are you today?")
    _insert_turn(conversation_id, "assistant", opening, {"opening": True})
    return get_conversation(conversation_id)


def audio_dir(conversation_id: str) -> Path:
    if config.settings is None:
        raise ConversationError("数据目录未初始化")
    directory = config.settings.data_dir / "conversation-audio" / conversation_id
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _convert_to_wav(source: Path, conversation_id: str) -> Path:
    destination = audio_dir(conversation_id) / f"{uuid.uuid4().hex}.16k.wav"
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-loglevel",
            "error",
            "-i",
            str(source),
            "-ar",
            "16000",
            "-ac",
            "1",
            "-c:a",
            "pcm_s16le",
            str(destination),
        ],
        check=True,
        timeout=120,
        capture_output=True,
    )
    return destination


def _wav_seconds(path: Path) -> float:
    try:
        with wave.open(str(path), "rb") as handle:
            frames = handle.getnframes()
            rate = handle.getframerate() or 1
            return frames / rate
    except (wave.Error, OSError):
        return 0.0


def submit_turn(
    conversation_id: str,
    source: Path,
    content_type: str | None = None,
) -> dict[str, Any]:
    row = _load(conversation_id)
    if row["status"] != "active":
        raise ValueError("这次对话已经结束，不能再继续发言")
    if not db.get_setting("llm_api_key", ""):
        raise ValueError("请先在设置页配置 AI 对话服务")

    scenario = _scenario(row["scenario"])
    wav_path: Path | None = None
    try:
        wav_path = _convert_to_wav(source, conversation_id)
        details = transcribe.transcribe_short_audio_details(str(wav_path))
        duration = round(_wav_seconds(wav_path), 2)
    finally:
        if wav_path is not None:
            wav_path.unlink(missing_ok=True)

    text = (details.get("text") or "").strip()
    if not text:
        raise ValueError("没有听清你的发音，请靠近麦克风再说一次")

    reply = _llm_reply(conversation_id, scenario, row["level"])
    user_turn_id = _insert_turn(
        conversation_id,
        "user",
        text,
        {
            "weak_words": details.get("weak_words") or [],
            "duration": duration,
        },
        audio_path=str(source.resolve()),
        duration=duration,
    )
    assistant_turn_id = _insert_turn(
        conversation_id, "assistant", reply, {"model": row["model"]}
    )
    with db.get_conn() as conn:
        user_row = conn.execute(
            "SELECT * FROM conversation_turns WHERE id = ?", (user_turn_id,)
        ).fetchone()
        assistant_row = conn.execute(
            "SELECT * FROM conversation_turns WHERE id = ?", (assistant_turn_id,)
        ).fetchone()
    return {
        "user_turn": _turn_payload(user_row),
        "assistant_turn": _turn_payload(assistant_row),
    }


def hint(conversation_id: str) -> dict[str, Any]:
    row = _load(conversation_id)
    if row["status"] != "active":
        raise ValueError("这次对话已经结束")
    scenario = _scenario(row["scenario"])
    history = _history(conversation_id, limit=4)
    last = history[-1]["content"] if history else ""
    prompt = f"""The learner has been silent for a while in this conversation.
Last thing said: {last}
Give ONE natural English sentence the learner could say next, and a short Chinese explanation.
Keep the English sentence simple and under 16 words. Output JSON only:
{{"english": "...", "chinese": "..."}}"""
    raw = _chat_json(
        [
            {"role": "system", "content": _system_prompt(scenario, row["level"])},
            {"role": "user", "content": prompt},
        ],
        max_tokens=180,
        temperature=0.5,
        timeout=60,
    )
    data = _parse_json_object(raw)
    english = str(data.get("english") or "").strip()
    chinese = str(data.get("chinese") or "").strip()
    if not english:
        raise llm.LLMError("提示生成失败，请再试一次")
    turn_id = _insert_turn(
        conversation_id, "hint", english, {"chinese": chinese}
    )
    with db.get_conn() as conn:
        turn_row = conn.execute(
            "SELECT * FROM conversation_turns WHERE id = ?", (turn_id,)
        ).fetchone()
    return {"hint": _turn_payload(turn_row)}


REPORT_SYSTEM = """你是英语口语教练，负责在一次英语对话练习结束后给中国学习者写复盘。
只能依据提供的对话文本和分析数据，不得编造学习者没说过的话。
发音部分只能依据「识别把握较低的词」做谨慎推测：说明这是可能发音不清的线索，不是音素级诊断。
所有解释用简体中文；原句、改写句和练习句用英文。
只输出 JSON，不要 Markdown、不要代码围栏，结构如下：
{
  "overall": "2-3 句总体评价",
  "grammar": [{"original": "学习者原句", "better": "更自然的表达", "note": "中文说明"}],
  "expression": [{"original": "学习者原句", "better": "更地道的表达", "note": "中文说明"}],
  "pronunciation": {"summary": "谨慎的发音观察", "suspected_words": ["word1"]},
  "fluency": "流利度观察",
  "suggestions": ["建议1", "建议2", "建议3"],
  "practice_sentences": [{"sentence": "英文跟读句", "focus": "练习重点"}]
}
grammar 和 expression 各最多 4 条；practice_sentences 给 3-4 句，优先用学习者说过但可以更自然的句子。"""


def _transcript_for_report(turns: list[Any]) -> str:
    lines: list[str] = []
    hint_count = 0
    for turn in turns:
        if turn["role"] == "hint":
            hint_count += 1
            continue
        if turn["role"] == "user":
            meta = _parse_json_object(turn["meta_json"])
            weak = meta.get("weak_words") or []
            suffix = f"（识别把握较低：{', '.join(weak)}）" if weak else ""
            lines.append(f"Learner: {turn['text']}{suffix}")
        elif turn["role"] == "assistant":
            lines.append(f"Partner: {turn['text']}")
    lines.append(f"（学习者共使用提示 {hint_count} 次）")
    return "\n".join(lines)


def _build_markdown(report: dict[str, Any]) -> str:
    def text(value: Any, fallback: str = "没有足够内容判断。") -> str:
        return str(value).strip() if isinstance(value, str) and value.strip() else fallback

    def pairs(key: str) -> str:
        items = report.get(key)
        if not isinstance(items, list) or not items:
            return "这次没有发现明显问题。"
        lines: list[str] = []
        for item in items[:4]:
            if not isinstance(item, dict):
                continue
            original = text(item.get("original"), "")
            better = text(item.get("better"), "")
            note = text(item.get("note"), "")
            if original and better:
                lines.append(f"- **{original}** → **{better}**\n  {note}")
        return "\n".join(lines) or "这次没有发现明显问题。"

    pronunciation = report.get("pronunciation")
    pron_summary = "这次没有足够的发音线索。"
    suspected: list[str] = []
    if isinstance(pronunciation, dict):
        pron_summary = text(pronunciation.get("summary"), pron_summary)
        words = pronunciation.get("suspected_words")
        if isinstance(words, list):
            suspected = [str(word) for word in words[:8] if str(word).strip()]

    suggestions = report.get("suggestions")
    suggestion_lines = ""
    if isinstance(suggestions, list) and suggestions:
        suggestion_lines = "\n".join(
            f"{index + 1}. {text(item, '')}"
            for index, item in enumerate(suggestions[:5])
        )
    practice = report.get("practice_sentences")
    practice_lines = ""
    if isinstance(practice, list) and practice:
        rows: list[str] = []
        for item in practice[:4]:
            if not isinstance(item, dict):
                continue
            sentence = text(item.get("sentence"), "")
            focus = text(item.get("focus"), "")
            if sentence:
                rows.append(f"- {sentence}" + (f"（{focus}）" if focus else ""))
        practice_lines = "\n".join(rows)

    parts = [
        "## 总体表现",
        text(report.get("overall")),
        "",
        "## 语法与用词",
        pairs("grammar"),
        "",
        "## 表达提升",
        pairs("expression"),
        "",
        "## 发音提示",
        pron_summary,
    ]
    if suspected:
        parts.append(
            "- 识别把握较低的词：" + "、".join(f"`{word}`" for word in suspected)
        )
    parts.extend(
        [
            "> 发音提示来自语音识别置信度，只能作为线索；真实音素分数请在下方跟读练习里获得。",
            "",
            "## 流利度",
            text(report.get("fluency")),
            "",
            "## 改进建议",
            suggestion_lines or "继续每天用英语描述一件小事。",
        ]
    )
    if practice_lines:
        parts.extend(["", "## 跟读练习句", practice_lines])
    return "\n".join(parts).strip()


def finish_conversation(conversation_id: str) -> dict[str, Any]:
    row = _load(conversation_id)
    if row["status"] == "finished":
        return get_conversation(conversation_id)
    turns = _turns(conversation_id)
    user_turns = [turn for turn in turns if turn["role"] == "user"]
    if not user_turns:
        raise ValueError("这次对话还没有你的发言，先聊几句再生成复盘")

    scenario = _scenario(row["scenario"])
    transcript = _transcript_for_report(turns)
    raw = _chat_json(
        [
            {"role": "system", "content": REPORT_SYSTEM},
            {
                "role": "user",
                "content": (
                    f"场景：{scenario['title']}\n"
                    f"学习者水平：{LEVELS.get(row['level'], row['level'])}\n\n"
                    f"对话记录：\n{transcript}"
                ),
            },
        ],
        max_tokens=1800,
        temperature=0.35,
        timeout=120,
    )
    report = _parse_json_object(raw)
    if not report:
        raise llm.LLMError("复盘结果解析失败，请重试")
    markdown = _build_markdown(report)
    with db.get_conn() as conn:
        conn.execute(
            """
            UPDATE conversations
            SET status = 'finished', report_markdown = ?, report_json = ?,
                finished_at = ?
            WHERE id = ?
            """,
            (
                markdown,
                json.dumps(report, ensure_ascii=False),
                db.now_iso(),
                conversation_id,
            ),
        )
    return get_conversation(conversation_id)


def delete_conversation(conversation_id: str) -> None:
    _load(conversation_id)
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT audio_path FROM conversation_turns WHERE conversation_id = ?",
            (conversation_id,),
        ).fetchall()
        conn.execute(
            "DELETE FROM conversation_turns WHERE conversation_id = ?",
            (conversation_id,),
        )
        conn.execute("DELETE FROM conversations WHERE id = ?", (conversation_id,))
    for turn in rows:
        path = turn["audio_path"]
        if path:
            Path(path).unlink(missing_ok=True)
    if config.settings is not None:
        directory = config.settings.data_dir / "conversation-audio" / conversation_id
        if directory.exists():
            for child in directory.iterdir():
                child.unlink(missing_ok=True)
            directory.rmdir()


def speech_credentials() -> tuple[str, dict[str, str]]:
    app_id = db.get_setting("tencent_speech_app_id", "") or ""
    secret_id = db.get_setting("tencent_speech_secret_id", "") or ""
    secret_key = db.get_setting("tencent_speech_secret_key", "") or ""
    if app_id and secret_id and secret_key:
        return (
            "tencent",
            {"app_id": app_id, "secret_id": secret_id, "secret_key": secret_key},
        )
    azure_key = db.get_setting("azure_speech_key", "") or ""
    azure_region = db.get_setting("azure_speech_region", "") or ""
    if azure_key and azure_region:
        return "azure", {"key": azure_key, "region": azure_region}
    raise ValueError("请先在设置页配置腾讯云智聆或 Azure 的评测凭据")


def _score_summary(result: dict[str, Any]) -> dict[str, Any]:
    words = result.get("words")
    weak_words: list[dict[str, Any]] = []
    if isinstance(words, list):
        for word in words:
            if not isinstance(word, dict):
                continue
            accuracy = word.get("accuracy")
            error = word.get("error_type")
            if error or (isinstance(accuracy, (int, float)) and accuracy < 80):
                weak_words.append(
                    {
                        "word": word.get("word"),
                        "accuracy": accuracy,
                        "error": error,
                    }
                )
    weak_words = weak_words[:8]
    phonemes: list[dict[str, Any]] = []
    for word in words if isinstance(words, list) else []:
        for phoneme in (word.get("phonemes") if isinstance(word, dict) else None) or []:
            if not isinstance(phoneme, dict):
                continue
            score = phoneme.get("score")
            if isinstance(score, (int, float)) and score < 70:
                phonemes.append(
                    {
                        "phoneme": phoneme.get("phoneme"),
                        "score": score,
                        "word": word.get("word"),
                        "error": phoneme.get("error_type"),
                    }
                )
    phonemes = phonemes[:8]
    return {
        "provider": result.get("provider"),
        "overall": result.get("pron_score", result.get("accuracy_score")),
        "accuracy": result.get("accuracy_score"),
        "fluency": result.get("fluency_score"),
        "integrity": result.get("completeness_score", result.get("integrity_score")),
        "weak_words": weak_words,
        "weak_phonemes": phonemes,
    }


def score_drill(
    conversation_id: str, source: Path, reference_text: str
) -> dict[str, Any]:
    _load(conversation_id)
    reference = (reference_text or "").strip()
    if not reference:
        raise ValueError("缺少参考句子")
    provider, credentials = speech_credentials()

    wav_path: Path | None = None
    try:
        wav_path = _convert_to_wav(source, conversation_id)
        seconds = _wav_seconds(wav_path)
        limit = (
            tencent_speech.MAX_AUDIO_SECONDS
            if provider == "tencent"
            else azure_speech.MAX_AUDIO_SECONDS
        )
        if seconds > limit:
            raise ValueError(f"跟读音频最长支持 {limit} 秒，请录短一点")

        if provider == "tencent":
            result = tencent_speech.score_wav(
                wav_path,
                reference,
                credentials["app_id"],
                credentials["secret_id"],
                credentials["secret_key"],
            )
            result.setdefault("provider", "tencent")
        else:
            result = azure_speech.score_wav(
                wav_path,
                reference,
                credentials["key"],
                credentials["region"],
            )
            result["provider"] = "azure"
    finally:
        if wav_path is not None:
            wav_path.unlink(missing_ok=True)

    ai_tip = None
    try:
        settings = llm_settings()
        summary = _score_summary(result)
        raw = llm.chat(
            base_url=settings["base_url"],
            api_key=settings["api_key"],
            model=settings["model"],
            messages=[
                {
                    "role": "system",
                    "content": (
                        "你是发音教练。根据跟读评分给中国学习者 1-2 句中文纠正建议，"
                        "必须引用具体的单词、音素或错误类型，不要空泛鼓励。只输出建议正文。"
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"跟读句子：{reference}\n"
                        f"评分摘要：{json.dumps(summary, ensure_ascii=False)}"
                    ),
                },
            ],
            max_tokens=180,
            temperature=0.3,
            timeout=45,
        )
        ai_tip = raw.strip() or None
    except Exception:
        ai_tip = None

    return {"result": result, "summary": _score_summary(result), "ai_tip": ai_tip}


def speak_text(conversation_id: str, text: str) -> Path:
    row = _load(conversation_id)
    content = (text or "").strip()
    if not content:
        raise ValueError("没有可朗读的文本")
    if len(content) > 300:
        content = content[:300]
    return tts.synthesize(content, row["voice"], TTS_RATE)


def speak(conversation_id: str, turn_id: str) -> Path:
    row = _load(conversation_id)
    with db.get_conn() as conn:
        turn = conn.execute(
            "SELECT * FROM conversation_turns WHERE id = ? AND conversation_id = ?",
            (turn_id, conversation_id),
        ).fetchone()
    if not turn:
        raise LookupError("对话消息不存在")
    if turn["role"] == "user":
        path = Path(turn["audio_path"] or "")
        if path.exists():
            return path
        raise LookupError("你的录音文件不存在")
    text = (turn["text"] or "").strip()
    if not text:
        raise LookupError("这条消息没有可朗读的文本")
    return tts.synthesize(text, row["voice"], TTS_RATE)
