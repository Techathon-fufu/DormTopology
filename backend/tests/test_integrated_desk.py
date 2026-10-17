import copy
import unittest

from backend.app.domain.geometry import fits_region
from backend.app.domain.packing import validate_layout
from backend.app.domain.routing import plan_routing, resolve_port_world
from backend.examples.integrated_desk import build_applied_scenario


class IntegratedDeskTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.baseline, cls.packing, cls.applied, cls.routing = build_applied_scenario()

    def test_baseline_is_editable_without_body_collisions(self):
        movable = [value for value in self.baseline["items"] if not value["fixed"]]
        self.assertEqual(len(movable), 8)
        self.assertEqual(
            {value["id"] for value in movable},
            {
                "monitor",
                "printer",
                "laptop",
                "keyboard",
                "mouse",
                "book",
                "cup",
                "tissue",
            },
        )
        baseline_check = validate_layout(self.baseline)
        self.assertTrue(baseline_check["geometry_valid"])
        self.assertTrue(
            all(issue["code"] == "no_space" for issue in baseline_check["issues"])
        )
        self.assertEqual(self.baseline["template_id"], "integrated_desk_v1")
        self.assertTrue(
            all(value["model_url"] is None for value in self.baseline["items"])
        )
        self.assertNotIn("curve_segments", self.baseline)

    def test_layout_reserves_large_devices_and_front_working_positions(self):
        self.assertEqual(self.packing["status"], "success")
        self.assertTrue(validate_layout(self.applied)["geometry_valid"])
        before = {value["id"]: value for value in self.baseline["items"]}
        after = {value["id"]: value for value in self.applied["items"]}
        regions = {value["id"]: value for value in self.applied["regions"]}
        expected = {
            "monitor": "monitor_back_center",
            "printer": "printer_right",
            "laptop": "laptop_left",
            "keyboard": "keyboard_front",
            "mouse": "mouse_front_right",
            "tissue": "drawer",
        }
        for identifier, region_id in expected.items():
            with self.subTest(identifier=identifier):
                self.assertTrue(fits_region(after[identifier], regions[region_id]))
        for identifier in ("book", "cup"):
            self.assertTrue(
                any(
                    fits_region(after[identifier], regions[f"shelf_{index}"])
                    for index in range(1, 5)
                )
            )
        secondary = [
            value["placement_priority"]
            for value in before.values()
            if not value["fixed"] and value["id"] not in ("monitor", "printer")
        ]
        self.assertGreater(
            before["monitor"]["placement_priority"],
            before["printer"]["placement_priority"],
        )
        self.assertGreater(before["printer"]["placement_priority"], max(secondary))
        for identifier in ("monitor", "printer"):
            self.assertNotEqual(
                before[identifier]["position"], after[identifier]["position"]
            )
        self.assertLess(
            after["monitor"]["position"][2], after["keyboard"]["position"][2]
        )
        self.assertGreater(
            after["printer"]["position"][0], after["monitor"]["position"][0]
        )

    def test_adapter_is_directly_mounted_without_a_fictitious_cable(self):
        items = {value["id"]: value for value in self.applied["items"]}
        strip, adapter = items["power_strip"], items["power_adapter"]
        self.assertEqual(strip["socket_count"], 4)
        self.assertEqual(
            sum(value["type"] == "power_source" for value in strip["ports"]), 4
        )
        self.assertEqual(
            adapter["plug_mount"],
            {
                "socket_port_id": "strip_socket_1",
                "plug_port_id": "adapter_plug",
            },
        )
        socket = next(
            value for value in strip["ports"] if value["id"] == "strip_socket_1"
        )
        plug = next(
            value for value in adapter["ports"] if value["id"] == "adapter_plug"
        )
        socket_position, socket_direction = resolve_port_world(strip, socket)
        plug_position, plug_direction = resolve_port_world(adapter, plug)
        for first, second in zip(socket_position, plug_position):
            self.assertAlmostEqual(first, second)
        for first, second in zip(socket_direction, plug_direction):
            self.assertAlmostEqual(first, -second)
        self.assertAlmostEqual(
            adapter["position"][1], strip["position"][1] + strip["size_m"][1]
        )
        self.assertEqual(len(self.applied["cables"]), 3)
        flexible_ports = {
            identifier
            for value in self.applied["cables"]
            for identifier in (value["start_port_id"], value["end_port_id"])
        }
        self.assertNotIn("adapter_plug", flexible_ports)
        self.assertNotIn("strip_socket_1", flexible_ports)

    def test_routing_uses_applied_revision_and_verified_rear_underdesk_paths(self):
        self.assertEqual(
            self.applied["scene_revision"], self.baseline["scene_revision"] + 1
        )
        self.assertEqual(self.routing["scene_revision"], self.applied["scene_revision"])
        self.assertEqual(self.routing["status"], "success")
        self.assertEqual(len(self.routing["cables"]), 3)
        ports = {
            port["id"]: (value, port)
            for value in self.applied["items"]
            for port in value["ports"]
        }
        cable_specs = {value["id"]: value for value in self.applied["cables"]}
        for value in self.routing["cables"]:
            with self.subTest(cable=value["id"]):
                self.assertEqual(value["status"], "valid")
                self.assertTrue(value["curve_segments"])
                self.assertEqual(value["support_check"]["status"], "verified")
                self.assertLessEqual(
                    value["support_check"]["max_unsupported_span_m"], 0.23
                )
                spec = cable_specs[value["id"]]
                self.assertLessEqual(
                    value["path_length_m"] + spec["slack_m"], spec["length_m"]
                )
                for index, endpoint in ((0, "start_port_id"), (-1, "end_port_id")):
                    expected, _ = resolve_port_world(*ports[spec[endpoint]])
                    for actual, coordinate in zip(
                        value["path_points"][index], expected
                    ):
                        self.assertAlmostEqual(actual, coordinate)
                if value["id"] != "strip_bus":
                    self.assertTrue(
                        any(
                            point[1] < 0.745 and point[2] < 0
                            for point in value["path_points"]
                        )
                    )
                    self.assertTrue(
                        any(
                            point[1] < 0.745 and point[2] > 0
                            for point in value["path_points"]
                        )
                    )
        baseline_monitor = next(
            value for value in self.baseline["items"] if value["id"] == "monitor"
        )
        old_position, _ = resolve_port_world(
            baseline_monitor, baseline_monitor["ports"][0]
        )
        route = next(
            value for value in self.routing["cables"] if value["id"] == "monitor_cable"
        )
        self.assertNotEqual(list(old_position), route["path_points"][-1])

    def test_direct_plug_occupies_socket_capacity(self):
        changed = copy.deepcopy(self.applied)
        printer = next(
            value for value in changed["cables"] if value["id"] == "printer_cable"
        )
        printer["start_port_id"] = "strip_socket_1"
        invalid = plan_routing(changed)
        result = next(
            value for value in invalid["cables"] if value["id"] == "printer_cable"
        )
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["reason_code"], "port_occupied")
        self.assertEqual(result["curve_segments"], [])

    def test_optional_tray_does_not_create_route_feasibility(self):
        recommendation = self.routing["underside_tray_optimizations"][0]
        self.assertEqual(recommendation["status"], "recommended")
        self.assertEqual(
            set(recommendation["cable_ids"]), {"monitor_cable", "printer_cable"}
        )
        self.assertGreater(recommendation["shared_length_m"], 0.4)
        self.assertLessEqual(
            recommendation["occupied_width_m"], recommendation["available_width_m"]
        )
        self.assertIsNone(recommendation["support_id"])
        self.assertTrue(recommendation["requires_installation"])
        changed = copy.deepcopy(self.applied)
        del changed["routing_graph"]["tray_candidates"]
        snapshot = copy.deepcopy(changed)
        without_tray = plan_routing(changed)
        self.assertEqual(changed, snapshot)
        self.assertEqual(without_tray["cables"], self.routing["cables"])
        self.assertFalse(
            any(
                value["kind"] == "cable_tray"
                for value in changed["routing_graph"]["supports"]
            )
        )


if __name__ == "__main__":
    unittest.main()
