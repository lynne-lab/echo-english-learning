from __future__ import annotations

import argparse
import logging
import os
import sys
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Echo local engine")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--data-dir", default=None)
    args = parser.parse_args()

    os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        stream=sys.stdout,
    )

    data_dir = (
        Path(args.data_dir).expanduser()
        if args.data_dir
        else Path(__file__).resolve().parents[2] / "data"
    )

    from . import config

    config.init(data_dir)

    from .cuda import add_cuda_dll_directories

    added = add_cuda_dll_directories()
    if added:
        logging.getLogger(__name__).info("registered CUDA DLL directories: %s", added)

    from .db import init_db

    init_db()

    from .api import app

    import uvicorn

    logging.getLogger(__name__).info("Echo engine listening on 127.0.0.1:%s", args.port)
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="info", access_log=False)


if __name__ == "__main__":
    main()
