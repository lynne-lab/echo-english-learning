from __future__ import annotations

import json
import statistics
import uuid
from datetime import datetime, timezone
from typing import Any

from . import db, llm

DEFAULT_LLM_BASE_URL = "https://api.deepseek.com/v1"
DEFAULT_LLM_MODEL = "deepseek-chat"

WORD_WEAK_SCORE = 75.0
PHONEME_WEAK_SCORE = 70.0

SYSTEM_PROMPT = """你是一名严谨、具体的英语发音教练，面向中文母语的英语学习者。

你会收到一篇文章逐句跟读的机器评测汇总，包含两类数据：
1. local：本地 Whisper 把学习者的录音识别成文字后，与原句做词级对比。local_accuracy 是 0-1 的单词准确率，能发现漏读、多读、听错，但不能定位具体音素。
2. phoneme：在线音素评测（腾讯云智聆或 Azure）的结果。word.accuracy 和 phoneme.score 都是 0-100，error_type 可能是 Mispronunciation（读错）、Omission（漏读）、Insertion（多读）。
数据中已按阈值筛出薄弱单词（<75）和薄弱音素（<70）。

规则：
- 只能依据提供的数据推断，不得编造数据中没有的单词、音素、分数或句子内容。
- 明确区分「证据」与「推测」；如果音素数据缺失或覆盖不足，要直说，不要假装有。
- 引用具体句子编号、单词和分数。按问题严重程度排序。
- 建议必须可执行：口腔位置/发音要领、最小对立对、重音与连读、具体跟读步骤。
- 不要写空泛的鼓励；不要重复罗列所有数据。

请输出简体中文 Markdown，严格使用以下结构：
## 总体评价
## 主要发音问题
## 薄弱单词与音素
## 改进方案
## 下一轮跟读建议

篇幅控制在 900–1400 字。"""

USER_PROMPT_TEMPLATE = """以下是复盘数据（JSON）：
{data}

补充说明：
- 句子编号 index 从 1 开始，对应文章中的第几句。
- 音素符号采用评测服务返回的写法（例如 th、r、l、ae）。
- 请结合文本内容，指出这些薄弱词/音素在具体句子中应该怎样读。"""


def llm_settings() -> dict[str, str]:
    base_url = db.get_setting("llm_base_url", "") or DEFAULT_LLM_BASE_URL
    api_key = db.get_setting("llm_api_key", "") or ""
    model = db.get_setting("llm_model", "") or DEFAULT_LLM_MODEL
    return {"base_url": base_url, "api_key": api_key, "model": model}


def llm_configured() -> bool:
    values = llm_settings()
    return bool(values["base_url"] and values["api_key"] and values["model"])


