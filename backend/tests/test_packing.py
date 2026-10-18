import copy
import json
import math
import unittest
from collections import deque

from backend.app.domain.geometry import (
    AABB,
    aabb_from_item,
    direction_to_local,
    direction_to_world,
    fits_region,
    footprints_overlap,
    item_intersects_box,
    items_overlap,
    local_to_world,
    pose_extent,
    rectangle,
    world_to_local,
)
from backend.app.domain.packing import (
    PackingInputError,
    measure_free_area,
    plan_packing,
    validate_layout,
)
from backend.app.domain.packing.area import DesktopGrid
from backend.app.domain.routing import plan_routes, resolve_port_world
from backend.app.domain.routing.geometry import AABB as RoutingAABB
from backend.examples.packing_demo import (
    cases,
    demo_scene,
    item,
    preview_scene,
    region,
    zone,
)


def simple_scene():
    scene = demo_scene()
    scene.update(
        items=[],
        obstacles=[],
        reserved_zones=[],
        exposure_zones=[],
        cables=[],
        routing_graph={"nodes": [], "edges": []},
        regions=[region("desktop", (0, 1, 0, 0.6))],
    )
    scene["desk"]["width_m"] = 1.0
    return scene


class GeometryTests(unittest.TestCase):
    def test_rotated_local_port_and_inverse_transform(self):
        obj = item("device", "device", (0.4, 0.1, 0.2), (0.5, 0.77, 0.3), ["desktop"])
        obj["rotation_y_rad"] = math.pi / 2
        local = [0.1, 0.05, 0]
        world = local_to_world(obj, local)
        for got, expected in zip(world, [0.5, 0.82, 0.2]):
            self.assertAlmostEqual(got, expected)
        for got, expected in zip(world_to_local(obj, world), local):
            self.assertAlmostEqual(got, expected)
        direction = direction_to_world(obj, [1, 0, 0])
        self.assertAlmostEqual(direction[2], -1)
        inverse = direction_to_local(obj, direction)
        self.assertAlmostEqual(inverse[0], 1)
        position, resolved = resolve_port_world(
            obj, {"local_position": local, "local_direction": [1, 0, 0]}
        )
        self.assertEqual(position, world)
        self.assertEqual(resolved, direction)
        self.assertIs(RoutingAABB, AABB)

    def test_rotated_obb_avoids_false_aabb_overlap(self):
        a = item("a", "box", (0.3, 0.1, 0.02), (0.4, 0.77, 0.4), ["desktop"])
        b = copy.deepcopy(a)
        a["rotation_y_rad"] = b["rotation_y_rad"] = math.pi / 4
        b["position"] = [0.4 + 0.05 / math.sqrt(2), 0.77, 0.4 + 0.05 / math.sqrt(2)]
        self.assertLess(aabb_from_item(a).minimum[0], aabb_from_item(b).maximum[0])
        self.assertFalse(items_overlap(a, b))
        corner_box = AABB((0.48, 0.77, 0.48), (0.50, 0.85, 0.50))
        self.assertFalse(item_intersects_box(a, corner_box))
        b["position"] = [0.4, 0.77, 0.4]
        self.assertTrue(items_overlap(a, b))

    def test_contact_is_legal_but_small_penetration_is_not(self):
        a = item("a", "box", (0.2, 0.1, 0.2), (0.1, 0.77, 0.1), ["desktop"])
        b = item("b", "box", (0.2, 0.1, 0.2), (0.3, 0.77, 0.1), ["desktop"])
        self.assertFalse(items_overlap(a, b))
        b["position"][0] -= 0.0005
        self.assertTrue(items_overlap(a, b))
        self.assertFalse(item_intersects_box(a, AABB((0, 0.70, 0), (1, 0.77, 0.6))))
        self.assertTrue(item_intersects_box(a, AABB((0, 0.70, 0), (1, 0.7705, 0.6))))

    def test_sat_rejects_collapsed_footprints_explicitly(self):
        valid = rectangle((0, 1, 0, 1))
        for polygon in (
            ((0, 0), (0, 0), (1, 1), (0, 1)),
            ((0, 0), (1, 0), (2, 0), (1, 0)),
        ):
            with self.subTest(polygon=polygon):
                with self.assertRaisesRegex(ValueError, "footprint"):
                    footprints_overlap(polygon, valid)
                with self.assertRaisesRegex(ValueError, "footprint"):
                    footprints_overlap(valid, polygon)

    def test_support_tolerance_does_not_expand_region_volume(self):
        support = region("desktop", (0, 1, 0, 0.6), 0.77, 0.2)
        obj = item("box", "box", (0.2, 0.1, 0.2), (0.5, 0.7705, 0.3), ["desktop"])
        self.assertTrue(fits_region(obj, support))
        for position, size in (
            ((0.0995, 0.77, 0.3), (0.2, 0.1, 0.2)),
            ((0.9005, 0.77, 0.3), (0.2, 0.1, 0.2)),
            ((0.5, 0.77, 0.0995), (0.2, 0.1, 0.2)),
            ((0.5, 0.77, 0.5005), (0.2, 0.1, 0.2)),
            ((0.5, 0.77, 0.3), (0.2, 0.2005, 0.2)),
            ((0.5, 0.7695, 0.3), (0.2, 0.2005, 0.2)),
            ((0.5, 0.7705, 0.3), (0.2, 0.2, 0.2)),
        ):
            with self.subTest(position=position, size=size):
                self.assertFalse(
                    fits_region({**obj, "position": position, "size_m": size}, support)
                )


