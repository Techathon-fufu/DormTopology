"""Largest four-connected component on an origin-aligned 1 cm desktop grid."""

import math

from ..errors import SceneInputError
from ..geometry import (
    EPSILON,
    NUMERIC_EPSILON,
    footprint,
    footprints_overlap,
    rectangle,
)
from ..models import Scene
from ..rules import validate_scene

GRID_CELL_M = 0.01
# Computational budget for this prototype's 1 cm grid, not a physical-size limit.
MAX_GRID_CELLS = 1_000_000


class DesktopGrid:
    def __init__(self, scene: Scene):
        desk = scene["desk"]
        self.height = desk["top_height_m"]
        dimensions = (
            desk["width_m"] / GRID_CELL_M,
            desk["depth_m"] / GRID_CELL_M,
        )
        capacity_error = (
            f"desk: 1 cm grid exceeds prototype capacity of {MAX_GRID_CELLS} cells"
        )
        if not all(math.isfinite(value) for value in dimensions):
            raise SceneInputError(capacity_error, field="desk")
        self.nx, self.nz = (math.floor(value + NUMERIC_EPSILON) for value in dimensions)
        if max(self.nx, self.nz, self.nx * self.nz) > MAX_GRID_CELLS:
            raise SceneInputError(capacity_error, field="desk")
        self.all_cells = (1 << (self.nx * self.nz)) - 1
        self.left = sum(1 << (z * self.nx) for z in range(self.nz)) if self.nx else 0
        self.right = self.left << (self.nx - 1) if self.nx else 0
        self.reserved = 0
        self._cache: dict[tuple, int] = {}
        for zone in scene["reserved_zones"]:
            if zone["min"][1] <= self.height < zone["max"][1]:
                self.reserved |= self.polygon_mask(
                    rectangle(
                        (zone["min"][0], zone["max"][0], zone["min"][2], zone["max"][2])
                    )
                )

    def polygon_mask(self, polygon) -> int:
        key = tuple(polygon)
        if key in self._cache:
            return self._cache[key]
        x0 = max(0.0, min(p[0] for p in polygon))
        x1 = min(self.nx * GRID_CELL_M, max(p[0] for p in polygon))
        z0 = max(0.0, min(p[1] for p in polygon))
        z1 = min(self.nz * GRID_CELL_M, max(p[1] for p in polygon))
        if x1 <= x0 or z1 <= z0:
            self._cache[key] = 0
            return 0
        ix0 = max(0, math.floor(x0 / GRID_CELL_M + NUMERIC_EPSILON))
        ix1 = min(self.nx, math.ceil(x1 / GRID_CELL_M - NUMERIC_EPSILON))
        iz0 = max(0, math.floor(z0 / GRID_CELL_M + NUMERIC_EPSILON))
        iz1 = min(self.nz, math.ceil(z1 / GRID_CELL_M - NUMERIC_EPSILON))
        mask = 0
        axis_aligned = all(
            abs(polygon[i][0] - polygon[(i + 1) % 4][0]) < NUMERIC_EPSILON
            or abs(polygon[i][1] - polygon[(i + 1) % 4][1]) < NUMERIC_EPSILON
            for i in range(4)
        )
        if ix1 > ix0 and iz1 > iz0:
            for z in range(iz0, iz1):
                if axis_aligned:
                    mask |= ((1 << (ix1 - ix0)) - 1) << (z * self.nx + ix0)
                else:
                    for x in range(ix0, ix1):
                        cell = rectangle(
                            (
                                x * GRID_CELL_M,
                                (x + 1) * GRID_CELL_M,
                                z * GRID_CELL_M,
                                (z + 1) * GRID_CELL_M,
                            )
                        )
                        if footprints_overlap(polygon, cell):
                            mask |= 1 << (z * self.nx + x)
        self._cache[key] = mask
        return mask

    def item_mask(self, item: dict) -> int:
        if abs(item["position"][1] - self.height) > EPSILON + NUMERIC_EPSILON:
            return 0
        return self.polygon_mask(footprint(item))

    def occupied(self, items: list[dict]) -> int:
        mask = self.reserved
        for item in items:
            mask |= self.item_mask(item)
        return mask

    def largest_component(self, occupied: int) -> int:
        remaining = self.all_cells & ~occupied
        largest = 0
        # Integer bitsets flood the rectangular grid without allocating cell objects.
        while remaining:
            frontier = remaining & -remaining
            component = frontier
            while frontier:
                neighbors = (
                    ((frontier & ~self.right) << 1)
                    | ((frontier & ~self.left) >> 1)
                    | (frontier << self.nx)
                    | (frontier >> self.nx)
                )
                frontier = neighbors & remaining & ~component
                component |= frontier
            remaining &= ~component
            largest = max(largest, component.bit_count())
            if largest >= remaining.bit_count():
                break
        return largest


def measure_free_area(scene: Scene) -> float:
    """Measure one scene; comparison/baseline compatibility belongs to service."""
    validate_scene(scene)
    grid = DesktopGrid(scene)
    return round(
        grid.largest_component(grid.occupied(scene["items"])) * GRID_CELL_M**2, 10
    )