def _parse_json(value: str | None) -> dict[str, Any] | None:
    if not value:
        return None
    try:
        data = json.loads(value)
    except (TypeError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def _mean(values: list[float]) -> float | None:
    return round(statistics.fmean(values), 1) if values else None


def _bands(values: list[float]) -> dict[str, int]:
    bands = {"90+": 0, "80-89": 0, "70-79": 0, "60-69": 0, "<60": 0}
    for value in values:
        if value >= 90:
            bands["90+"] += 1
        elif value >= 80:
            bands["80-89"] += 1
        elif value >= 70:
            bands["70-79"] += 1
        elif value >= 60:
            bands["60-69"] += 1
        else:
            bands["<60"] += 1
    return bands


def _local_summary(feedback: dict[str, Any]) -> dict[str, Any]:
    tokens = feedback.get("tokens") or []
    missing: list[str] = []
    typos: list[dict[str, str]] = []
    wrong: list[dict[str, str]] = []
    extra: list[str] = []
    for token in tokens:
        if not isinstance(token, dict):
            continue
        kind = token.get("kind")
        expected = token.get("expected")
        actual = token.get("actual")
        if kind == "missing" and expected:
            missing.append(str(expected))
        elif kind == "typo" and expected and actual:
            typos.append({"expected": str(expected), "actual": str(actual)})
        elif kind == "wrong" and expected and actual:
            wrong.append({"expected": str(expected), "actual": str(actual)})
        elif kind == "extra" and actual:
            extra.append(str(actual))
    return {
        "accuracy": round(float(feedback.get("accuracy") or 0), 3),
        "word_correct": feedback.get("word_correct"),
        "scored_total": feedback.get("scored_total"),
        "errors": feedback.get("errors"),
        "missing": missing[:8],
        "typos": typos[:8],
        "wrong": wrong[:8],
        "extra": extra[:8],
        "recognized": str(feedback.get("recognized_text") or "")[:240],
    }


def _phoneme_summary(pronunciation: dict[str, Any]) -> dict[str, Any]:
    weak_words: list[dict[str, Any]] = []
    weak_phonemes: list[dict[str, Any]] = []
    words = pronunciation.get("words") or []
    for word in words:
        if not isinstance(word, dict):
            continue
        text = str(word.get("word") or "").strip()
        if not text:
            continue
        accuracy = word.get("accuracy")
        accuracy_value = (
            float(accuracy) if isinstance(accuracy, (int, float)) else None
        )
        error_type = word.get("error_type")
        weak = (
            error_type in ("Omission", "Mispronunciation", "Insertion")
            or (accuracy_value is not None and accuracy_value < WORD_WEAK_SCORE)
        )
        phonemes = []
        for phone in word.get("phonemes") or []:
            if not isinstance(phone, dict):
                continue
            symbol = str(phone.get("phoneme") or "").strip()
            score = phone.get("score")
            if not symbol or not isinstance(score, (int, float)):
                continue
            phonemes.append({"phoneme": symbol, "score": round(float(score), 1)})
            if float(score) < PHONEME_WEAK_SCORE:
                weak_phonemes.append(
                    {"word": text, "phoneme": symbol, "score": round(float(score), 1)}
                )
        if weak:
            weak_words.append(
                {
                    "word": text,
                    "accuracy": round(accuracy_value, 1)
                    if accuracy_value is not None
                    else None,
                    "error_type": error_type,
                    "phonemes": phonemes,
                }
            )
    return {
        "provider": pronunciation.get("provider") or "tencent",
        "pron_score": pronunciation.get("pron_score"),
        "accuracy_score": pronunciation.get("accuracy_score"),
        "fluency_score": pronunciation.get("fluency_score"),
        "completeness_score": pronunciation.get("completeness_score"),
        "weak_words": weak_words[:12],
        "weak_phonemes": weak_phonemes[:12],
    }


def _collect(material_id: str) -> dict[str, Any]:
    material = db.get_material(material_id)
    if not material:
        raise LookupError("素材不存在")
    sentences = db.list_sentences(material_id)
    with db.get_conn() as conn:
        rows = conn.execute(
            """
            SELECT * FROM recordings
            WHERE material_id = ?
            ORDER BY created_at DESC
            """,
            (material_id,),
        ).fetchall()

    by_sentence: dict[str, list[Any]] = {}
    for row in rows:
        by_sentence.setdefault(row["sentence_id"], []).append(row)

    items: list[dict[str, Any]] = []
    recorded = local_scored = phoneme_scored = 0
    providers: dict[str, int] = {}
    local_scores: list[float] = []
    pron_scores: list[float] = []

    for sentence in sentences:
        sentence_rows = by_sentence.get(sentence["id"], [])
        if sentence_rows:
            recorded += 1
        local = None
        pronunciation = None
        for row in sentence_rows:
            if local is None and row["feedback_json"]:
                feedback = _parse_json(row["feedback_json"])
                if feedback:
                    local = _local_summary(feedback)
                    local_scored += 1
                    local_scores.append(local["accuracy"] * 100)
            if pronunciation is None and row["azure_json"]:
                parsed = _parse_json(row["azure_json"])
                if parsed:
                    pronunciation = _phoneme_summary(parsed)
                    phoneme_scored += 1
                    provider = pronunciation["provider"]
                    providers[provider] = providers.get(provider, 0) + 1
                    if isinstance(parsed.get("pron_score"), (int, float)):
                        pron_scores.append(float(parsed["pron_score"]))
            if local is not None and pronunciation is not None:
                break

        if local is None and pronunciation is None:
            continue
        items.append(
            {
                "index": int(sentence["idx"]) + 1,
                "text": sentence["text"],
                "local": local,
                "phoneme": pronunciation,
            }
        )

    return {
        "material": material,
        "sentence_count": len(sentences),
        "items": items,
        "recorded": recorded,
        "local_scored": local_scored,
        "phoneme_scored": phoneme_scored,
        "providers": providers,
        "local_scores": local_scores,
        "pron_scores": pron_scores,
    }


def coverage(material_id: str) -> dict[str, Any]:
    data = _collect(material_id)
    return {
        "material_id": material_id,
        "material_title": data["material"]["title"],
        "sentence_count": data["sentence_count"],
        "recorded": data["recorded"],
        "local_scored": data["local_scored"],
        "phoneme_scored": data["phoneme_scored"],
        "phoneme_providers": data["providers"],
        "all_recorded": data["recorded"] >= data["sentence_count"] > 0,
        "llm_configured": llm_configured(),
        "llm_model": llm_settings()["model"],
    }


def _aggregate(data: dict[str, Any]) -> dict[str, Any]:
    word_stats: dict[str, dict[str, Any]] = {}
    phoneme_stats: dict[str, dict[str, Any]] = {}
    missing: dict[str, dict[str, Any]] = {}
    typos: dict[str, dict[str, Any]] = {}
    wrong: dict[str, dict[str, Any]] = {}
    extra: dict[str, dict[str, Any]] = {}

    def bump(
        bucket: dict[str, dict[str, Any]],
        key: str,
        index: int,
        *,
        display: str | None = None,
        pair: str | None = None,
    ) -> None:
        entry = bucket.setdefault(
            key,
            {"word": display or key, "count": 0, "sentences": set(), "pair": pair},
        )
        entry["count"] += 1
        entry["sentences"].add(index)

    for item in data["items"]:
        index = item["index"]
        local = item.get("local")
        if local:
            for word in local["missing"]:
                bump(missing, str(word).lower(), index, display=str(word))
            for pair in local["typos"]:
                key = f"{pair['expected'].lower()}→{pair['actual'].lower()}"
                bump(
                    typos,
                    key,
                    index,
                    display=f"{pair['expected']} / {pair['actual']}",
                    pair=key,
                )
            for pair in local["wrong"]:
                key = f"{pair['expected'].lower()}→{pair['actual'].lower()}"
                bump(
                    wrong,
                    key,
                    index,
                    display=f"{pair['expected']} / {pair['actual']}",
                    pair=key,
                )
            for word in local["extra"]:
                bump(extra, str(word).lower(), index, display=str(word))

        pronunciation = item.get("phoneme")
        if not pronunciation:
            continue
        for word in pronunciation["weak_words"]:
            key = word["word"].lower()
            entry = word_stats.setdefault(
                key,
                {
                    "word": word["word"],
                    "scores": [],
                    "error_types": set(),
                    "sentences": set(),
                    "phonemes": {},
                },
            )
            if isinstance(word["accuracy"], (int, float)):
                entry["scores"].append(float(word["accuracy"]))
            if word.get("error_type"):
                entry["error_types"].add(word["error_type"])
            entry["sentences"].add(index)
            for phone in word.get("phonemes") or []:
                score = phone.get("score")
                if isinstance(score, (int, float)) and float(score) < PHONEME_WEAK_SCORE:
                    symbol = phone["phoneme"]
                    entry["phonemes"].setdefault(symbol, []).append(float(score))
                    phoneme_entry = phoneme_stats.setdefault(
                        symbol, {"scores": [], "words": set(), "sentences": set()}
                    )
                    phoneme_entry["scores"].append(float(score))
                    phoneme_entry["words"].add(word["word"])
                    phoneme_entry["sentences"].add(index)

    weak_words = []
    for entry in word_stats.values():
        scores = entry["scores"]
        weak_words.append(
            {
                "word": entry["word"],
                "occurrences": len(entry["sentences"]),
                "avg_accuracy": _mean(scores),
                "worst_accuracy": round(min(scores), 1) if scores else None,
                "error_types": sorted(entry["error_types"]),
                "sentences": sorted(entry["sentences"])[:8],
                "weak_phonemes": [
                    {
                        "phoneme": symbol,
                        "avg_score": _mean(values),
                        "count": len(values),
                    }
                    for symbol, values in entry["phonemes"].items()
                ],
            }
        )
    weak_words.sort(
        key=lambda item: (
            item["avg_accuracy"] if item["avg_accuracy"] is not None else 0,
            -item["occurrences"],
        )
    )

    weak_phonemes = []
    for symbol, entry in phoneme_stats.items():
        weak_phonemes.append(
            {
                "phoneme": symbol,
                "occurrences": len(entry["scores"]),
                "avg_score": _mean(entry["scores"]),
                "min_score": round(min(entry["scores"]), 1),
                "words": sorted(entry["words"])[:6],
                "sentences": sorted(entry["sentences"])[:8],
            }
        )
    weak_phonemes.sort(key=lambda item: item["avg_score"] or 0)

    def simplify(bucket: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
        rows = [
            {
                "word": entry["word"],
                "count": entry["count"],
                "sentences": sorted(entry["sentences"])[:8],
            }
            for entry in bucket.values()
        ]
        rows.sort(key=lambda item: (-item["count"], item["word"]))
        return rows[:12]

    def score_rank(item: dict[str, Any]) -> float:
        pronunciation = item.get("phoneme") or {}
        if isinstance(pronunciation.get("pron_score"), (int, float)):
            return float(pronunciation["pron_score"])
        local = item.get("local") or {}
        return float(local.get("accuracy") or 0) * 100

    ranked = sorted(
        [item for item in data["items"] if item.get("local") or item.get("phoneme")],
        key=score_rank,
    )
    worst_sentences = [
        {
            "index": item["index"],
            "text": item["text"][:180],
            "local": item.get("local"),
            "phoneme": item.get("phoneme"),
            "score": round(score_rank(item), 1),
        }
        for item in ranked[:10]
    ]

    local_scores = data["local_scores"]
    pron_scores = data["pron_scores"]
    error_totals: dict[str, int] = {}
    for item in data["items"]:
        local = item.get("local") or {}
        for key, value in (local.get("errors") or {}).items():
            error_totals[key] = error_totals.get(key, 0) + int(value or 0)

    return {
        "material": {
            "title": data["material"]["title"],
            "sentence_count": data["sentence_count"],
        },
        "coverage": {
            "recorded": data["recorded"],
            "local_scored": data["local_scored"],
            "phoneme_scored": data["phoneme_scored"],
            "phoneme_providers": data["providers"],
            "note": "phoneme_scored 为有在线音素评分的句子数；其余句子只有本地词级评测。",
        },
        "overall": {
            "mean_local_accuracy_pct": _mean(local_scores),
            "mean_pron_score": _mean(pron_scores),
            "local_score_bands": _bands(local_scores),
            "pron_score_bands": _bands(pron_scores),
            "local_error_totals": error_totals,
        },
        "weak_words": weak_words[:20],
        "weak_phonemes": weak_phonemes[:12],
        "local_errors": {
            "missing": simplify(missing),
            "typos": simplify(typos),
            "wrong": simplify(wrong),
            "extra": simplify(extra),
        },
        "worst_sentences": worst_sentences,
        "score_hints": {
            "local_accuracy": "0-1，越高越好",
            "pron_score": "0-100，越高越好",
            "weak_thresholds": {
                "word": WORD_WEAK_SCORE,
                "phoneme": PHONEME_WEAK_SCORE,
            },
        },
    }


def _save(report: dict[str, Any]) -> None:
    with db.get_conn() as conn:
        conn.execute(
            """
            INSERT INTO shadow_reviews
                (id, material_id, material_title, model,
                 coverage_json, report_markdown, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                report["id"],
                report["material_id"],
                report["material_title"],
                report["model"],
                json.dumps(report["coverage"], ensure_ascii=False),
                report["report_markdown"],
                report["created_at"],
            ),
        )


def generate(material_id: str) -> dict[str, Any]:
    data = _collect(material_id)
    if not data["items"]:
        raise ValueError("这篇文章还没有任何跟读评测数据，先录几句再来复盘")
    settings = llm_settings()
    if not (settings["base_url"] and settings["api_key"] and settings["model"]):
        raise ValueError("请先在设置页配置 AI 复盘服务（Base URL、API Key、模型）")

    aggregated = _aggregate(data)
    user_prompt = USER_PROMPT_TEMPLATE.format(
        data=json.dumps(aggregated, ensure_ascii=False, indent=1)
    )
    markdown = llm.chat(
        base_url=settings["base_url"],
        api_key=settings["api_key"],
        model=settings["model"],
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
    )
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    report = {
        "id": uuid.uuid4().hex,
        "material_id": material_id,
        "material_title": data["material"]["title"],
        "model": settings["model"],
        "coverage": aggregated["coverage"],
        "overall": aggregated["overall"],
        "report_markdown": markdown,
        "created_at": now,
    }
    _save(report)
    return report


def archives() -> list[dict[str, Any]]:
    """Review groups kept after their material was deleted."""
    with db.get_conn() as conn:
        rows = conn.execute(
            """
            SELECT material_id,
                   MAX(material_title) AS material_title,
                   COUNT(*) AS review_count,
                   MAX(created_at) AS last_created_at
            FROM shadow_reviews
            WHERE material_id NOT IN (SELECT id FROM materials)
            GROUP BY material_id
            ORDER BY last_created_at DESC
            """
        ).fetchall()
    return [
        {
            "material_id": row["material_id"],
            "material_title": row["material_title"],
            "review_count": int(row["review_count"]),
            "last_created_at": row["last_created_at"],
        }
        for row in rows
    ]


def list_reviews(material_id: str, limit: int = 20) -> list[dict[str, Any]]:
    with db.get_conn() as conn:
        rows = conn.execute(
            """
            SELECT id, material_id, material_title, model, coverage_json, created_at
            FROM shadow_reviews
            WHERE material_id = ?
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (material_id, limit),
        ).fetchall()
    return [
        {
            "id": row["id"],
            "material_id": row["material_id"],
            "material_title": row["material_title"],
            "model": row["model"],
            "coverage": _parse_json(row["coverage_json"]) or {},
            "created_at": row["created_at"],
        }
        for row in rows
    ]


def get_review(review_id: str) -> dict[str, Any]:
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM shadow_reviews WHERE id = ?", (review_id,)
        ).fetchone()
    if not row:
        raise LookupError("复盘记录不存在")
    return {
        "id": row["id"],
        "material_id": row["material_id"],
        "material_title": row["material_title"],
        "model": row["model"],
        "coverage": _parse_json(row["coverage_json"]) or {},
        "report_markdown": row["report_markdown"],
        "created_at": row["created_at"],
    }


def delete_review(review_id: str) -> None:
    with db.get_conn() as conn:
        cursor = conn.execute(
            "DELETE FROM shadow_reviews WHERE id = ?", (review_id,)
        )
        if cursor.rowcount == 0:
            raise LookupError("复盘记录不存在")
