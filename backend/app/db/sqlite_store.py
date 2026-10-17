"""Atomic compare-and-swap store for whole scene documents.

Each scene is a single JSON document stored in one row.  Every mutation is a
``BEGIN IMMEDIATE`` transaction guarded on the stored base-document hash so a
stale writer (revision reused after a concurrent result-only update) cannot
clobber newer state.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
from contextlib import closing
from pathlib import Path

from ..service.ports import StoreConflict


_SCHEMA = """
CREATE TABLE IF NOT EXISTS scenes (
    scene_id TEXT PRIMARY KEY,
    revision INTEGER NOT NULL,
    doc_hash TEXT NOT NULL,
    document TEXT NOT NULL
);
"""


def _hash(document: dict) -> str:
    payload = json.dumps(document, sort_keys=True, allow_nan=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


class SQLiteSceneStore:
    def __init__(self, path: str | Path):
        self.path = str(path)
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        with closing(self._connect()) as conn:
            conn.executescript(_SCHEMA)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, isolation_level=None, timeout=30.0)
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    # -- reads ---------------------------------------------------------------
    def load(self, scene_id: str, _=None) -> dict | None:
        with closing(self._connect()) as conn:
            row = conn.execute(
                "SELECT document FROM scenes WHERE scene_id = ?", (scene_id,)
            ).fetchone()
        return json.loads(row[0]) if row else None

    # -- writes --------------------------------------------------------------
    def insert(self, document: dict) -> None:
        scene_id = document["scene"]["scene_id"]
        payload = json.dumps(document, allow_nan=False)
        with self._lock, closing(self._connect()) as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                if conn.execute(
                    "SELECT 1 FROM scenes WHERE scene_id = ?", (scene_id,)
                ).fetchone():
                    raise StoreConflict(scene_id)
                conn.execute(
                    "INSERT INTO scenes (scene_id, revision, doc_hash, document)"
                    " VALUES (?, ?, ?, ?)",
                    (scene_id, document["scene"]["scene_revision"], _hash(document), payload),
                )
            except Exception:
                conn.execute("ROLLBACK")
                raise
            conn.execute("COMMIT")

    def compare_and_swap(
        self,
        scene_id: str,
        expected_revision: int,
        document: dict,
        base_document: dict | None = None,
    ) -> None:
        """Replace the stored document atomically.

        Guard matches both ``revision`` and the hash of ``base_document`` (the
        document the caller read) so an interleaved result-only update cannot be
        reverted.  When ``base_document`` is None only the revision is checked.
        """
        payload = json.dumps(document, allow_nan=False)
        expected_hash = _hash(base_document) if base_document is not None else None
        with self._lock, closing(self._connect()) as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                if expected_hash is None:
                    changed = conn.execute(
                        "UPDATE scenes SET revision = ?, doc_hash = ?, document = ?"
                        " WHERE scene_id = ? AND revision = ?",
                        (document["scene"]["scene_revision"], _hash(document), payload,
                         scene_id, expected_revision),
                    ).rowcount
                else:
                    changed = conn.execute(
                        "UPDATE scenes SET revision = ?, doc_hash = ?, document = ?"
                        " WHERE scene_id = ? AND revision = ? AND doc_hash = ?",
                        (document["scene"]["scene_revision"], _hash(document), payload,
                         scene_id, expected_revision, expected_hash),
                    ).rowcount
                if changed != 1:
                    raise StoreConflict(scene_id)
            except Exception:
                conn.execute("ROLLBACK")
                raise
            conn.execute("COMMIT")

    def close(self) -> None:
        return None