class LayoutTests(unittest.TestCase):
    def test_submillimetre_overhang_is_not_legal_support(self):
        for position in (
            (0.0995, 0.77, 0.3),
            (0.9005, 0.77, 0.3),
            (0.5, 0.77, 0.0995),
            (0.5, 0.77, 0.5005),
        ):
            with self.subTest(position=position):
                scene = simple_scene()
                scene["items"] = [
                    item(
                        "box", "box", (0.2, 0.1, 0.2), position, ["desktop"], fixed=True
                    )
                ]
                self.assertFalse(validate_layout(scene)["geometry_valid"])
                self.assertEqual(plan_packing(scene)["status"], "infeasible")

    def test_overheight_original_pose_cannot_be_reported_success(self):
        scene = simple_scene()
        scene["regions"][0]["clearance_height_m"] = 0.2
        scene["items"] = [
            item("tall", "box", (0.2, 0.2005, 0.2), (0.4, 0.77, 0.3), ["desktop"])
        ]
        self.assertFalse(validate_layout(scene)["geometry_valid"])
        result = plan_packing(scene)
        self.assertEqual(result["status"], "infeasible")
        self.assertEqual(
            result["items"][0]["target_pos"], scene["items"][0]["position"]
        )

    def test_geometry_and_storage_goal_are_separate(self):
        scene = simple_scene()
        scene["regions"].append(region("storage", (0, 0.1, 0, 0.1), 1.2, 0.1))
        scene["items"] = [
            item("large", "box", (0.2, 0.1, 0.2), (0.4, 0.77, 0.3), ["storage"])
        ]
        check = validate_layout(scene)
        self.assertTrue(check["geometry_valid"])
        self.assertTrue(any(i["code"] == "no_space" for i in check["issues"]))
        result = plan_packing(scene)
        self.assertEqual(result["status"], "partial")
        retained = result["items"][0]
        self.assertEqual(retained["placement_status"], "unplaced")
        self.assertEqual(retained["target_region_id"], "desktop")
        self.assertEqual(retained["target_pos"], scene["items"][0]["position"])

    def test_boundary_support_height_and_reserved_volume(self):
        for position, size, reserved in [
            ((-0.1, 0.77, 0.3), (0.2, 0.1, 0.2), []),
            ((0.4, 0.80, 0.3), (0.2, 0.1, 0.2), []),
            ((0.4, 0.77, 0.3), (0.2, 1.1, 0.2), []),
            (
                (0.4, 0.77, 0.3),
                (0.2, 0.1, 0.2),
                [zone("blocked", (0.3, 0.77, 0.2), (0.5, 1, 0.4))],
            ),
        ]:
            with self.subTest(position=position, size=size):
                scene = simple_scene()
                scene["items"] = [
                    item("a", "box", size, position, ["desktop"], fixed=True)
                ]
                scene["reserved_zones"] = reserved
                self.assertFalse(validate_layout(scene)["geometry_valid"])
                result = plan_packing(scene)
                self.assertEqual(result["status"], "infeasible")
                self.assertEqual(result["items"][0]["target_pos"], list(position))

    def test_arbitrary_manual_rotation_is_validated_exactly(self):
        scene = simple_scene()
        a = item("a", "box", (0.5, 0.1, 0.2), (0.15, 0.77, 0.3), ["desktop"])
        a["rotation_y_rad"] = math.pi / 4
        scene["items"] = [a]
        self.assertFalse(validate_layout(scene)["geometry_valid"])

    def test_drawer_inner_wall_and_roof_are_obstacles(self):
        scene = demo_scene()
        box = next(i for i in scene["items"] if i["id"] == "storage_box")
        box["position"] = [1.2, 0.45, 0.3]
        check = validate_layout(scene)
        self.assertFalse(check["geometry_valid"])
        self.assertTrue(any("drawer_left" in i["message"] for i in check["issues"]))
        box["position"] = [1.3, 0.45, 0.3]
        box["size_m"][1] = 0.23
        self.assertFalse(validate_layout(scene)["geometry_valid"])

    def test_fixed_wall_panels_need_no_horizontal_surface(self):
        scene = demo_scene()
        panel = next(i for i in scene["items"] if i["id"] == "wall_power")
        self.assertFalse(
            any(i["entity_id"] == panel["id"] for i in validate_layout(scene)["issues"])
        )
        result = next(
            i for i in plan_packing(scene)["items"] if i["item_id"] == panel["id"]
        )
        self.assertEqual(result["placement_status"], "unchanged")
        self.assertIsNone(result["target_region_id"])
        panel["rotation_y_rad"] = 0.1
        self.assertFalse(validate_layout(scene)["geometry_valid"])

    def test_draft_checks_and_area_do_not_require_a_confirmed_baseline(self):
        scene = simple_scene()
        scene["baseline_id"] = None
        obj = item("draft", "box", (0.1, 0.1, 0.1), (0.5, 0.77, 0.3), ["desktop"])
        obj["dimensions_confirmed"] = False
        scene["items"] = [obj]
        self.assertTrue(validate_layout(scene)["geometry_valid"])
        self.assertGreater(measure_free_area(scene), 0)
        with self.assertRaises(PackingInputError):
            plan_packing(scene)


