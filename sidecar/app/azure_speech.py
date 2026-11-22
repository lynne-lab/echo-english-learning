from __future__ import annotations

import base64
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

LANGUAGE = "en-US"
MAX_AUDIO_SECONDS = 30


class AzureSpeechError(Exception):
    """A user-facing Azure Speech error (never contains the subscription key)."""


def _number(value: Any) -> float | None:
    try:
        if value is None:
            return None
        return round(float(value), 1)
    except (TypeError, ValueError):
        return None


def _response_message(status_code: int, body: bytes) -> str:
    try:
        data = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        text = body.decode("utf-8", "replace").strip()
        return text[:500] or f"HTTP {status_code}"

    if isinstance(data, dict):
        error = data.get("error")
        if isinstance(error, dict):
            return str(error.get("message") or error.get("code") or data)[:500]
        if isinstance(error, str):
            return error[:500]
        for key in ("message", "Message", "ErrorMessage"):
            if data.get(key):
                return str(data[key])[:500]
        status = data.get("RecognitionStatus")
        if status:
            return f"识别状态 {status}"
        return json.dumps(data, ensure_ascii=False)[:500]
    return str(data)[:500]


def normalize_response(data: Any, region: str) -> dict[str, Any]:
    if not isinstance(data, dict):
        raise AzureSpeechError("Azure 返回了无法解析的结果")

    status = data.get("RecognitionStatus")
    if status and status != "Success":
        raise AzureSpeechError(f"Azure 没有成功识别语音（{status}）")

    nbest = data.get("NBest") or []
    if not nbest:
        raise AzureSpeechError("Azure 没有返回评分结果")
    best = nbest[0] if isinstance(nbest[0], dict) else {}

    # The REST API has returned both styles: scores nested in
    # PronunciationAssessment, and scores directly on NBest[0].
    assessment = best.get("PronunciationAssessment")
    if not isinstance(assessment, dict):
        assessment = best

    words: list[dict[str, Any]] = []
    for item in best.get("Words") or []:
        if not isinstance(item, dict):
            continue
        word_assessment = item.get("PronunciationAssessment")
        if not isinstance(word_assessment, dict):
            word_assessment = item
        phoneme_items = item.get("Phonemes") or []
        if not phoneme_items and isinstance(item.get("PronunciationAssessment"), dict):
            phoneme_items = item["PronunciationAssessment"].get("Phonemes") or []
        phonemes: list[dict[str, Any]] = []
        for phoneme in phoneme_items:
            if not isinstance(phoneme, dict):
                continue
            phoneme_assessment = phoneme.get("PronunciationAssessment")
            if not isinstance(phoneme_assessment, dict):
                phoneme_assessment = phoneme
            symbol = (
                phoneme.get("Phoneme")
                or phoneme.get("PhonemeSymbol")
                or phoneme.get("Symbol")
                or ""
            )
            phonemes.append(
                {
                    "phoneme": str(symbol),
                    "score": _number(phoneme_assessment.get("AccuracyScore")),
                }
            )
        words.append(
            {
                "word": str(item.get("Word") or item.get("Display") or ""),
                "accuracy": _number(word_assessment.get("AccuracyScore")),
                "error_type": word_assessment.get("ErrorType")
                or item.get("ErrorType")
                or None,
                "phonemes": phonemes,
            }
        )

    result = {
        "recognized_text": str(
            best.get("Display") or data.get("DisplayText") or ""
        ),
        "pron_score": _number(assessment.get("PronScore")),
        "accuracy_score": _number(assessment.get("AccuracyScore")),
        "fluency_score": _number(assessment.get("FluencyScore")),
        "completeness_score": _number(assessment.get("CompletenessScore")),
        "prosody_score": _number(assessment.get("ProsodyScore")),
        "words": words,
        "region": region,
        "scored_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    if result["pron_score"] is None:
        result["pron_score"] = result["accuracy_score"]
    return result


def _build_headers(key: str, reference_text: str, prosody: bool) -> dict[str, str]:
    parameters: dict[str, Any] = {
        "ReferenceText": reference_text,
        "GradingSystem": "HundredMark",
        "Granularity": "Phoneme",
        "Dimension": "Comprehensive",
        "EnableMiscue": True,
    }
    if prosody:
        parameters["EnableProsodyAssessment"] = True
    encoded = base64.b64encode(
        json.dumps(parameters, ensure_ascii=False).encode("utf-8")
    ).decode("ascii")
    return {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
        "Pronunciation-Assessment": encoded,
        "Accept": "application/json",
    }


def _post_audio(
    url: str,
    query: dict[str, str],
    headers: dict[str, str],
    audio: bytes,
) -> tuple[int, bytes]:
    full_url = f"{url}?{urllib.parse.urlencode(query)}"
    request = urllib.request.Request(
        full_url, data=audio, headers=headers, method="POST"
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return int(response.status), response.read()
    except urllib.error.HTTPError as exc:
        return int(exc.code), exc.read()
    except urllib.error.URLError as exc:
        raise AzureSpeechError(f"无法连接 Azure：{exc.reason}") from exc


def score_wav(
    wav_path: str | Path,
    reference_text: str,
    key: str,
    region: str,
) -> dict[str, Any]:
    if not key.strip():
        raise AzureSpeechError("还没有配置 Azure Speech 密钥")
    if not reference_text.strip():
        raise AzureSpeechError("参考文本为空，无法评分")
    region = region.strip().lower()
    if not re.fullmatch(r"[a-z0-9-]+", region):
        raise AzureSpeechError("Azure 区域格式不正确，例如 eastus")

    audio = Path(wav_path).read_bytes()
    if not audio:
        raise AzureSpeechError("录音文件为空")
    if len(audio) > 8 * 1024 * 1024:
        raise AzureSpeechError("录音文件过大，请控制在 30 秒以内")

    url = (
        f"https://{region}.stt.speech.microsoft.com/"
        "speech/recognition/conversation/cognitiveservices/v1"
    )
    query = {"language": LANGUAGE, "format": "detailed"}

    status, body = _post_audio(
        url, query, _build_headers(key, reference_text, prosody=True), audio
    )
    # Prosody assessment is not enabled on every resource type; fall
    # back to the base assessment once if Azure rejects the request.
    if status == 400:
        status, body = _post_audio(
            url, query, _build_headers(key, reference_text, prosody=False), audio
        )

    if status != 200:
        message = _response_message(status, body)
        if status == 401:
            message = "Azure 密钥无效或已过期"
        elif status == 403:
            message = "Azure 拒绝访问：请检查 Speech 资源和配额"
        elif status == 404:
            message = "Azure 区域不正确或服务不可用"
        elif status == 415:
            message = "Azure 不支持这个音频格式"
        raise AzureSpeechError(f"Azure 评分失败：{message}")

    try:
        data = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise AzureSpeechError("Azure 返回了无法解析的 JSON") from exc

    return normalize_response(data, region)
