"""Dictionary types use the wire contract's names without runtime dependencies."""

from typing import Literal, NotRequired, TypedDict

Vec3 = list[float]


class Issue(TypedDict):
    entity_id: str | None
    code: str
    message: str


class Port(TypedDict):
    id: str
    type: str
    local_position: Vec3
    local_direction: Vec3
    capacity: int
    confirmed: bool


class Item(TypedDict):
    id: str
    name: str
    category: str
    size_m: Vec3
    position: Vec3
    rotation_y_rad: float
    dimensions_source: str
    dimensions_confirmed: bool
    fixed: bool
    usage_frequency: str
    allowed_region_ids: list[str]
    allowed_rotations_y_rad: list[float]
    collision: dict
    ports: list[Port]
    image_url: str | None
    model_url: str | None
    generation: dict
    socket_count: NotRequired[int]


class Region(TypedDict):
    id: str
    surface_y_m: float
    bounds_xz_m: list[float]
    clearance_height_m: float


class BoxZone(TypedDict):
    id: str
    min: Vec3
    max: Vec3


class Desk(TypedDict):
    width_m: float
    depth_m: float
    top_height_m: float


class Wall(TypedDict):
    z_m: float
    bounds_xy_m: list[float]


class Scene(TypedDict):
    schema_version: str
    scene_id: str
    scene_revision: int
    baseline_id: str | None
    template_id: str
    desk: Desk
    wall: Wall
    items: list[Item]
    regions: list[Region]
    obstacles: list[BoxZone]
    reserved_zones: list[BoxZone]
    exposure_zones: list[BoxZone]
    routing_graph: dict
    cables: list[dict]


class LayoutCheck(TypedDict):
    geometry_valid: bool
    issues: list[Issue]


class PackingItem(TypedDict):
    item_id: str
    name: str
    model_url: str | None
    current_pos: Vec3
    target_pos: Vec3
    target_rotation_y_rad: float
    target_region_id: str | None
    placement_status: Literal["placed", "unchanged", "unplaced"]
    reason_code: str | None


class PackingResult(TypedDict):
    schema_version: str
    scene_id: str
    scene_revision: int
    status: Literal["success", "partial", "infeasible"]
    items: list[PackingItem]
    issues: list[Issue]
