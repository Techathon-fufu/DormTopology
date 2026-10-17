"""Bound running and queued work instead of growing an unbounded task queue."""

from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from threading import BoundedSemaphore

from .errors import CapacityExceeded


class LimitedExecutor:
    def __init__(self, *, max_workers: int = 2, max_pending: int = 8):
        if max_workers < 1 or max_pending < max_workers:
            raise ValueError("max_pending must be at least max_workers >= 1")
        self._slots = BoundedSemaphore(max_pending)
        self._pool = ThreadPoolExecutor(
            max_workers=max_workers, thread_name_prefix="planning"
        )

    def reserve(self) -> None:
        if not self._slots.acquire(blocking=False):
            raise CapacityExceeded("Planning task capacity reached; retry later")

    def release(self) -> None:
        self._slots.release()

    def submit(self, function: Callable[[], None]) -> Future:
        future = self._pool.submit(function)
        future.add_done_callback(lambda _: self.release())
        return future

    def close(self) -> None:
        self._pool.shutdown(wait=True, cancel_futures=True)
