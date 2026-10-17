import copy
import math
import unittest

from backend.app.domain.errors import SceneInputError
from backend.app.domain.geometry import items_overlap
from backend.app.domain.packing import plan_packing, validate_layout
from backend.app.domain.packing.spacing import item_conflicts, spacing_conflict
from backend.app.domain.rules import validate_scene
from backend.app.service.errors import Conflict
from backend.app.service.organization import _apply_targets
from backend.examples.packing_demo import item, port, preview_scene, region, zone
from backend.tests.test_packing import compound_box, simple_scene


def spacing_scene(gap=0.02):
    scene = simple_scene()
    scene["constraints"] = {"min_item_gap_m": gap}
    return scene


def fixed_pair(gap):
    scene = spacing_scene()
    scene["items"] = [
        item("left", "box", (0.2, 0.1, 0.2), (0.2, 0.77, 0.2), ["desktop"], fixed=True),
        item(
            "right",
            "box",
            (0.2, 0.1, 0.2),
            (0.4 + gap, 0.77, 0.2),
            ["desktop"],
            fixed=True,
        ),
    ]
    return scene


def shifted_part(size, offset):
    part = compound_box(*size)["parts"][0]
    for vertex in part["vertices_m"]:
        for axis in range(3):
            vertex[axis] += offset[axis]
    return part


def mounted_scene():
    scene = spacing_scene()
    strip = item(
        "strip",
        "power_strip",
        (0.4, 0.04, 0.1),
        (0.4, 0.77, 0.2),
        ["desktop"],
        fixed=True,
    )
    strip["socket_count"] = 4
    strip["ports"] = [
        port("strip_input", "power_sink", (-0.2, 0.02, 0), (-1, 0, 0)),
        *[
            port(f"socket_{index}", "power_source", (x, 0.04, 0), (0, 1, 0))
            for index, x in enumerate((-0.12, -0.04, 0.04, 0.12))
        ],
    ]
    adapter = item(
        "adapter",
        "power_adapter",
        (0.06, 0.08, 0.08),
        (0.28, 0.81, 0.2),
        [],
        fixed=True,
    )
    adapter["ports"] = [port("adapter_plug", "power_sink", (0, 0, 0), (0, -1, 0))]
    adapter["plug_mount"] = {
        "socket_port_id": "socket_0",
        "plug_port_id": "adapter_plug",
    }
    scene["items"] = [strip, adapter]
    return scene