class PackingTests(unittest.TestCase):
    def test_inward_laptop_angle_replaces_disallowed_original_angle(self):
        scene = simple_scene()
        laptop = item('laptop', 'laptop', (.35, .23, .346), (.5, .77, .3), ['desktop'])
        laptop['allowed_rotations_y_rad'] = [-math.pi / 9]
        scene['items'] = [laptop]
        result = plan_packing(scene)
        self.assertEqual(result['status'], 'success')
        self.assertAlmostEqual(result['items'][0]['target_rotation_y_rad'], -math.pi / 9)
        self.assertTrue(validate_layout(preview_scene(scene, result))['geometry_valid'])

    def test_bounded_rotation_candidates_reject_duplicates_and_excess(self):
        for angles in ([0, 0], list(i / 10 for i in range(9)), [float('nan')]):
            scene = simple_scene()
            laptop = item('laptop', 'laptop', (.35, .23, .346), (.5, .77, .3), ['desktop'])
            laptop['allowed_rotations_y_rad'] = angles
            scene['items'] = [laptop]
            with self.subTest(angles=angles), self.assertRaises(PackingInputError):
                plan_packing(scene)

    def test_collapsed_candidate_is_skipped_without_rejecting_valid_input(self):
        scene = simple_scene()
        scene["regions"].append(region("storage", (0.5, 0.8, 0.1, 0.5), 1.2, 0.2))
        obj = item("tiny", "box", (1e-20, 0.1, 0.1), (0, 0.77, 0.3), ["storage"])
        obj["allowed_rotations_y_rad"] = [0]
        scene["items"] = [obj]
        self.assertTrue(validate_layout(scene)["geometry_valid"])
        result = plan_packing(scene)
        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["items"][0]["placement_status"], "unplaced")
        self.assertEqual(result["items"][0]["target_pos"], obj["position"])

    def test_eight_items_shelves_drawer_and_all_result_fields(self):
        scene = demo_scene()
        snapshot = copy.deepcopy(scene)
        result = plan_packing(scene)
        self.assertEqual(result["status"], "success")
        self.assertEqual(scene, snapshot)
        self.assertEqual(len([i for i in scene["items"] if not i["fixed"]]), 8)
        self.assertEqual(len(result["items"]), len(scene["items"]))
        targets = {i["item_id"]: i for i in result["items"]}
        for original in scene["items"]:
            target = targets[original["id"]]
            self.assertEqual(
                set(target),
                {
                    "item_id",
                    "name",
                    "model_url",
                    "current_pos",
                    "target_pos",
                    "target_rotation_y_rad",
                    "target_region_id",
                    "placement_status",
                    "reason_code",
                    *({"target_book_pose"} if original["category"] in {"book", "books"} else set()),
                },
            )
            self.assertEqual(target["current_pos"], original["position"])
            if original["fixed"]:
                self.assertEqual(target["target_pos"], original["position"])
                self.assertEqual(
                    target["target_rotation_y_rad"], original["rotation_y_rad"]
                )
            else:
                self.assertIn(
                    target["target_region_id"], original["allowed_region_ids"]
                )
        self.assertIn(
            targets["book"]["target_region_id"], [f"shelf_{i}" for i in range(1, 5)]
        )
        self.assertEqual(targets["storage_box"]["target_region_id"], "drawer")
        preview = preview_scene(scene, result)
        self.assertTrue(validate_layout(preview)["geometry_valid"])
        self.assertGreater(measure_free_area(preview), measure_free_area(scene))
        self.assertEqual(result, json.loads(json.dumps(result, allow_nan=False)))
        self.assertEqual(preview["cables"], scene["cables"])
        self.assertEqual(
            [i["ports"] for i in preview["items"]], [i["ports"] for i in scene["items"]]
        )
        result["items"][0]["target_pos"][0] = -100
        self.assertEqual(scene, snapshot)

    def test_rotation_required_for_target_fit(self):
        scene = simple_scene()
        scene["regions"].append(region("narrow", (0, 0.12, 0, 0.22), 1.2, 0.2))
        scene["items"] = [
            item("wide", "box", (0.2, 0.1, 0.1), (0.7, 0.77, 0.3), ["narrow"])
        ]
        result = plan_packing(scene)
        self.assertEqual(result["status"], "success")
        self.assertEqual(result["items"][0]["target_rotation_y_rad"], math.pi / 2)
        self.assertTrue(validate_layout(preview_scene(scene, result))["geometry_valid"])

    def test_each_of_the_four_shelf_regions_is_usable(self):
        for target in ("shelf_1", "shelf_2", "shelf_3", "shelf_4"):
            with self.subTest(region=target):
                scene = demo_scene()
                book = next(i for i in scene["items"] if i["id"] == "book")
                book["allowed_region_ids"] = [target]
                result = plan_packing(scene)
                self.assertEqual(result["status"], "success")
                placement = next(i for i in result["items"] if i["item_id"] == "book")
                self.assertEqual(placement["target_region_id"], target)
                self.assertTrue(
                    validate_layout(preview_scene(scene, result))["geometry_valid"]
                )

    def test_initial_collisions_can_be_repaired(self):
        scene = simple_scene()
        scene["items"] = [
            item("a", "box", (0.1, 0.1, 0.1), (0.5, 0.77, 0.3), ["desktop"]),
            item("b", "box", (0.1, 0.1, 0.1), (0.5, 0.77, 0.3), ["desktop"]),
        ]
        self.assertFalse(validate_layout(scene)["geometry_valid"])
        result = plan_packing(scene)
        self.assertEqual(result["status"], "success")
        self.assertTrue(validate_layout(preview_scene(scene, result))["geometry_valid"])

    def test_rollback_restoring_satisfied_goals_is_not_reported_unplaced(self):
        scene = simple_scene()
        scene["regions"].extend(
            [
                region("shared", (0, 0.4, 0, 0.2)),
                region("right_only", (0.2, 0.4, 0, 0.2)),
            ]
        )
        scene["items"] = [
            item(
                "a",
                "box",
                (0.2, 0.1, 0.2),
                (0.1, 0.77, 0.1),
                ["shared"],
                frequency="high",
            ),
            item("b", "box", (0.2, 0.1, 0.2), (0.3, 0.77, 0.1), ["right_only"]),
        ]
        result = plan_packing(scene)
        self.assertEqual(result["status"], "success")
        self.assertEqual(result["issues"], [])
        self.assertTrue(
            all(i["placement_status"] == "unchanged" for i in result["items"])
        )

    def test_continuous_area_scoring_moves_divider_to_an_edge(self):
        scene = simple_scene()
        scene["desk"].update(width_m=0.1, depth_m=0.1)
        scene["regions"] = [region("desktop", (0, 0.1, 0, 0.1))]
        scene["items"] = [
            item("divider", "box", (0.02, 0.1, 0.1), (0.05, 0.77, 0.05), ["desktop"])
        ]
        self.assertAlmostEqual(measure_free_area(scene), 0.004)
        result = plan_packing(scene)
        self.assertEqual(result["status"], "success")
        self.assertAlmostEqual(measure_free_area(preview_scene(scene, result)), 0.008)

    def test_legal_manual_angle_can_remain_unchanged(self):
        scene = simple_scene()
        obj = item(
            "manual", "box", (0.1, 0.1, 0.1), (0.5, 0.77, 0.3), ["desktop"], fixed=True
        )
        obj["rotation_y_rad"] = math.pi / 3
        scene["items"] = [obj]
        result = plan_packing(scene)
        self.assertEqual(result["status"], "success")
        self.assertEqual(result["items"][0]["target_rotation_y_rad"], math.pi / 3)
        self.assertEqual(result["items"][0]["placement_status"], "unchanged")

    def test_retained_item_rolls_back_prior_move(self):
        scene = simple_scene()
        scene["regions"].extend(
            [
                region("target_a", (0, 0.3, 0, 0.3)),
                region("target_b", (0, 0.29, 0, 0.29)),
            ]
        )
        scene["items"] = [
            item("mover", "box", (0.28, 0.1, 0.28), (0.8, 0.77, 0.4), ["target_a"]),
            item(
                "retained",
                "box",
                (0.35, 0.1, 0.35),
                (0.2, 0.77, 0.2),
                ["target_a", "target_b"],
            ),
        ]
        result = plan_packing(scene)
        self.assertEqual(result["status"], "partial")
        self.assertTrue(any("rolled back" in i["message"] for i in result["issues"]))
        self.assertTrue(validate_layout(preview_scene(scene, result))["geometry_valid"])
        for original, target in zip(scene["items"], result["items"]):
            self.assertEqual(target["target_pos"], original["position"])
            self.assertEqual(target["placement_status"], "unplaced")

    def test_invalid_residual_forces_all_moves_back_to_input(self):
        scene = cases()["infeasible"]
        result = plan_packing(scene)
        self.assertEqual(result["status"], "infeasible")
        for original, target in zip(scene["items"], result["items"]):
            self.assertEqual(target["target_pos"], original["position"])
            self.assertEqual(
                target["target_rotation_y_rad"], original["rotation_y_rad"]
            )

    def test_partial_sample_retains_all_entities(self):
        scene = cases()["partial"]
        result = plan_packing(scene)
        self.assertEqual(result["status"], "partial")
        self.assertEqual(
            {i["item_id"] for i in result["items"]}, {i["id"] for i in scene["items"]}
        )
        target = next(i for i in result["items"] if i["item_id"] == "storage_box")
        self.assertEqual(target["placement_status"], "unplaced")
        self.assertEqual(target["target_region_id"], "desk_right_surface")
        self.assertTrue(validate_layout(preview_scene(scene, result))["geometry_valid"])

    def test_geometry_changes_are_rechecked_without_reusing_old_plan(self):
        scene = simple_scene()
        scene["regions"].append(region("target", (0, 0.2, 0, 0.2), 1.0, 0.2))
        scene["items"] = [
            item("a", "box", (0.1, 0.1, 0.1), (0.5, 0.77, 0.3), ["target"])
        ]
        old = plan_packing(scene)
        scene["scene_revision"] += 1
        scene["obstacles"].append(zone("new_obstacle", (0, 1.0, 0), (0.2, 1.2, 0.2)))
        with self.assertRaisesRegex(ValueError, "stale"):
            preview_scene(scene, old)
        new = plan_packing(scene)
        self.assertEqual(old["scene_revision"], 1)
        self.assertEqual(new["scene_revision"], 2)
        self.assertEqual(new["status"], "partial")
        scene["obstacles"] = []
        scene["regions"][-1]["clearance_height_m"] = 0.05
        self.assertEqual(plan_packing(scene)["status"], "partial")
        scene["regions"][-1]["clearance_height_m"] = 0.2
        scene["items"][0]["size_m"] = [0.3, 0.1, 0.3]
        self.assertEqual(plan_packing(scene)["status"], "partial")

    def test_model_replacement_does_not_change_geometry(self):
        scene = simple_scene()
        scene["items"] = [
            item("a", "box", (0.1, 0.1, 0.1), (0.5, 0.77, 0.3), ["desktop"])
        ]
        before = plan_packing(scene)
        scene["items"][0]["model_url"] = "models/generated.glb"
        after = plan_packing(scene)
        self.assertEqual(
            before["items"][0]["target_pos"], after["items"][0]["target_pos"]
        )
        self.assertEqual(after["items"][0]["model_url"], "models/generated.glb")

    def test_deterministic_and_independent_of_input_item_order(self):
        scene = simple_scene()
        scene["items"] = [
            item("a", "box", (0.1, 0.1, 0.1), (0.2, 0.77, 0.3), ["desktop"]),
            item("b", "box", (0.1, 0.1, 0.1), (0.6, 0.77, 0.3), ["desktop"]),
        ]
        first = plan_packing(scene)
        self.assertEqual(first, plan_packing(scene))
        scene["items"].reverse()
        second = plan_packing(scene)
        self.assertEqual(
            sorted(first["items"], key=lambda i: i["item_id"]),
            sorted(second["items"], key=lambda i: i["item_id"]),
        )

    def test_routing_consumes_preview_on_new_revision_without_mutating_it(self):
        scene = demo_scene()
        preview = preview_scene(scene, plan_packing(scene))
        preview["scene_revision"] += 1
        snapshot = copy.deepcopy(preview)
        routed = plan_routes(preview)
        self.assertEqual(routed["scene_revision"], 2)
        self.assertEqual(len(routed["cables"]), 3)
        self.assertEqual(preview, snapshot)
        # Routing feasibility is separate; every failure must clear its geometry.
        for cable in routed["cables"]:
            if cable["status"] == "failed":
                self.assertEqual(cable["path_points"], [])
                self.assertEqual(cable["curve_segments"], [])


