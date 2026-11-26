# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path

from PyInstaller.utils.hooks import collect_all

root = Path(SPECPATH).resolve()

datas = []
binaries = []
hiddenimports = []

packages = [
    "faster_whisper",
    "ctranslate2",
    "av",
    "tokenizers",
    "huggingface_hub",
    "fastapi",
    "starlette",
    "uvicorn",
    "httptools",
    "websockets",
    "pydantic",
    "pydantic_core",
    "fsrs",
    "yt_dlp",
    "python_multipart",
    "multipart",
    "numpy",
    "onnxruntime",
    "certifi",
    "anyio",
    "httpx",
    "httpcore",
    "h11",
    "click",
    "jinja2",
    "yaml",
    "edge_tts",
    "aiohttp",
]

for package in packages:
    try:
        pkg_datas, pkg_binaries, pkg_hidden = collect_all(package)
        datas += pkg_datas
        binaries += pkg_binaries
        hiddenimports += pkg_hidden
    except Exception as exc:  # optional packages are skipped
        print(f"[sidecar.spec] skip {package}: {exc}")

hiddenimports += [
    "uvicorn.logging",
    "uvicorn.loops.auto",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan.on",
    "multipart",
    "python_multipart",
    "sidecar.app.api",
    "sidecar.app.reviews_api",
    "sidecar.app.dictation_api",
    "sidecar.app.recordings_api",
    "sidecar.app.plan_api",
    "sidecar.app.progress_api",
    "sidecar.app.module_state_api",
    "sidecar.app.stats_api",
    "sidecar.app.srs",
    "sidecar.app.cuda",
    "sidecar.app.azure_speech",
    "sidecar.app.tencent_speech",
    "sidecar.app.shadow_review",
    "sidecar.app.shadow_review_api",
    "sidecar.app.llm",
    "sidecar.app.conversation",
    "sidecar.app.conversation_api",
    "sidecar.app.tts",
    "websockets.asyncio.client",
    "websockets.legacy.client",
]

a = Analysis(
    [str(root / "sidecar" / "launcher.py")],
    pathex=[str(root)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "nvidia",
        "torch",
        "tensorflow",
        "matplotlib",
        "pandas",
        "scipy",
        "tkinter",
        "PyQt5",
        "PySide6",
        "IPython",
        "pytest",
    ],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="echo-sidecar",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="echo-sidecar",
)