class PackingSpacingTests(unittest.TestCase):
    def test_exact_gap_is_allowed_and_smaller_gap_has_its_own_issue(self):
        for gap, expected in ((0.0199, False), (0.02, True), (0.0201, True)):
            with self.subTest(gap=gap):
                scene = fixed_pair(gap)
                check = validate_layout(scene)
                self.assertEqual(check["geometry_valid"], expected, check)
                self.assertFalse(items_overlap(*scene["items"]))
                self.assertFalse(
                    any(problem["code"] == "collision" for problem in check["issues"])
                )
                spacing = [
                    problem
                    for problem in check["issues"]
                    if problem["code"] == "item_spacing"
                ]
                self.assertEqual(
                    {problem["entity_id"] for problem in spacing},
                    set() if expected else {"left", "right"},
                )

    def test_box_corner_distance_is_euclidean(self):
        for gap, expected in ((0.019, False), (0.02, True), (0.021, True)):
            with self.subTest(gap=gap):
                scene = spacing_scene()
                shift = 0.1 + gap / math.sqrt(2)
                scene["items"] = [
                    item(
                        "a",
                        "box",
                        (0.1, 0.1, 0.1),
                        (0.2, 0.77, 0.2),
                        ["desktop"],
                        fixed=True,
                    ),
                    item(
                        "b",
                        "box",
                        (0.1, 0.1, 0.1),
                        (0.2 + shift, 0.77, 0.2 + shift),
                        ["desktop"],
                        fixed=True,
                    ),
                ]
                self.assertEqual(validate_layout(scene)["geometry_valid"], expected)

    def test_rotated_boxes_use_their_real_parallel_edges(self):
        for gap, expected in ((0.019, False), (0.02, True), (0.021, True)):
            with self.subTest(gap=gap):
                scene = spacing_scene()
                a = item(
                    "a",
                    "box",
                    (0.3, 0.1, 0.02),
                    (0.4, 0.77, 0.3),
                    ["desktop"],
                    fixed=True,
                )
                b = copy.deepcopy(a)
                b["id"] = b["name"] = "b"
                a["rotation_y_rad"] = b["rotation_y_rad"] = math.pi / 4
                shift = (0.02 + gap) / math.sqrt(2)
                b["position"] = [0.4 + shift, 0.77, 0.3 + shift]
                scene["items"] = [a, b]
                self.assertFalse(items_overlap(a, b))
                self.assertEqual(validate_layout(scene)["geometry_valid"], expected)

    def test_compound_gap_between_real_parts_remains_usable(self):
        scene = spacing_scene()
        frame = item(
            "frame", "box", (0.34, 0.1, 0.2), (0.4, 0.77, 0.3), ["desktop"], fixed=True
        )
        frame["collision"] = {
            "type": "compound",
            "parts": [
                shifted_part((0.04, 0.1, 0.2), (-0.15, 0, 0)),
                shifted_part((0.04, 0.1, 0.2), (0.15, 0, 0)),
            ],
        }
        inner = item(
            "inner", "box", (0.1, 0.1, 0.1), (0.4, 0.77, 0.3), ["desktop"], fixed=True
        )
        scene["items"] = [frame, inner]
        self.assertTrue(validate_layout(scene)["geometry_valid"])
        inner["position"][0] = 0.47
        self.assertFalse(items_overlap(frame, inner))
        check = validate_layout(scene)
        self.assertFalse(check["geometry_valid"])
        self.assertEqual(
            {problem["code"] for problem in check["issues"]}, {"item_spacing"}
        )

    def test_compound_parts_without_vertical_overlap_do_not_block_the_gap(self):
        scene = spacing_scene()
        frame = item(
            "frame", "box", (0.34, 0.25, 0.2), (0.4, 0.77, 0.3), ["desktop"], fixed=True
        )
        frame["collision"] = {
            "type": "compound",
            "parts": [
                shifted_part((0.04, 0.25, 0.2), (-0.15, 0, 0)),
                shifted_part((0.04, 0.25, 0.2), (0.15, 0, 0)),
                shifted_part((0.34, 0.05, 0.2), (0, 0.2, 0)),
            ],
        }
        scene["items"] = [
            frame,
            item(
                "inner",
                "box",
                (0.1, 0.1, 0.1),
                (0.4, 0.77, 0.3),
                ["desktop"],
                fixed=True,
            ),
        ]
        self.assertTrue(validate_layout(scene)["geometry_valid"])

    def test_separate_levels_and_vertical_contact_do_not_require_air_gaps(self):
        for height in (0.87, 0.885):
            with self.subTest(height=height):
                scene = spacing_scene()
                scene["regions"].append(region("upper-support", (0, 1, 0, 0.6), height))
                scene["items"] = [
                    item(
                        "lower",
                        "box",
                        (0.2, 0.1, 0.2),
                        (0.4, 0.77, 0.3),
                        ["desktop"],
                        fixed=True,
                    ),
                    item(
                        "upper",
                        "box",
                        (0.2, 0.1, 0.2),
                        (0.4, height, 0.3),
                        ["upper-support"],
                        fixed=True,
                    ),
                ]
                self.assertTrue(validate_layout(scene)["geometry_valid"])

    def test_different_support_heights_still_check_overlapping_vertical_ranges(self):
        scene = spacing_scene()
        scene["regions"].append(region("upper-support", (0, 1, 0, 0.6), 0.9))
        scene["items"] = [
            item(
                "lower",
                "box",
                (0.2, 0.2, 0.2),
                (0.2, 0.77, 0.3),
                ["desktop"],
                fixed=True,
            ),
            item(
                "upper",
                "box",
                (0.2, 0.1, 0.2),
                (0.415, 0.9, 0.3),
                ["upper-support"],
                fixed=True,
            ),
        ]
        self.assertFalse(items_overlap(*scene["items"]))
        check = validate_layout(scene)
        self.assertFalse(check["geometry_valid"])
        self.assertEqual(
            {problem["code"] for problem in check["issues"]}, {"item_spacing"}
        )

    def test_fixed_spacing_failure_cannot_be_hidden_by_the_planner(self):
        scene = fixed_pair(0.01)
        original = copy.deepcopy(scene)
        result = plan_packing(scene)
        self.assertEqual(result["status"], "infeasible")
        self.assertEqual(
            {problem["code"] for problem in result["issues"]}, {"item_spacing"}
        )
        for before, target in zip(scene["items"], result["items"]):
            self.assertEqual(target["target_pos"], before["position"])
            self.assertEqual(target["placement_status"], "unchanged")
        self.assertEqual(scene, original)

    def test_packing_repairs_dense_input_without_mutating_it(self):
        scene = fixed_pair(0.005)
        scene["items"][1]["fixed"] = False
        original = copy.deepcopy(scene)
        result = plan_packing(scene)
        self.assertEqual(result["status"], "success", result)
        self.assertEqual(result["items"][1]["placement_status"], "placed")
        self.assertTrue(validate_layout(preview_scene(scene, result))["geometry_valid"])
        self.assertEqual(scene, original)

    def test_no_room_for_required_gap_retains_every_input_pose(self):
        scene = spacing_scene()
        scene["regions"] = [region("desktop", (0, 0.4, 0, 0.2))]
        scene["items"] = [
            item("a", "box", (0.2, 0.1, 0.2), (0.1, 0.77, 0.1), ["desktop"]),
            item("b", "box", (0.2, 0.1, 0.2), (0.3, 0.77, 0.1), ["desktop"]),
        ]
        for value in scene["items"]:
            value["allowed_rotations_y_rad"] = [0.0]
        original = copy.deepcopy(scene)
        result = plan_packing(scene)
        self.assertEqual(result["status"], "infeasible", result)
        self.assertTrue(
            any(problem["code"] == "item_spacing" for problem in result["issues"])
        )
        self.assertEqual({value["item_id"] for value in result["items"]}, {"a", "b"})
        for before, target in zip(scene["items"], result["items"]):
            self.assertEqual(target["target_pos"], before["position"])
        self.assertEqual(scene, original)

    def test_candidate_search_finds_a_gap_between_two_fixed_blockers(self):
        scene = spacing_scene()
        scene["regions"] = [region("desktop", (0, 0.8, 0, 0.2))]
        scene["items"] = [
            item(
                "left",
                "box",
                (0.2, 0.1, 0.2),
                (0.1, 0.77, 0.1),
                ["desktop"],
                fixed=True,
            ),
            item(
                "right",
                "box",
                (0.3, 0.1, 0.2),
                (0.65, 0.77, 0.1),
                ["desktop"],
                fixed=True,
            ),
            item("mover", "box", (0.2, 0.1, 0.2), (0.1, 0.77, 0.1), ["desktop"]),
        ]
        scene["items"][-1]["allowed_rotations_y_rad"] = [0.0]
        result = plan_packing(scene)
        self.assertEqual(result["status"], "success", result)
        target = next(value for value in result["items"] if value["item_id"] == "mover")
        self.assertGreaterEqual(target["target_pos"][0], 0.32 - 1e-10)
        self.assertLessEqual(target["target_pos"][0], 0.38 + 1e-10)
        self.assertTrue(validate_layout(preview_scene(scene, result))["geometry_valid"])

    def test_candidate_search_finds_a_slot_with_exactly_twenty_mm_on_both_sides(self):
        scene = spacing_scene()
        scene["regions"] = [region("desktop", (0, 0.8, 0, 0.2))]
        scene["items"] = [
            item(
                "left", "box", (0.2, 0.1, 0.2), (0.1, 0.77, 0.1),
                ["desktop"], fixed=True,
            ),
            item(
                "right", "box", (0.36, 0.1, 0.2), (0.62, 0.77, 0.1),
                ["desktop"], fixed=True,
            ),
            item("mover", "box", (0.2, 0.1, 0.2), (0.1, 0.77, 0.1), ["desktop"]),
        ]
        scene["items"][-1]["allowed_rotations_y_rad"] = [0.0]
        original = copy.deepcopy(scene)
        result = plan_packing(scene)
        self.assertEqual(result["status"], "success", result)
        target = next(value for value in result["items"] if value["item_id"] == "mover")
        self.assertEqual(target["placement_status"], "placed")
        self.assertAlmostEqual(target["target_pos"][0], 0.32)
        self.assertTrue(validate_layout(preview_scene(scene, result))["geometry_valid"])
        self.assertEqual(scene, original)

    def test_unplaced_residual_rolls_back_a_nonoverlapping_move_that_is_too_close(self):
        scene = spacing_scene()
        scene["regions"].extend(
            [
                region("target_a", (0, 0.2, 0, 0.2)),
                region("target_b", (0, 0.1, 0, 0.1)),
            ]
        )
        scene["items"] = [
            item("a_mover", "box", (0.2, 0.1, 0.2), (0.8, 0.77, 0.4), ["target_a"]),
            item("z_retained", "box", (0.2, 0.1, 0.2), (0.31, 0.77, 0.1), ["target_b"]),
        ]
        for value in scene["items"]:
            value["allowed_rotations_y_rad"] = [0.0]
        result = plan_packing(scene)
        self.assertEqual(result["status"], "partial", result)
        self.assertTrue(
            any("rolled back" in problem["message"] for problem in result["issues"])
        )
        self.assertTrue(validate_layout(preview_scene(scene, result))["geometry_valid"])
        for before, target in zip(scene["items"], result["items"]):
            self.assertEqual(target["target_pos"], before["position"])
            self.assertEqual(target["placement_status"], "unplaced")

    def test_named_plug_mount_preserves_contact_but_never_excuses_penetration(self):
        scene = mounted_scene()
        self.assertTrue(validate_layout(scene)["geometry_valid"])
        strip, adapter = scene["items"]
        self.assertFalse(spacing_conflict(scene, strip, adapter))
        adapter["position"][1] -= 0.0005
        self.assertFalse(spacing_conflict(scene, strip, adapter))
        self.assertTrue(item_conflicts(scene, strip, adapter))
        self.assertTrue(
            any(
                problem["code"] == "collision"
                for problem in validate_layout(scene)["issues"]
            )
        )

    def test_plug_mount_does_not_exempt_a_third_adapter(self):
        scene = mounted_scene()
        scene["regions"].append(region("upper", (0, 1, 0, 0.6), 0.81))
        scene["items"].append(
            item(
                "third",
                "power_adapter",
                (0.06, 0.08, 0.08),
                (0.35, 0.81, 0.2),
                ["upper"],
                fixed=True,
            )
        )
        check = validate_layout(scene)
        self.assertFalse(check["geometry_valid"])
        spacing = [
            problem for problem in check["issues"] if problem["code"] == "item_spacing"
        ]
        self.assertEqual(
            {problem["entity_id"] for problem in spacing}, {"adapter", "third"}
        )
        self.assertFalse(
            any(problem["code"] == "collision" for problem in check["issues"])
        )

    def test_gap_does_not_shrink_support_boundaries_or_inflate_zones(self):
        scene = spacing_scene()
        scene["items"] = [
            item(
                "edge",
                "box",
                (0.2, 0.1, 0.2),
                (0.1, 0.77, 0.1),
                ["desktop"],
                fixed=True,
            )
        ]
        scene["obstacles"] = [zone("nearby", (0.21, 0.77, 0), (0.3, 1, 0.2))]
        scene["reserved_zones"] = [zone("reserved", (0, 0.77, 0.21), (0.2, 1, 0.3))]
        self.assertTrue(validate_layout(scene)["geometry_valid"])
        self.assertEqual(plan_packing(scene)["status"], "success")

    def test_apply_service_rejects_a_forged_success_with_insufficient_gap(self):
        scene = fixed_pair(0.2)
        scene["items"][1]["fixed"] = False
        original = copy.deepcopy(scene)
        result = {
            "schema_version": scene["schema_version"],
            "scene_id": scene["scene_id"],
            "scene_revision": scene["scene_revision"],
            "status": "success",
            "items": [
                {
                    "item_id": "left",
                    "target_pos": list(scene["items"][0]["position"]),
                    "target_rotation_y_rad": 0.0,
                    "target_region_id": "desktop",
                    "placement_status": "unchanged",
                },
                {
                    "item_id": "right",
                    "target_pos": [0.41, 0.77, 0.2],
                    "target_rotation_y_rad": 0.0,
                    "target_region_id": "desktop",
                    "placement_status": "placed",
                },
            ],
            "issues": [],
        }
        with self.assertRaisesRegex(Conflict, "geometry check"):
            _apply_targets(scene, result)
        self.assertEqual(scene, original)

    def test_omitted_constraint_matches_explicit_zero_and_contact_stays_legal(self):
        omitted = fixed_pair(0)
        del omitted["constraints"]
        explicit = copy.deepcopy(omitted)
        explicit["constraints"] = {"min_item_gap_m": 0}
        original = copy.deepcopy(omitted)
        self.assertTrue(validate_layout(omitted)["geometry_valid"])
        self.assertTrue(validate_layout(explicit)["geometry_valid"])
        self.assertEqual(plan_packing(omitted), plan_packing(explicit))
        self.assertEqual(omitted, original)
        explicit["items"][1]["position"][0] -= 0.0005
        self.assertFalse(validate_layout(explicit)["geometry_valid"])
        self.assertTrue(
            any(
                problem["code"] == "collision"
                for problem in validate_layout(explicit)["issues"]
            )
        )

    def test_invalid_gap_values_are_rejected_before_planning(self):
        for value in (
            True,
            False,
            -0.01,
            float("nan"),
            float("inf"),
            float("-inf"),
            "0.02",
            None,
        ):
            with self.subTest(value=value):
                scene = spacing_scene(value)
                with self.assertRaises(SceneInputError) as caught:
                    validate_scene(scene)
                self.assertEqual(caught.exception.field, "constraints.min_item_gap_m")
                with self.assertRaises(SceneInputError):
                    plan_packing(scene)

    def test_invalid_constraint_shape_is_rejected(self):
        for value in (None, [], "invalid", True, {}):
            with self.subTest(value=value):
                scene = spacing_scene()
                scene["constraints"] = value
                with self.assertRaises(SceneInputError) as caught:
                    validate_scene(scene)
                self.assertTrue(caught.exception.field.startswith("constraints"))


if __name__ == "__main__":
    unittest.main()
