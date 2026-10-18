"""Short SQLite transactions protect scene revisions and single-use plans."""

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from ..domain.models import Scene
from ..service.errors import Conflict, NotFound
from ..service.ports import SceneRecord


def timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def encode(value: dict) -> str:
    return json.dumps(value, ensure_ascii=True, allow_nan=False, sort_keys=True)


class SQLiteOrganizationRepository:
    def __init__(self, path: str | Path):
        self._uri = str(path) == ":memory:"
        self._keeper = None
        if self._uri:
            self._dsn = f"file:organization_{uuid4().hex}?mode=memory&cache=shared"
            self._keeper = sqlite3.connect(self._dsn, uri=True, check_same_thread=False)
        else:
            Path(path).expanduser().resolve().parent.mkdir(parents=True, exist_ok=True)
            self._dsn = str(Path(path).expanduser())
        with self._read() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.executescript(
                """
            CREATE TABLE IF NOT EXISTS scenes (
                scene_id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL UNIQUE,
                revision INTEGER NOT NULL,
                baseline_source_id TEXT NOT NULL,
                payload TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS baselines (
                baseline_id TEXT PRIMARY KEY,
                scene_id TEXT NOT NULL REFERENCES scenes(scene_id),
                payload TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS jobs (
                job_id TEXT PRIMARY KEY,
                scene_id TEXT NOT NULL REFERENCES scenes(scene_id),
                scene_revision INTEGER NOT NULL,
                status TEXT NOT NULL,
                consumed INTEGER NOT NULL DEFAULT 0,
                envelope TEXT NOT NULL,
                snapshot TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS jobs_scene ON jobs(scene_id, scene_revision);
            CREATE TABLE IF NOT EXISTS standalone_jobs (
                job_id TEXT PRIMARY KEY,
                kind TEXT NOT NULL,
                status TEXT NOT NULL,
                envelope TEXT NOT NULL
            );
            """
            )

    @contextmanager
    def _read(self):
        connection = sqlite3.connect(
            self._dsn, uri=self._uri, timeout=10, isolation_level=None
        )
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        try:
            yield connection
        finally:
            connection.close()

    @contextmanager
    def _transaction(self):
        with self._read() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                yield connection
            except BaseException:
                connection.rollback()
                raise
            else:
                connection.commit()

    @staticmethod
    def _record(row) -> SceneRecord | None:
        if row is None:
            return None
        return SceneRecord(
            row["project_id"], json.loads(row["payload"]), row["baseline_source_id"]
        )

    def get_project(self, project_id: str) -> SceneRecord | None:
        with self._read() as connection:
            return self._record(
                connection.execute(
                    "SELECT * FROM scenes WHERE project_id = ?", (project_id,)
                ).fetchone()
            )

    def get_scene(self, scene_id: str) -> SceneRecord | None:
        with self._read() as connection:
            return self._record(
                connection.execute(
                    "SELECT * FROM scenes WHERE scene_id = ?", (scene_id,)
                ).fetchone()
            )

    def get_baseline(self, baseline_id: str) -> Scene | None:
        with self._read() as connection:
            row = connection.execute(
                "SELECT payload FROM baselines WHERE baseline_id = ?", (baseline_id,)
            ).fetchone()
        return json.loads(row["payload"]) if row else None

    @staticmethod
    def _invalidate_pending(connection, scene_id: str) -> None:
        rows = connection.execute(
            "SELECT job_id, envelope FROM jobs WHERE scene_id = ? "
            "AND status IN ('queued', 'running')",
            (scene_id,),
        ).fetchall()
        for row in rows:
            envelope = json.loads(row["envelope"])
            envelope.update(
                status="failed",
                updated_at=timestamp(),
                stage="Scene changed; submit a new planning task",
                error={"code": "stale_scene", "message": "Scene revision changed"},
            )
            connection.execute(
                "UPDATE jobs SET status = 'failed', envelope = ? WHERE job_id = ?",
                (encode(envelope), row["job_id"]),
            )

    def save_scene(
        self,
        record: SceneRecord,
        expected_revision: int | None,
        baseline: Scene | None,
    ) -> None:
        scene = record.scene
        with self._transaction() as connection:
            current = connection.execute(
                "SELECT * FROM scenes WHERE project_id = ?", (record.project_id,)
            ).fetchone()
            if expected_revision is None:
                if current is not None:
                    raise Conflict(
                        "Project already has a scene; fetch its current revision"
                    )
                connection.execute(
                    "INSERT INTO scenes VALUES (?, ?, ?, ?, ?)",
                    (
                        scene["scene_id"],
                        record.project_id,
                        scene["scene_revision"],
                        record.baseline_source_id,
                        encode(scene),
                    ),
                )
            else:
                if (
                    current is None
                    or current["scene_id"] != scene["scene_id"]
                    or current["revision"] != expected_revision
                ):
                    raise Conflict("Scene revision changed; reload before saving")
                connection.execute(
                    "UPDATE scenes SET revision = ?, baseline_source_id = ?, payload = ? "
                    "WHERE scene_id = ? AND revision = ?",
                    (
                        scene["scene_revision"],
                        record.baseline_source_id,
                        encode(scene),
                        scene["scene_id"],
                        expected_revision,
                    ),
                )
                if scene["scene_revision"] != expected_revision:
                    self._invalidate_pending(connection, scene["scene_id"])
            if baseline is not None:
                connection.execute(
                    "INSERT INTO baselines VALUES (?, ?, ?)",
                    (baseline["baseline_id"], scene["scene_id"], encode(baseline)),
                )

    def create_job(self, envelope: dict, snapshot: Scene) -> None:
        with self._transaction() as connection:
            row = connection.execute(
                "SELECT revision FROM scenes WHERE scene_id = ?",
                (snapshot["scene_id"],),
            ).fetchone()
            if row is None or row["revision"] != snapshot["scene_revision"]:
                raise Conflict("Scene revision changed before task submission")
            connection.execute(
                "INSERT INTO jobs (job_id, scene_id, scene_revision, status, envelope, snapshot) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (
                    envelope["job_id"],
                    snapshot["scene_id"],
                    snapshot["scene_revision"],
                    envelope["status"],
                    encode(envelope),
                    encode(snapshot),
                ),
            )

    def create_standalone_job(self, envelope: dict) -> None:
        with self._transaction() as connection:
            connection.execute(
                "INSERT INTO standalone_jobs (job_id, kind, status, envelope) VALUES (?, ?, ?, ?)",
                (envelope["job_id"], envelope["kind"], envelope["status"], encode(envelope)),
            )

    def update_standalone_job(
        self,
        job_id: str,
        *,
        status: str | None = None,
        stage: str | None = None,
        progress: float | None = None,
        result: dict | None = None,
        error: dict | None = None,
    ) -> dict | None:
        with self._transaction() as connection:
            row = connection.execute(
                "SELECT envelope FROM standalone_jobs WHERE job_id = ?", (job_id,)
            ).fetchone()
            if row is None:
                return None
            envelope = json.loads(row["envelope"])
            if status is not None:
                envelope["status"] = status
            if stage is not None:
                envelope["stage"] = stage
            if progress is not None:
                envelope["progress"] = progress
            if result is not None:
                envelope["result"] = result
            if error is not None:
                envelope["error"] = error
            envelope["updated_at"] = timestamp()
            connection.execute(
                "UPDATE standalone_jobs SET status = ?, envelope = ? WHERE job_id = ?",
                (envelope["status"], encode(envelope), job_id),
            )
            return envelope

    def get_job(self, job_id: str) -> dict | None:
        with self._read() as connection:
            row = connection.execute(
                "SELECT envelope FROM jobs WHERE job_id = ?", (job_id,)
            ).fetchone()
            if row:
                return json.loads(row["envelope"])
            row = connection.execute(
                "SELECT envelope FROM standalone_jobs WHERE job_id = ?", (job_id,)
            ).fetchone()
            return json.loads(row["envelope"]) if row else None

    def claim_job(self, job_id: str) -> bool:
        with self._transaction() as connection:
            row = connection.execute(
                "SELECT status, envelope FROM jobs WHERE job_id = ?", (job_id,)
            ).fetchone()
            if row is None or row["status"] != "queued":
                return False
            envelope = json.loads(row["envelope"])
            envelope.update(
                status="running",
                stage=(
                    "Planning cables"
                    if envelope["kind"] == "cable"
                    else "Planning organization"
                ),
                updated_at=timestamp(),
            )
            connection.execute(
                "UPDATE jobs SET status = 'running', envelope = ? WHERE job_id = ?",
                (encode(envelope), job_id),
            )
            return True

    def finish_job(
        self, job_id: str, *, result: dict | None = None, error: dict | None = None
    ) -> None:
        with self._transaction() as connection:
            row = connection.execute(
                "SELECT * FROM jobs WHERE job_id = ?", (job_id,)
            ).fetchone()
            if row is None or row["status"] not in ("running", "queued"):
                return
            current = connection.execute(
                "SELECT revision FROM scenes WHERE scene_id = ?", (row["scene_id"],)
            ).fetchone()
            if current is None or current["revision"] != row["scene_revision"]:
                result = None
                error = {"code": "stale_scene", "message": "Scene revision changed"}
            envelope = json.loads(row["envelope"])
            envelope.update(
                status="failed" if error else "succeeded",
                stage="Failed" if error else (
                    "Cable plan ready"
                    if envelope["kind"] == "cable"
                    else "Organization plan ready"
                ),
                updated_at=timestamp(),
                result=result,
                error=error,
            )
            connection.execute(
                "UPDATE jobs SET status = ?, envelope = ? WHERE job_id = ?",
                (envelope["status"], encode(envelope), job_id),
            )

    def cancel_job(self, job_id: str) -> dict:
        with self._transaction() as connection:
            row = connection.execute(
                "SELECT * FROM jobs WHERE job_id = ?", (job_id,)
            ).fetchone()
            if row is not None:
                envelope = json.loads(row["envelope"])
                if row["status"] in ("queued", "running"):
                    envelope.update(
                        status="cancelled", stage="Cancelled", updated_at=timestamp()
                    )
                    connection.execute(
                        "UPDATE jobs SET status = 'cancelled', envelope = ? WHERE job_id = ?",
                        (encode(envelope), job_id),
                    )
                return envelope
            standalone_row = connection.execute(
                "SELECT * FROM standalone_jobs WHERE job_id = ?", (job_id,)
            ).fetchone()
            if standalone_row is None:
                raise NotFound("Job not found")
            envelope = json.loads(standalone_row["envelope"])
            if standalone_row["status"] in ("queued", "running"):
                envelope.update(
                    status="cancelled", stage="Cancelled", updated_at=timestamp()
                )
                connection.execute(
                    "UPDATE standalone_jobs SET status = 'cancelled', envelope = ? WHERE job_id = ?",
                    (encode(envelope), job_id),
                )
            return envelope

    def apply_job(self, job_id: str, scene: Scene, expected_revision: int) -> None:
        with self._transaction() as connection:
            job = connection.execute(
                "SELECT * FROM jobs WHERE job_id = ?", (job_id,)
            ).fetchone()
            current = connection.execute(
                "SELECT revision FROM scenes WHERE scene_id = ?", (scene["scene_id"],)
            ).fetchone()
            if (
                job is None
                or current is None
                or job["status"] != "succeeded"
                or job["consumed"]
                or job["scene_id"] != scene["scene_id"]
                or job["scene_revision"] != expected_revision
                or current["revision"] != expected_revision
            ):
                raise Conflict(
                    "Plan is stale, already applied, or does not match the scene"
                )
            connection.execute(
                "UPDATE scenes SET revision = ?, payload = ? WHERE scene_id = ? AND revision = ?",
                (
                    scene["scene_revision"],
                    encode(scene),
                    scene["scene_id"],
                    expected_revision,
                ),
            )
            envelope = json.loads(job["envelope"])
            envelope.update(
                applied=True,
                applied_scene_revision=scene["scene_revision"],
                updated_at=timestamp(),
            )
            connection.execute(
                "UPDATE jobs SET consumed = 1, envelope = ? WHERE job_id = ?",
                (encode(envelope), job_id),
            )
            self._invalidate_pending(connection, scene["scene_id"])

    def recover_incomplete_jobs(self) -> None:
        with self._transaction() as connection:
            rows = connection.execute(
                "SELECT job_id, envelope FROM jobs WHERE status IN ('queued', 'running')"
            ).fetchall()
            for row in rows:
                envelope = json.loads(row["envelope"])
                envelope.update(
                    status="failed",
                    stage="Service restarted",
                    updated_at=timestamp(),
                    error={
                        "code": "interrupted",
                        "message": "Service restarted; submit a new task",
                    },
                )
                connection.execute(
                    "UPDATE jobs SET status = 'failed', envelope = ? WHERE job_id = ?",
                    (encode(envelope), row["job_id"]),
                )
            standalone_rows = connection.execute(
                "SELECT job_id, envelope FROM standalone_jobs WHERE status IN ('queued', 'running')"
            ).fetchall()
            for row in standalone_rows:
                envelope = json.loads(row["envelope"])
                envelope.update(
                    status="failed",
                    stage="Service restarted",
                    updated_at=timestamp(),
                    error={
                        "code": "interrupted",
                        "message": "Service restarted; submit a new task",
                    },
                )
                connection.execute(
                    "UPDATE standalone_jobs SET status = 'failed', envelope = ? WHERE job_id = ?",
                    (encode(envelope), row["job_id"]),
                )

    def close(self) -> None:
        if self._keeper is not None:
            self._keeper.close()
            self._keeper = None