class AreaTests(unittest.TestCase):
    def test_l_shaped_support_excludes_air_and_does_not_double_count_regions(self):
        scene = simple_scene()
        scene["regions"] = [
            region("main", (0, 0.7, 0, 0.4)),
            region("return", (0.7, 1, 0, 0.6)),
            region("typing", (0.2, 0.6, 0.2, 0.4)),
        ]
        self.assertAlmostEqual(measure_free_area(scene), 0.46)
        scene["regions"] = []
        self.assertEqual(measure_free_area(scene), 0)

    def test_grid_capacity_is_rejected_with_a_typed_input_error(self):
        for width, depth in ((1e308, 0.6), (1, 1e308), (20, 20)):
            with self.subTest(width=width, depth=depth):
                scene = simple_scene()
                scene["desk"].update(width_m=width, depth_m=depth)
                for operation in (plan_packing, measure_free_area):
                    with self.assertRaises(PackingInputError) as caught:
                        operation(scene)
                    self.assertEqual(caught.exception.code, "invalid_input")
                    self.assertEqual(caught.exception.field, "desk")
                    self.assertIn("grid", str(caught.exception))

    def test_huge_representable_items_outside_desktop_do_not_overflow(self):
        for x, z in ((1e308, 0.3), (-1e308, 0.3), (0.5, 1e308), (0.5, -1e308)):
            with self.subTest(x=x, z=z):
                scene = simple_scene()
                scene["items"] = [
                    item(
                        "far",
                        "box",
                        (
                            1e293 if abs(x) > 1 else 0.2,
                            0.03,
                            1e293 if abs(z) > 1 else 0.14,
                        ),
                        (x, 0.77, z),
                        ["desktop"],
                    )
                ]
                self.assertEqual(measure_free_area(scene), 0.6)

    def test_huge_reserved_zones_are_clipped_before_grid_conversion(self):
        for low, high, expected in (
            ((1e308, 0.77, 0), (1.1e308, 1, 0.6), 0.6),
            ((-1.1e308, 0.77, 0), (-1e308, 1, 0.6), 0.6),
            ((0, 0.77, 1e308), (1, 1, 1.1e308), 0.6),
            ((0, 0.77, -1.1e308), (1, 1, -1e308), 0.6),
            ((-1e308, 0.77, -1e308), (1e308, 1, 1e308), 0),
            ((-1e308, 0.77, -1e308), (0.5, 1, 1e308), 0.3),
        ):
            with self.subTest(low=low, high=high):
                scene = simple_scene()
                scene["reserved_zones"] = [zone("huge", low, high)]
                self.assertEqual(measure_free_area(scene), expected)

    def test_largest_component_not_total_free_area(self):
        scene = simple_scene()
        scene["desk"].update(width_m=0.1, depth_m=0.1)
        scene["reserved_zones"] = [zone("divider", (0.04, 0.77, 0), (0.06, 1, 0.1))]
        self.assertAlmostEqual(measure_free_area(scene), 0.004)

    def test_union_height_filter_and_grid_contact(self):
        scene = simple_scene()
        scene["desk"].update(width_m=0.1, depth_m=0.1)
        a = item("a", "box", (0.02, 0.02, 0.02), (0.01, 0.77, 0.01), ["desktop"])
        b = copy.deepcopy(a)
        b["id"] = "b"
        scene["items"] = [a, b]
        self.assertAlmostEqual(measure_free_area(scene), 0.0096)
        b["position"][1] = 1.2
        scene["reserved_zones"] = [zone("above", (0, 0.8, 0), (0.1, 1, 0.1))]
        self.assertAlmostEqual(measure_free_area(scene), 0.0096)
        a["position"][1] = 1.2
        self.assertAlmostEqual(measure_free_area(scene), 0.01)

    def test_arbitrary_rotation_uses_obb_projection(self):
        scene = simple_scene()
        scene["desk"].update(width_m=0.1, depth_m=0.1)
        diamond = item(
            "diamond",
            "box",
            (0.03 * math.sqrt(2), 0.01, 0.03 * math.sqrt(2)),
            (0.05, 0.77, 0.05),
            ["desktop"],
        )
        diamond["rotation_y_rad"] = math.pi / 4
        scene["items"] = [diamond]
        self.assertAlmostEqual(measure_free_area(scene), 0.0076)

    def test_only_whole_grid_cells_inside_desktop_are_counted(self):
        scene = simple_scene()
        scene["desk"].update(width_m=0.105, depth_m=0.105)
        self.assertAlmostEqual(measure_free_area(scene), 0.01)
        scene["desk"]["width_m"] = 0.005
        self.assertEqual(measure_free_area(scene), 0)

    def test_bitset_connectivity_matches_independent_cell_flood_fill(self):
        scene = simple_scene()
        scene["desk"].update(width_m=0.03, depth_m=0.03)
        grid = DesktopGrid(scene)
        for occupied in range(1 << 9):
            free = {
                (x, z)
                for z in range(3)
                for x in range(3)
                if not occupied & (1 << (z * 3 + x))
            }
            largest = 0
            while free:
                queue = deque([free.pop()])
                size = 0
                while queue:
                    x, z = queue.popleft()
                    size += 1
                    for neighbor in ((x + 1, z), (x - 1, z), (x, z + 1), (x, z - 1)):
                        if neighbor in free:
                            free.remove(neighbor)
                            queue.append(neighbor)
                largest = max(largest, size)
            self.assertEqual(grid.largest_component(occupied), largest)


