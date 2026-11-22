from __future__ import annotations

import json
import tempfile
import unittest
import wave
from pathlib import Path

from sidecar.app import tencent_speech


SIGN_PARAMS = {
    "secretid": "AKIDEXAMPLE",
    "server_engine_type": "16k_en",
    "timestamp": 1700000000,
    "expired": 1700086400,
    "nonce": 17000000000,
    "voice_id": "0b9d6f1e-2c3a-4b5d-8e7f-1234567890ab",
    "eval_mode": 1,
    "score_coeff": 1,
    "voice_format": 0,
    "ref_text": "hello world",
    "sentence_info_enabled": 0,
}


class SigningTests(unittest.TestCase):
    def test_signature_matches_the_javascript_sdk(self) -> None:
        # Cross-checked with Node's crypto.createHmac("sha1", ...) using the
        # same string the official Tencent JS SDK builds.
        signature = tencent_speech.sign_params(
            "1300000000", "SECRETKEYEXAMPLE", SIGN_PARAMS
        )
        self.assertEqual(signature, "HhGFC9TZKvwvDytZbQE3Qnv7mvM=")

    def test_signed_url_contains_encoded_values(self) -> None:
        url = tencent_speech.build_signed_url(
            "1300000000", "AKIDEXAMPLE", "SECRETKEYEXAMPLE", "hello world"
        )
        self.assertTrue(
            url.startswith("wss://soe.cloud.tencent.com/soe/api/1300000000?")
        )
        self.assertIn("server_engine_type=16k_en", url)
        self.assertIn("ref_text=hello%20world", url)
        self.assertIn("&signature=", url)


class NormalizeTests(unittest.TestCase):
    def test_pascal_case_response(self) -> None:
        payload = {
            "code": 0,
            "final": 1,
            "result": {
                "PronAccuracy": 87.5,
                "PronFluency": 0.81,
                "PronCompletion": 0.95,
                "SuggestedScore": 78.9,
                "Words": [
                    {
                        "Word": "hello",
                        "MatchTag": 0,
                        "PronAccuracy": 90.0,
                        "PhoneInfos": [
                            {"Phone": "HH", "PronAccuracy": 88.0},
                            {"ReferencePhone": "AH0", "PronAccuracy": -1},
                        ],
                    },
                    {
                        "Word": "world",
                        "MatchTag": 3,
                        "PronAccuracy": 61.2,
                        "PhoneInfos": [],
                    },
                    {"Word": "um", "MatchTag": 1, "PronAccuracy": 50.0},
                    {"Word": "extra", "MatchTag": 2, "PronAccuracy": -1},
                ],
            },
        }
        result = tencent_speech.normalize_response(payload)

        self.assertEqual(result["provider"], "tencent")
        self.assertEqual(result["pron_score"], 78.9)
        self.assertEqual(result["accuracy_score"], 87.5)
        self.assertEqual(result["fluency_score"], 81.0)
        self.assertEqual(result["completeness_score"], 95.0)
        self.assertIsNone(result["prosody_score"])
        self.assertEqual(result["recognized_text"], "hello world um")

        self.assertEqual([word["error_type"] for word in result["words"]], [
            None,
            "Mispronunciation",
            "Insertion",
            "Omission",
        ])
        self.assertEqual(result["words"][0]["phonemes"], [
            {"phoneme": "HH", "score": 88.0},
            {"phoneme": "AH0", "score": None},
        ])

    def test_camel_case_response_without_result_wrapper(self) -> None:
        payload = {
            "code": 0,
            "final": 1,
            "pronAccuracy": 70,
            "pronFluency": 0.6,
            "pronCompletion": 0.8,
            "suggestedScore": 65,
            "words": [
                {
                    "word": "test",
                    "matchTag": 0,
                    "pronAccuracy": 70,
                    "phoneInfos": [{"phone": "T", "pronAccuracy": 70}],
                }
            ],
        }
        result = tencent_speech.normalize_response(payload)
        self.assertEqual(result["recognized_text"], "test")
        self.assertEqual(result["accuracy_score"], 70.0)
        self.assertEqual(result["words"][0]["phonemes"], [
            {"phoneme": "T", "score": 70.0}
        ])

    def test_error_code_is_raised(self) -> None:
        with self.assertRaises(tencent_speech.TencentSpeechError):
            tencent_speech.normalize_response(
                {"code": 10001, "message": "invalid signature"}
            )

    def test_failed_status_is_raised(self) -> None:
        with self.assertRaises(tencent_speech.TencentSpeechError):
            tencent_speech.normalize_response(
                {"code": 0, "final": 1, "result": {"Status": "Failed"}}
            )


class SocketFlowTests(unittest.IsolatedAsyncioTestCase):
    async def test_streams_audio_and_reads_final_result(self) -> None:
        from websockets.asyncio.server import serve

        received: list[bytes] = []

        async def handler(socket) -> None:
            async for message in socket:
                if isinstance(message, bytes):
                    received.append(message)
                    continue
                if json.loads(message).get("type") != "end":
                    continue
                await socket.send(
                    json.dumps(
                        {
                            "code": 0,
                            "final": 0,
                            "result": {"PronAccuracy": 10},
                        }
                    )
                )
                await socket.send(
                    json.dumps(
                        {
                            "code": 0,
                            "final": 1,
                            "result": {
                                "PronAccuracy": 80,
                                "PronFluency": 0.5,
                                "PronCompletion": 1.0,
                                "SuggestedScore": 80,
                                "Words": [
                                    {
                                        "Word": "hello",
                                        "MatchTag": 0,
                                        "PronAccuracy": 80,
                                    }
                                ],
                            },
                        }
                    )
                )

        async with serve(handler, "127.0.0.1", 0) as server:
            port = server.sockets[0].getsockname()[1]
            result = await tencent_speech._score_async(
                f"ws://127.0.0.1:{port}", b"\x00\x00" * 3200
            )

        self.assertEqual(len(received), 1)
        self.assertEqual(len(received[0]), 6400)
        self.assertEqual(result["accuracy_score"], 80.0)
        self.assertEqual(result["fluency_score"], 50.0)
        self.assertEqual(result["recognized_text"], "hello")


class PCMTests(unittest.TestCase):
    def _write_wav(self, path: Path, rate: int = 16000, frames: int = 1600) -> None:
        with wave.open(str(path), "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(rate)
            wav.writeframes(b"\x00\x00" * frames)

    def test_reads_16k_mono_pcm(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "audio.wav"
            self._write_wav(path)
            pcm = tencent_speech._read_pcm(path)
            self.assertEqual(len(pcm), 3200)

    def test_rejects_other_sample_rates(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "audio.wav"
            self._write_wav(path, rate=44100)
            with self.assertRaises(tencent_speech.TencentSpeechError):
                tencent_speech._read_pcm(path)


if __name__ == "__main__":
    unittest.main()
