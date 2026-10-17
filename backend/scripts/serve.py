"""Run the local application backend without changing the global Python setup."""

import argparse
import importlib.util
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
if importlib.util.find_spec("fastapi") is None:
    local_dependencies = ROOT / ".work" / "closed-loop" / "python-deps"
    if local_dependencies.is_dir():
        sys.path.insert(0, str(local_dependencies))


def main():
    parser = argparse.ArgumentParser(description="DormTopology local API")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    import uvicorn

    uvicorn.run("backend.app.bootstrap:create_app", factory=True,
                host=args.host, port=args.port)


if __name__ == "__main__":
    main()
