import copy
import math
import unittest

from backend.app.domain.geometry.convex import (
    segment_hits,
    segment_interval,
    validate_compound,
    world_parts,
)
from backend.app.domain.routing import geometry as routing_geometry
from backend.app.domain.routing import plan_routes, planner
from backend.tests.test_routing import scene_for

BOX_FACES = [
    [0, 1, 3], [0, 3, 2], [4, 6, 7], [4, 7, 5],
    [0, 4, 5], [0, 5, 1], [2, 3, 7], [2, 7, 6],
    [0, 2, 6], [0, 6, 4], [1, 5, 7], [1, 7, 3],
]


def box_part(size, center):
    return {
        "vertices_m": [
            [center[0] + x, center[1] + y, center[2] + z]
            for x in (-size[0] / 2, size[0] / 2)
            for y in (-size[1] / 2, size[1] / 2)
            for z in (-size[2] / 2, size[2] / 2)
        ],
        "faces": copy.deepcopy(BOX_FACES),
    }


def compound_item(scene, identifier, size, position, parts):
    result = copy.deepcopy(scene["items"][1])
    result.update(
        id=identifier,
        name=identifier,
        size_m=list(size),
        position=list(position),
        rotation_y_rad=0.0,
        ports=[],
        collision={"type": "compound", "parts": parts},
    )
    validate_compound(result["collision"])
    return result


def monitor_scene():
    scene = scene_for()
    # These dimensions match the front-end monitor's base, stem and panel.
    scene["items"].append(compound_item(
        scene,
        "monitor",
        (0.2, 0.5, 0.2),
        (0.3, 0.0, 0.1),
        [
            box_part((0.072, 0.0175, 0.16), (0.0, 0.00875, 0.01)),
            box_part((0.015, 0.11, 0.036), (0.0, 0.0725, -0.05)),
            box_part((0.2, 0.3725, 0.022), (0.0, 0.31375, 0.0)),
        ],
    ))
    return scene


