"""Tencent Cloud Smart Oral Evaluation (智聆口语评测, SOE) adapter.

The service is a WebSocket API: connect with a signed URL, stream 16 kHz
mono 16-bit PCM frames, send ``{"type": "end"}`` and read result frames until
``final == 1``.  Results are normalised into the same shape used by
``azure_speech.normalize_response`` so the UI can display either provider.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import re
import time
import urllib.parse
import uuid
import wave
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

LANGUAGE = "en-US"
MAX_AUDIO_SECONDS = 60
SAMPLE_RATE = 16000
SAMPLE_WIDTH = 2
CHANNELS = 1
FRAME_BYTES = 6400  # 200 ms of 16 kHz mono 16-bit PCM
CONNECT_TIMEOUT = 15
RESULT_TIMEOUT = 90
# 评测苛刻指数：1.0 偏宽松（官方默认），4.0 最严格。成人学习者可调到 3。
SCORE_COEFF = 1
HOST = "soe.cloud.tencent.com"

# SOE MatchTag -> the error names the UI already knows.
MATCH_TAGS: dict[int, str | None] = {
    0: None,  # 匹配
    1: "Insertion",  # 新增单词（多读）
    2: "Omission",  # 缺少单词（漏读）
    3: "Mispronunciation",  # 错读
    4: None,  # 未录入单词
}


class TencentSpeechError(Exception):
    """A user-facing SOE error (never contains the secret key)."""


def _field(data: Any, *names: str) -> Any:
    """Read a field from either PascalCase or camelCase payloads."""
    if not isinstance(data, dict):
        return None
    for name in names:
        if name in data:
            return data[name]
    lowered = {str(key).lower(): value for key, value in data.items()}
    for name in names:
        value = lowered.get(name.lower())
        if value is not None:
            return value
    return None


def _first_value(data: Any, *names: str) -> Any:
    """Return the first present, non-empty field among aliases."""
    for name in names:
        value = _field(data, name)
        if value not in (None, ""):
            return value
    return None


def _accuracy(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number < 0:  # -1 表示完全不匹配
        return None
    return round(min(number, 100.0), 1)


def _ratio(value: Any) -> float | None:
    """SOE returns fluency/completion as 0-1; the UI expects 0-100."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number < 0:
        return None
    score = number * 100 if number <= 1.5 else number
    return round(min(score, 100.0), 1)


def _int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _normalise_words(raw_words: Any) -> tuple[list[dict[str, Any]], str]:
    words: list[dict[str, Any]] = []
    spoken: list[str] = []
    for item in raw_words or []:
        if not isinstance(item, dict):
            continue
        text = str(_field(item, "Word", "word") or "").strip()
        tag = _int(_field(item, "MatchTag", "matchTag", "match_tag"))
        phonemes: list[dict[str, Any]] = []
        phone_items = _field(
            item, "PhoneInfos", "phoneInfos", "phone_infos", "Phonemes"
        ) or []
        for phone in phone_items:
            if not isinstance(phone, dict):
                continue
            symbol = _first_value(
                phone,
                "ReferencePhone",
                "referencePhone",
                "reference_phone",
                "Phone",
                "phone",
            )
            phonemes.append(
                {
                    "phoneme": str(symbol or ""),
                    "score": _accuracy(
                        _field(
                            phone,
                            "PronAccuracy",
                            "pronAccuracy",
                            "pron_accuracy",
                        )
                    ),
                }
            )
        words.append(
            {
                "word": text,
                "accuracy": _accuracy(
                    _field(
                        item,
                        "PronAccuracy",
                        "pronAccuracy",
                        "pron_accuracy",
                    )
                ),
                "error_type": MATCH_TAGS.get(tag),
                "phonemes": phonemes,
            }
        )
        if text and tag != 2:  # 2 = 参考文本里有、但没读出来
            spoken.append(text)
    return words, " ".join(spoken)


