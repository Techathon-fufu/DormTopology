import copy
import unittest

from backend.app.domain.routing import RoutingInputError, plan_routing
from backend.app.domain.routing.spatial_cost import segment_penalty
from backend.tests.test_routing_orthogonal import orthogonal_scene


def policy():
    return {"desktop_min": [-1, 0, -1], "desktop_max": [2, 2, 2],
            "corner_start": [0, .1, -.1], "corner_end": [1, .1, -.1],
            "seat_position": [.5, 0, .8], "distance_scale_m": .15,
            "corner_weight": 30, "seat_weight": 12}


class SpatialCostTests(unittest.TestCase):
    def test_seat_cost_increases_with_horizontal_proximity(self):
        p = {**policy(), "corner_weight": 0}
        costs = [segment_penalty([.45, .1, z], [.55, .1, z], p) for z in (-.2, .2, .6)]
        self.assertTrue(0 < costs[0] < costs[1] < costs[2])
        self.assertAlmostEqual(costs[2], segment_penalty([.45, 1, .6], [.55, 1, .6], p))
        self.assertGreater(costs[2], segment_penalty([1.45, .1, .6], [1.55, .1, .6], p))

    def test_corner_cost_increases_with_distance_and_remains_nonnegative(self):
        p = {**policy(), "seat_weight": 0}
        costs = [segment_penalty([.2, .1, z], [.8, .1, z], p) for z in (-.1, 0, .3)]
        self.assertEqual(costs[0], 0)
        self.assertTrue(costs[0] < costs[1] < costs[2])

    def test_clipped_integral_is_symmetric_and_does_not_skip_thin_regions(self):
        p = {**policy(), "desktop_min": [.4, 0, 0], "desktop_max": [.401, 1, 1]}
        a, b = [0, .1, .2], [1, .1, .2]
        self.assertGreater(segment_penalty(a, b, p), 0)
        self.assertAlmostEqual(segment_penalty(a, b, p), segment_penalty(b, a, p))
        self.assertEqual(segment_penalty([0, -.1, .2], [1, -.1, .2], p), 0)
        self.assertEqual(segment_penalty(a, b, None), 0)

    def test_policy_changes_real_path_and_astar_matches_dijkstra(self):
        scene = orthogonal_scene()
        graph = scene["routing_graph"]
        for node in list(graph["nodes"]):
            graph["nodes"].append({**node, "id": node["id"] + "rear", "position": [node["position"][0], .1, -.1]})
        for edge in list(graph["edges"]):
            graph["edges"].append({**edge, "id": edge["id"] + "rear",
                                   "from_node_id": edge["from_node_id"] + "rear", "to_node_id": edge["to_node_id"] + "rear"})
        original = plan_routing(scene)["cables"][0]
        self.assertTrue(any(p[2] == .2 for p in original["path_points"]))
        graph["spatial_cost_policy"] = policy()
        result = plan_routing(scene)
        self.assertEqual(result, plan_routing(scene, use_dijkstra=True))
        cable = result["cables"][0]
        self.assertEqual(cable["status"], "valid")
        self.assertTrue(any(p[2] == -.1 for p in cable["path_points"]))
        self.assertFalse(any(p[2] == .2 for p in cable["path_points"]))
        # Endpoint connectors also move into the rear lane before spanning X.
        self.assertEqual(cable["path_points"][2][2], -.1)

    def test_invalid_policy_fails_before_search(self):
        for key, value in [("corner_weight", -1), ("seat_weight", float('nan')),
                           ("distance_scale_m", 0), ("seat_position", [0, 0]),
                           ("corner_end", [0, .1, -.1]), ("desktop_max", [-2, 2, 2])]:
            with self.subTest(key=key):
                scene = orthogonal_scene()
                scene["routing_graph"]["spatial_cost_policy"] = {**policy(), key: value}
                with self.assertRaises(RoutingInputError):
                    plan_routing(scene)
        scene = orthogonal_scene()
        scene["routing_graph"]["spatial_cost_policy"] = copy.deepcopy(policy())
        scene["routing_graph"]["path_style"] = 'smooth'
        with self.assertRaises(RoutingInputError):
            plan_routing(scene)

    def test_low_socket_can_detour_around_overhead_and_screen(self):
        scene = orthogonal_scene()
        scene['cables'][0]['length_m'] = None
        for node in scene['routing_graph']['nodes']:
            node['position'] = [{'a': .15, 'b': .25, 'c': .35}[node['id']], .3, -.2]
        scene['reserved_zones'] = [{'id': 'overhead', 'min': [0, .112, -.05], 'max': [.4, 2, .3]}]
        scene['obstacles'] = [{'id': 'screen', 'min': [0, .09, -.15], 'max': [.4, .5, -.05]}]
        route = plan_routing(scene)['cables'][0]
        self.assertEqual(route['status'], 'valid', route['reason_code'])
        self.assertTrue(any(p[0] > .4 and p[1] < .112 for p in route['path_points']))
        scene['reserved_zones'][0]['min'][1] = .09
        failed = plan_routing(scene)['cables'][0]
        self.assertEqual(failed['reason_code'], 'endpoint_blocked')
        self.assertEqual(failed['path_points'], [])