class CompoundRoutingTests(unittest.TestCase):
    def test_monitor_gap_remains_a_usable_route_for_both_searches(self):
        for dijkstra in (False, True):
            with self.subTest(dijkstra=dijkstra):
                result = plan_routes(monitor_scene(), use_dijkstra=dijkstra)
                self.assertEqual(result["status"], "success")
                self.assertEqual(result["cables"][0]["status"], "valid")
                self.assertEqual(result["cables"][0]["path_points"][0], [0.1, 0.1, 0.1])
                self.assertEqual(result["cables"][0]["path_points"][-1], [0.75, 0.1, 0.1])

    def test_y_rotation_preserves_the_monitor_gap_and_port_transforms(self):
        for angle in (math.pi / 4, math.pi / 2):
            with self.subTest(angle=angle):
                scene = monitor_scene()
                for item in scene["items"]:
                    item["position"] = list(routing_geometry.rotate_y(item["position"], angle))
                    item["rotation_y_rad"] += angle
                for node in scene["routing_graph"]["nodes"]:
                    node["position"] = list(routing_geometry.rotate_y(node["position"], angle))
                route = plan_routes(scene)["cables"][0]
                self.assertEqual(route["status"], "valid")
                expected_start = routing_geometry.rotate_y((0.1, 0.1, 0.1), angle)
                expected_end = routing_geometry.rotate_y((0.75, 0.1, 0.1), angle)
                for got, expected in zip(route["path_points"][0], expected_start):
                    self.assertAlmostEqual(got, expected)
                for got, expected in zip(route["path_points"][-1], expected_end):
                    self.assertAlmostEqual(got, expected)

    def test_compound_solid_and_insufficient_cable_clearance_block_routes(self):
        for offset in (0.0, 0.0125):
            with self.subTest(offset=offset):
                scene = scene_for()
                scene["items"].append(compound_item(
                    scene, "blocker", (0.02, 0.02, 0.02),
                    (0.25, 0.09, 0.1 + offset),
                    [box_part((0.02, 0.02, 0.02), (0.0, 0.01, 0.0))],
                ))
                result = plan_routes(scene)
                route = result["cables"][0]
                self.assertEqual(route["status"], "failed")
                self.assertEqual(route["curve_segments"], [])
                self.assertEqual(route["path_points"], [])

    def test_gap_outside_the_required_cable_clearance_is_usable(self):
        scene = scene_for()
        scene["items"].append(compound_item(
            scene, "nearby", (0.02, 0.02, 0.02), (0.25, 0.09, 0.12),
            [box_part((0.02, 0.02, 0.02), (0.0, 0.01, 0.0))],
        ))
        self.assertEqual(plan_routes(scene)["cables"][0]["status"], "valid")

    def test_source_leadout_cannot_pass_through_a_separate_source_part(self):
        for gap in (0.001, 0.05):
            with self.subTest(gap=gap):
                scene = scene_for()
                scene["routing_graph"]["nodes"][0]["position"][0] = 0.3
                scene["routing_graph"]["nodes"][1]["position"][0] = 0.4
                source = scene["items"][0]
                source["size_m"] = [0.1, 0.1, 0.3]
                source["collision"] = {
                    "type": "compound",
                    "parts": [
                        box_part((0.1, 0.1, 0.1), (0.0, 0.05, 0.0)),
                        box_part((0.1, 0.1, 0.05), (0.0, 0.05, 0.075 + gap)),
                    ],
                }
                validate_compound(source["collision"])
                route = plan_routes(scene)["cables"][0]
                self.assertEqual(route["status"], "failed")
                self.assertEqual(route["reason_code"], "endpoint_blocked")
                self.assertEqual(route["curve_segments"], [])

    def test_external_source_port_does_not_exempt_other_source_solids(self):
        scene = scene_for()
        scene["routing_graph"]["nodes"][0]["position"][0] = 0.3
        scene["routing_graph"]["nodes"][1]["position"][0] = 0.4
        source = scene["items"][0]
        source["size_m"] = [0.1, 0.1, 0.3]
        source["collision"] = {
            "type": "compound",
            "parts": [
                box_part((0.1, 0.1, 0.05), (0.0, 0.05, -0.025)),
                box_part((0.1, 0.1, 0.05), (0.0, 0.05, 0.125)),
            ],
        }
        route = plan_routes(scene)["cables"][0]
        self.assertEqual(route["status"], "failed")
        self.assertEqual(route["reason_code"], "endpoint_blocked")

    def test_a_curve_cannot_reenter_its_source_after_the_port_leadout(self):
        scene = scene_for()
        source = scene["items"][0]
        source["collision"] = {
            "type": "compound",
            "parts": [box_part((0.1, 0.1, 0.1), (0.0, 0.05, 0.0))],
        }
        endpoints = planner._build_endpoints(scene)
        start, end = endpoints["source_port"], endpoints["sink_port"]
        samples = [
            start.position, planner._endpoint_exit(start, 0.002),
            (0.2, 0.1, 0.2), (0.05, 0.15, 0.1), end.position,
        ]
        self.assertTrue(planner._curve_collides(
            samples, 0.002, [], [],
            {item["id"]: routing_geometry.collision_from_item(item) for item in scene["items"]},
            start, end,
        ))

    def test_compound_endpoints_keep_their_finite_port_leadouts(self):
        scene = scene_for()
        for item in scene["items"]:
            item["collision"] = {
                "type": "compound",
                "parts": [box_part((0.1, 0.1, 0.1), (0.0, 0.05, 0.0))],
            }
        route = plan_routes(scene)["cables"][0]
        self.assertEqual(route["status"], "valid")
        self.assertEqual(route["path_points"][0], [0.1, 0.1, 0.1])
        self.assertEqual(route["path_points"][-1], [0.75, 0.1, 0.1])

    def test_external_ports_within_clearance_keep_finite_host_leadouts(self):
        for offset in (0.001, 0.002):
            with self.subTest(offset=offset):
                scene = scene_for()
                for item in scene["items"]:
                    item["collision"] = {
                        "type": "compound",
                        "parts": [box_part((0.1, 0.1, 0.1), (0.0, 0.05, 0.0))],
                    }
                scene["items"][0]["ports"][0]["local_position"][2] += offset
                scene["items"][1]["ports"][0]["local_position"][0] -= offset
                route = plan_routes(scene)["cables"][0]
                self.assertEqual(route["status"], "valid")
                self.assertAlmostEqual(route["path_points"][0][0], 0.1 + offset)
                self.assertAlmostEqual(route["path_points"][-1][0], 0.75 - offset)

    def test_external_host_does_not_exempt_a_separate_part_ahead(self):
        scene = scene_for()
        source = scene["items"][0]
        source["size_m"] = [0.1, 0.1, 0.3]
        source["ports"][0]["local_position"][2] += 0.002
        source["collision"] = {
            "type": "compound",
            "parts": [
                box_part((0.1, 0.1, 0.1), (0.0, 0.05, 0.0)),
                box_part((0.1, 0.1, 0.05), (0.0, 0.05, 0.080)),
            ],
        }
        for minimum_radius in (0, 0.02):
            with self.subTest(minimum_radius=minimum_radius):
                scene["cables"][0]["min_bend_radius_m"] = minimum_radius
                route = plan_routes(scene)["cables"][0]
                self.assertEqual(route["reason_code"], "endpoint_blocked")
                self.assertEqual(route["path_points"], [])

    def test_smoothed_curve_that_enters_a_compound_solid_is_rejected(self):
        scene = scene_for()
        scene["items"].append(compound_item(
            scene, "curve_blocker", (0.03, 0.03, 0.03), (0.425, 0.085, 0.2),
            [box_part((0.03, 0.03, 0.03), (0.0, 0.015, 0.0))],
        ))
        self.assertEqual(plan_routes(scene)["cables"][0]["status"], "valid")
        endpoints = planner._build_endpoints(scene)
        cable = scene["cables"][0]
        spec = planner.CableSpec(cable, 0.002, "slot", 0.02)
        segments = [
            ((0.1, 0.1, 0.1), (0.2, 0.1, 0.1), (0.325, 0.1, 0.2), (0.425, 0.1, 0.2)),
            ((0.425, 0.1, 0.2), (0.525, 0.1, 0.2), (0.65, 0.1, 0.1), (0.75, 0.1, 0.1)),
        ]
        reason, _ = planner._validate_curve(
            segments,
            routing_geometry.sample_beziers(segments, 0.01),
            spec,
            endpoints["source_port"],
            endpoints["sink_port"],
            [], [], {
                item["id"]: routing_geometry.collision_from_item(item)
                for item in scene["items"]
            }, [],
        )
        self.assertEqual(reason, "collision")

    def test_existing_box_routes_still_work(self):
        for mode in ("slot", "backboard"):
            with self.subTest(mode=mode):
                route = plan_routes(scene_for(mode))["cables"][0]
                self.assertEqual(route["status"], "valid")