def normalize_response(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise TencentSpeechError("腾讯云返回了无法解析的结果")

    code = payload.get("code")
    if code not in (None, 0, "0"):
        message = payload.get("message") or payload.get("msg") or code
        raise TencentSpeechError(f"腾讯云评测失败：{message}")

    result = payload.get("result")
    if not isinstance(result, dict):
        result = payload

    status = _field(result, "Status", "status")
    if isinstance(status, str) and status.lower() == "failed":
        raise TencentSpeechError("腾讯云评测失败，录音可能太小或与原文差异过大")

    words, recognized = _normalise_words(
        _field(result, "Words", "words") or []
    )
    accuracy = _accuracy(
        _field(result, "PronAccuracy", "pronAccuracy", "pron_accuracy")
    )
    fluency = _ratio(
        _field(result, "PronFluency", "pronFluency", "pron_fluency")
    )
    completeness = _ratio(
        _field(result, "PronCompletion", "pronCompletion", "pron_completion")
    )
    suggested = _accuracy(
        _field(result, "SuggestedScore", "suggestedScore", "suggested_score")
    )

    return {
        "provider": "tencent",
        "recognized_text": recognized,
        "pron_score": suggested if suggested is not None else accuracy,
        "accuracy_score": accuracy,
        "fluency_score": fluency,
        "completeness_score": completeness,
        "prosody_score": None,
        "words": words,
        "region": "tencent",
        "scored_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def _read_pcm(wav_path: str | Path) -> bytes:
    try:
        with wave.open(str(wav_path), "rb") as wav:
            channels = wav.getnchannels()
            width = wav.getsampwidth()
            rate = wav.getframerate()
            frames = wav.readframes(wav.getnframes())
    except (wave.Error, OSError) as exc:
        raise TencentSpeechError("录音不是有效的 WAV 文件") from exc

    if channels != CHANNELS or width != SAMPLE_WIDTH or rate != SAMPLE_RATE:
        raise TencentSpeechError("音频需要是 16kHz 单声道 16bit WAV")
    if not frames:
        raise TencentSpeechError("录音文件为空")

    duration = len(frames) / (SAMPLE_RATE * SAMPLE_WIDTH * CHANNELS)
    if duration > MAX_AUDIO_SECONDS:
        raise TencentSpeechError(
            f"腾讯云评测最长支持 {MAX_AUDIO_SECONDS} 秒，请录制更短的片段"
        )
    if len(frames) % 2:
        frames = frames[:-1]
    return frames


def sign_params(
    app_id: str, secret_key: str, params: dict[str, Any]
) -> str:
    sign_source = (
        f"{HOST}/soe/api/{app_id}?"
        + "&".join(f"{key}={params[key]}" for key in sorted(params))
    )
    digest = hmac.new(
        secret_key.encode("utf-8"),
        sign_source.encode("utf-8"),
        hashlib.sha1,
    ).digest()
    return base64.b64encode(digest).decode("ascii")


def build_signed_url(
    app_id: str, secret_id: str, secret_key: str, reference_text: str
) -> str:
    now = int(time.time())
    params: dict[str, Any] = {
        "secretid": secret_id,
        "server_engine_type": "16k_en",
        "timestamp": now,
        "expired": now + 24 * 60 * 60,
        "nonce": int(round(now / 100)),  # matches the official JS SDK
        "voice_id": str(uuid.uuid4()),
        "eval_mode": 1,  # 句子模式
        "score_coeff": SCORE_COEFF,
        "voice_format": 0,  # pcm
        "ref_text": reference_text,
        "sentence_info_enabled": 0,
    }
    signature = sign_params(app_id, secret_key, params)

    query = "&".join(
        f"{key}={urllib.parse.quote(str(params[key]), safe='')}"
        for key in sorted(params)
    )
    return (
        f"wss://{HOST}/soe/api/{urllib.parse.quote(app_id, safe='')}"
        f"?{query}&signature={urllib.parse.quote(signature, safe='')}"
    )


def _connect():
    try:  # websockets >= 13
        from websockets.asyncio.client import connect
    except ImportError:  # websockets <= 12
        from websockets.client import connect  # type: ignore[no-redef]
    return connect


async def _score_async(url: str, pcm: bytes) -> dict[str, Any]:
    connect = _connect()
    try:
        async with connect(
            url,
            max_size=16 * 1024 * 1024,
            open_timeout=CONNECT_TIMEOUT,
            close_timeout=3,
            ping_interval=None,
        ) as socket:
            for offset in range(0, len(pcm), FRAME_BYTES):
                await socket.send(pcm[offset : offset + FRAME_BYTES])
                # Pace slightly so the stream stays close to real time.
                await asyncio.sleep(0.005)
            await socket.send(json.dumps({"type": "end"}))

            deadline = time.monotonic() + RESULT_TIMEOUT
            last_payload: dict[str, Any] | None = None
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TencentSpeechError("腾讯云评测超时，请稍后重试")
                message = await asyncio.wait_for(
                    socket.recv(), timeout=remaining
                )
                if isinstance(message, bytes):
                    continue
                try:
                    payload = json.loads(message)
                except ValueError:
                    continue
                if not isinstance(payload, dict):
                    continue
                if payload.get("code") not in (None, 0, "0"):
                    reason = payload.get("message") or payload.get("code")
                    raise TencentSpeechError(f"腾讯云评测失败：{reason}")
                if isinstance(payload.get("result"), dict):
                    last_payload = payload
                if payload.get("final") == 1:
                    if isinstance(payload.get("result"), dict):
                        return normalize_response(payload)
                    if last_payload is not None:
                        return normalize_response(last_payload)
                    return normalize_response(payload)
    except TencentSpeechError:
        raise
    except asyncio.TimeoutError as exc:
        raise TencentSpeechError("腾讯云评测超时，请稍后重试") from exc
    except Exception as exc:  # websockets raises several connection errors
        name = type(exc).__name__
        if name.startswith("ConnectionClosed"):
            raise TencentSpeechError("腾讯云提前关闭了连接，请重试") from exc
        if name in ("InvalidStatus", "InvalidStatusCode"):
            raise TencentSpeechError(
                "腾讯云拒绝连接：请检查 AppID、SecretId、SecretKey 是否匹配，"
                "以及智聆口语评测是否已开通"
            ) from exc
        if name == "SSLCertVerificationError":
            raise TencentSpeechError(
                "无法验证腾讯云证书，请检查系统时间或网络代理"
            ) from exc
        if isinstance(exc, TimeoutError):
            raise TencentSpeechError("连接腾讯云超时，请检查网络") from exc
        raise TencentSpeechError(
            f"无法连接腾讯云评测服务（{name}）"
        ) from exc


def score_wav(
    wav_path: str | Path,
    reference_text: str,
    app_id: str,
    secret_id: str,
    secret_key: str,
) -> dict[str, Any]:
    app_id = (app_id or "").strip()
    secret_id = (secret_id or "").strip()
    secret_key = (secret_key or "").strip()
    reference_text = (reference_text or "").strip()

    if not app_id or not secret_id or not secret_key:
        raise TencentSpeechError("还没有配置腾讯云智聆的 AppID / SecretId / SecretKey")
    if not re.fullmatch(r"\d{5,20}", app_id):
        raise TencentSpeechError("腾讯云 AppID 应该是纯数字")
    if len(secret_id) < 8 or len(secret_key) < 8:
        raise TencentSpeechError("腾讯云 SecretId 或 SecretKey 看起来不完整")
    if not reference_text:
        raise TencentSpeechError("参考文本为空，无法评分")

    pcm = _read_pcm(wav_path)
    url = build_signed_url(app_id, secret_id, secret_key, reference_text)
    return asyncio.run(_score_async(url, pcm))
