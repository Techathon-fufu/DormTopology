"""Pure domain routing; ``plan_routes`` remains an alias for existing callers."""

from .planner import RoutingInputError, plan_routes, resolve_port_world, validate_scene

plan_routing = plan_routes

__all__ = ["RoutingInputError", "plan_routes", "plan_routing", "resolve_port_world", "validate_scene"]