class InputTests(unittest.TestCase):
    def test_unrepresentable_item_geometry_is_invalid_input(self):
        for size, position, rotation in (
            ((1e-20, 0.1, 0.1), (0.5, 0.77, 0.3), 0),
            ((1e-20, 0.1, 0.1), (0.5, 0.77, 0.3), math.pi / 4),
            ((0.1, 1e-20, 0.1), (0.5, 0.77, 0.3), 0),
            ((0.1, 1e308, 0.1), (0.5, 1e308, 0.3), 0),
            ((1e308, 0.1, 1e308), (1.7e308, 0.77, 1.7e308), math.pi / 4),
        ):
            with self.subTest(size=size, position=position, rotation=rotation):
                scene = simple_scene()
                obj = item("bad", "box", size, position, ["desktop"])
                obj["rotation_y_rad"] = rotation
                scene["items"] = [obj]
                for operation in (plan_packing, validate_layout, measure_free_area):
                    with self.assertRaises(PackingInputError) as caught:
                        operation(scene)
                    self.assertEqual(caught.exception.code, "invalid_input")
                    self.assertEqual(caught.exception.field, "items[0].collision")

    def test_malformed_and_unconfirmed_inputs_fail_before_planning(self):
        mutations = [
            lambda s: s.update(schema_version="2.0"),
            lambda s: s.update(scene_revision=True),
            lambda s: s.update(baseline_id=None),
            lambda s: s.update(items={}),
            lambda s: s["items"][0].update(size_m=[0.1, -1, 0.1]),
            lambda s: s["items"][0].update(position=[math.nan, 0, 0]),
            lambda s: s["items"][0].update(rotation_y_rad=math.inf),
            lambda s: s["items"][0].update(dimensions_confirmed=False),
            lambda s: s["items"][0].update(allowed_region_ids=["unknown"]),
            lambda s: s["items"][0].update(allowed_rotations_y_rad=[math.pi + 0.01]),
            lambda s: s["items"][0].update(allowed_rotations_y_rad=[False]),
            lambda s: s["items"][0].update(allowed_region_ids=[]),
            lambda s: s["items"][0].update(allowed_region_ids=[["nested"]]),
            lambda s: s["items"][0].update(fixed="false"),
            lambda s: s["items"][0]["ports"][0].update(local_direction=[0, 0, 0]),
            lambda s: s["items"][0]["ports"][0].update(capacity=True),
            lambda s: s["items"][0].update(id="desk_primary"),
            lambda s: s["routing_graph"]["nodes"][0].update(id="keyboard"),
            lambda s: s["routing_graph"]["edges"][0].update(to_node_id="unknown"),
            lambda s: s["cables"][0].update(start_port_id="unknown"),
            lambda s: s["cables"][0].update(length_m=0),
            lambda s: s["regions"][0].update(bounds_xz_m=[1, 0, 0, 1]),
            lambda s: s["obstacles"][0].update(min=[0, 0]),
            lambda s: s["items"][8].update(socket_count=6),
        ]
        for index, mutate in enumerate(mutations):
            with self.subTest(case=index):
                scene = demo_scene()
                mutate(scene)
                with self.assertRaises(PackingInputError) as caught:
                    plan_packing(scene)
                self.assertEqual(caught.exception.code, "invalid_input")
                self.assertIsNotNone(caught.exception.field)

    def test_packing_does_not_require_confirmed_cable_endpoints(self):
        scene = demo_scene()
        for obj in scene["items"]:
            for port in obj["ports"]:
                port["confirmed"] = False
        self.assertEqual(plan_packing(scene)["status"], "success")

    def test_empty_scene_is_valid_and_measurable(self):
        scene = simple_scene()
        self.assertEqual(plan_packing(scene)["status"], "success")
        self.assertEqual(plan_packing(scene)["items"], [])
        self.assertTrue(validate_layout(scene)["geometry_valid"])
        self.assertEqual(measure_free_area(scene), 0.6)


