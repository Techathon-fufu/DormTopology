import unittest

from algorithm.cable_routing import plan_routes as legacy_plan_routes
from algorithm.cable_routing import resolve_port_world as legacy_resolve
from algorithm.cable_routing.geometry import AABB as LegacyAABB
from algorithm.cable_routing.geometry import sample_beziers as legacy_sample
from backend.app.domain.geometry import AABB
from backend.app.domain.routing import plan_routing, resolve_port_world
from backend.app.domain.routing.geometry import sample_beziers


class CompatibilityTests(unittest.TestCase):
    def test_legacy_entries_are_exact_domain_exports(self):
        self.assertIs(legacy_plan_routes, plan_routing)
        self.assertIs(legacy_resolve, resolve_port_world)
        self.assertIs(LegacyAABB, AABB)
        self.assertIs(legacy_sample, sample_beziers)