class CompoundHalfspaceTests(unittest.TestCase):
    def test_sloped_tetrahedron_face_clips_segments_and_keeps_exit_clearance(self):
        collision = {
            "type": "compound",
            "parts": [{
                "vertices_m": [
                    [-0.5, 0.0, -0.5], [0.5, 0.0, -0.5],
                    [0.0, 0.0, 0.5], [0.0, 1.0, 0.0],
                ],
                "faces": [[0, 1, 2], [0, 3, 1], [1, 3, 2], [2, 3, 0]],
            }],
        }
        validate_compound(collision)
        item = {
            "collision": collision, "position": [0, 0, 0],
            "rotation_y_rad": 0.0, "size_m": [1, 1, 1],
        }
        parts = world_parts(item)
        # At y=.5 and z=0, the sloping faces bound x to [-.125, .125].
        interval = segment_interval((-1.0, 0.5, 0.0), (2.0, 0.0, 0.0), parts[0])
        self.assertAlmostEqual(interval[0], 0.4375)
        self.assertAlmostEqual(interval[1], 0.5625)
        self.assertFalse(segment_hits((0.2, 0.5, 0.0), (0.3, 0.5, 0.0), parts))

        body = routing_geometry.collision_from_item(item)
        endpoint = planner.ResolvedEndpoint(
            "sloped_port", "tetrahedron", (0.125, 0.5, 0.0), (1, 0, 0), body,
        )
        radius = 0.002
        clearance = radius + routing_geometry.EPSILON + routing_geometry.BEZIER_SAMPLE_ERROR
        exit_point = planner._endpoint_exit(endpoint, radius)
        # The exit along +X must account for the face normal (1, .25, .5).
        expected_x = 0.125 + clearance * math.sqrt(1.3125) + routing_geometry.EPSILON
        self.assertAlmostEqual(exit_point[0], expected_x)
        self.assertFalse(routing_geometry.segment_intersects_box(
            exit_point, exit_point, body, clearance,
        ))

    def test_cube_checks_both_faces_of_every_axis(self):
        collision = {
            "type": "compound",
            "parts": [box_part((1.0, 1.0, 1.0), (0.0, 0.5, 0.0))],
        }
        validate_compound(collision)
        parts = world_parts({
            "collision": collision, "position": [0, 0, 0], "rotation_y_rad": 0.0,
        })
        center = (0.0, 0.5, 0.0)
        for axis in range(3):
            for sign in (-1, 1):
                with self.subTest(axis=axis, sign=sign):
                    near = list(center)
                    far = list(center)
                    near[axis] += 2 * sign
                    far[axis] += 3 * sign
                    self.assertFalse(segment_hits(near, far, parts))
                    self.assertFalse(segment_hits(far, near, parts))
                    self.assertTrue(segment_hits(center, near, parts))
                    self.assertTrue(segment_hits(near, center, parts))


if __name__ == "__main__":
    unittest.main()