def compound_box(width, height, depth):
    """An axis-aligned box expressed as a compound part (8 vertices, 12 triangles).

    Vertex order is bottom ring (indices 0..3) then top ring (4..7), with the triangle
    winding the validator requires: ``cross(b-a, c-a)`` must face outward.
    """
    half_w, half_d = width / 2, depth / 2
    vertices = [
        [-half_w, 0.0, -half_d], [half_w, 0.0, -half_d], [half_w, 0.0, half_d], [-half_w, 0.0, half_d],
        [-half_w, height, -half_d], [half_w, height, -half_d], [half_w, height, half_d], [-half_w, height, half_d],
    ]
    faces = [
        [0, 1, 2], [0, 2, 3],      # bottom
        [4, 6, 5], [4, 7, 6],      # top
        [0, 5, 1], [0, 4, 5],      # -z
        [1, 6, 2], [1, 5, 6],      # +x
        [2, 7, 3], [2, 6, 7],      # +z
        [3, 4, 0], [3, 7, 4],      # -x
    ]
    return {"type": "compound", "parts": [{"vertices_m": vertices, "faces": faces}]}


class CompoundCollisionTests(unittest.TestCase):
    """The compound branch of the collision contract, exercised through real planning."""

    def scene_with(self, obj):
        scene = simple_scene()
        scene.update(items=[obj], regions=[region("desktop", [-0.3, 0.3, 0.1, 0.5])])
        return scene

    def asymmetric_monitor(self):
        obj = item("monitor", "monitor", (0.2, 0.5, 0.2), (0.9, 0.75, 0.9), ["desktop"])
        parts = []
        for size, bottom, offset_z in (
            ((0.072, 0.0175, 0.16), 0.0, -0.01),
            ((0.015, 0.11, 0.036), 0.0175, 0.05),
            ((0.2, 0.3725, 0.022), 0.1275, 0.0),
        ):
            part = compound_box(*size)["parts"][0]
            for vertex in part["vertices_m"]:
                vertex[1] += bottom
                vertex[2] += offset_z
            parts.append(part)
        obj["collision"] = {"type": "compound", "parts": parts}
        return obj

    def test_asymmetric_monitor_fits_exact_region_before_and_after_rotation(self):
        for angle, bounds, axis in (
            (0.0, [0.0, 1.0, 0.1, 0.26], 2),
            (math.pi / 2, [0.1, 0.26, 0.1, 0.5], 0),
        ):
            with self.subTest(angle=angle):
                obj = self.asymmetric_monitor()
                obj["allowed_rotations_y_rad"] = [angle]
                scene = self.scene_with(obj)
                target = region("desktop", bounds)
                scene["regions"] = [target]
                result = plan_packing(scene)
                self.assertEqual(result["status"], "success")
                placed = result["items"][0]
                self.assertEqual(placed["placement_status"], "placed")
                self.assertEqual(placed["target_rotation_y_rad"], angle)
                self.assertAlmostEqual(placed["target_pos"][axis], 0.19)
                moved = {
                    **obj, "position": placed["target_pos"], "rotation_y_rad": angle,
                }
                self.assertTrue(fits_region(moved, target))
                box = aabb_from_item(moved)
                self.assertAlmostEqual(box.minimum[axis], 0.1)
                self.assertAlmostEqual(box.maximum[axis], 0.26)

    def test_asymmetric_monitor_uses_real_offsets_next_to_blockers(self):
        obj = self.asymmetric_monitor()
        obj["allowed_rotations_y_rad"] = [0.0]
        scene = self.scene_with(obj)
        scene["regions"] = [region("desktop", [0.0, 1.0, 0.1, 0.6])]
        scene["obstacles"] = [
            zone("front", (0.0, 0.77, 0.1), (1.0, 1.4, 0.2)),
            zone("back", (0.0, 0.77, 0.362), (1.0, 1.4, 0.6)),
        ]
        result = plan_packing(scene)
        self.assertEqual(result["status"], "success")
        placed = result["items"][0]
        self.assertAlmostEqual(placed["target_pos"][2], 0.291)
        moved = {**obj, "position": placed["target_pos"]}
        for obstacle in scene["obstacles"]:
            self.assertFalse(item_intersects_box(
                moved, AABB(tuple(obstacle["min"]), tuple(obstacle["max"])),
            ))

    def test_pose_extent_is_relative_to_the_anchor_not_absolute(self):
        obj = item("lamp", "electrical", (0.16, 0.45, 0.18), (0.47, 0.75, 0.46), ["desktop"])
        obj["collision"] = compound_box(0.16, 0.45, 0.18)
        half_width, half_depth, height = pose_extent(obj)
        self.assertAlmostEqual(half_width, 0.08)
        self.assertAlmostEqual(half_depth, 0.09)
        self.assertAlmostEqual(height, 0.45)
        # An absolute world box would report the anchor coordinate (~0.47), which is the
        # regression this guards: the planner reads these as half-extents.
        self.assertLess(half_width, 0.1)
        self.assertLess(half_depth, 0.1)

    def test_compound_item_is_planned_into_a_region(self):
        obj = item("box", "storage", (0.2, 0.12, 0.18), (0.0, 0.75, 0.1), ["desktop"])
        obj["collision"] = compound_box(0.2, 0.12, 0.18)
        result = plan_packing(self.scene_with(obj))
        self.assertEqual(result["status"], "success")
        placed = result["items"][0]
        self.assertEqual(placed["placement_status"], "placed")
        self.assertIsNone(placed["reason_code"])
        x, y, z = placed["target_pos"]
        self.assertAlmostEqual(y, 0.77)
        self.assertGreaterEqual(x, -0.3 + 0.1 - 1e-9)
        self.assertLessEqual(x, 0.3 - 0.1 + 1e-9)
        self.assertGreaterEqual(z, 0.1 + 0.09 - 1e-9)
        self.assertLessEqual(z, 0.5 - 0.09 + 1e-9)

    def test_real_volume_decides_region_fit_not_the_declared_box(self):
        # Declared box 0.30 x 0.20; real volume 0.20 x 0.20. In a region 0.22 wide the real
        # volume fits directly, while the declared box only survives by rotating 90 degrees —
        # so forbid rotation and the two cases must diverge.
        narrow = region("desktop", [-0.11, 0.11, 0.1, 0.5])

        compound = item("lamp", "electrical", (0.30, 0.20, 0.20), (0.9, 0.75, 0.9), ["desktop"])
        compound["collision"] = compound_box(0.20, 0.20, 0.20)
        compound["allowed_rotations_y_rad"] = [0.0]
        compound_scene = self.scene_with(compound)
        compound_scene.update(items=[compound], regions=[narrow])
        compound_result = plan_packing(compound_scene)
        self.assertEqual(compound_result["status"], "success")
        self.assertEqual(compound_result["items"][0]["placement_status"], "placed")
        self.assertEqual(compound_result["items"][0]["target_region_id"], "desktop")
        x, _, z = compound_result["items"][0]["target_pos"]
        moved = {**compound, "position": [x, 0.77, z], "rotation_y_rad": 0.0}
        self.assertTrue(fits_region(moved, narrow))

        # Control: the declared 0.30 box cannot enter that region at all once rotation is off.
        plain = item("plain", "electrical", (0.30, 0.20, 0.20), (0.9, 0.75, 0.9), ["desktop"])
        plain["allowed_rotations_y_rad"] = [0.0]
        plain_scene = self.scene_with(plain)
        plain_scene.update(items=[plain], regions=[narrow])
        plain_result = plan_packing(plain_scene)
        self.assertIsNone(plain_result["items"][0]["target_region_id"])

    def test_overlapping_compound_items_are_reported_infeasible(self):
        # Two interpenetrating compound items cannot both satisfy the region, and the planner
        # must say so rather than reporting a clean success.
        first = item("a", "storage", (0.2, 0.12, 0.18), (0.0, 0.75, 0.2), ["desktop"])
        first["collision"] = compound_box(0.2, 0.12, 0.18)
        first["fixed"] = True
        second = item("b", "storage", (0.2, 0.12, 0.18), (0.02, 0.75, 0.2), ["desktop"])
        second["collision"] = compound_box(0.2, 0.12, 0.18)
        scene = simple_scene()
        scene.update(items=[first, second], regions=[region("desktop", [-0.3, 0.3, 0.1, 0.5])])
        self.assertTrue(items_overlap(first, second))

        result = plan_packing(scene)
        self.assertEqual(result["status"], "infeasible")
        codes = {i["code"] for i in result["issues"]}
        self.assertIn("collision", codes)
        self.assertTrue(any(i["placement_status"] == "unplaced" for i in result["items"]))
        # The fixed item keeps its input pose; no fabricated success.
        self.assertEqual(
            {i["item_id"]: i["target_pos"] for i in result["items"]}["a"], [0.0, 0.75, 0.2]
        )

    def test_invalid_compound_geometry_is_rejected_before_planning(self):
        obj = item("bad", "storage", (0.2, 0.12, 0.18), (0.0, 0.75, 0.2), ["desktop"])
        obj["collision"] = compound_box(0.2, 0.12, 0.18)
        # A truncated hull is not a closed manifold and must fail validation.
        obj["collision"]["parts"][0]["faces"] = obj["collision"]["parts"][0]["faces"][:6]
        with self.assertRaises(PackingInputError) as caught:
            plan_packing(self.scene_with(obj))
        self.assertEqual(caught.exception.code, "invalid_input")

    def test_compound_and_box_items_coexist_in_one_plan(self):
        compound = item("c", "storage", (0.2, 0.12, 0.18), (0.0, 0.75, 0.2), ["desktop"])
        compound["collision"] = compound_box(0.2, 0.12, 0.18)
        plain = item("p", "storage", (0.15, 0.1, 0.15), (0.15, 0.75, 0.4), ["desktop"])
        scene = simple_scene()
        scene.update(items=[compound, plain], regions=[region("desktop", [-0.3, 0.3, 0.1, 0.5])])
        result = plan_packing(scene)
        self.assertEqual(result["status"], "success")
        self.assertEqual(len(result["items"]), 2)
        self.assertEqual({i["placement_status"] for i in result["items"]}, {"placed"})
        self.assertFalse(items_overlap(
            {**compound, "position": result["items"][0]["target_pos"]},
            {**plain, "position": result["items"][1]["target_pos"]},
        ))


if __name__ == "__main__":
    unittest.main()
