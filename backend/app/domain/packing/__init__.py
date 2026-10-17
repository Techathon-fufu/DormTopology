"""C's pure Python public entry points; dictionaries serialize directly to JSON."""

from ..errors import SceneInputError as PackingInputError
from .area import measure_free_area
from .check import validate_layout
from .planner import plan_packing

__all__ = ["PackingInputError", "measure_free_area", "plan_packing", "validate_layout"]
