import copy
import math
import unittest

from backend.app.domain.geometry import (
    add,
    direction_to_world,
    fits_region,
    local_to_world,
    normalize,
    scale,
)
from backend.app.domain.geometry.convex import segment_hits, world_parts
from backend.app.domain.packing import plan_packing, validate_layout
from backend.examples.packing_demo import item, preview_scene, region
from backend.tests.test_packing import simple_scene


def connector(direction=(1, 0, 0), position=(.1, .05, 0)):
    return {"id": "device-port", "type": "usb", "local_position": list(position),
            "local_direction": list(direction), "capacity": 1, "confirmed": False}


def port_is_blocked(device, blocker):
    port = device["ports"][0]
    start = local_to_world(device, port["local_position"])
    direction = normalize(direction_to_world(device, port["local_direction"]))
    return segment_hits(start, add(start, scale(direction, .025)), world_parts(blocker), .005)


class PackingPortAccessTests(unittest.TestCase):
    def test_furniture_does_not_block_rear_connector(self):
        scene = simple_scene()
        scene['obstacles'] = [{'id': 'baffle', 'min': [0, .77, 0], 'max': [1, 1, .05]}]
        device = item('device', 'device', (.2, .1, .1), (.5, .77, .11), ['desktop'])
        device['ports'] = [connector((0, 0, -1), (0, .05, -.05))]
        device['allowed_rotations_y_rad'] = [0]
        scene['items'] = [device]
        result = plan_packing(scene)
        applied = preview_scene(scene, result)['items'][0]
        blocker = item('baffle', 'box', (1, .23, .05), (.5, .77, .025), ['desktop'])
        self.assertEqual(result['status'], 'success')
        self.assertTrue(port_is_blocked(device, blocker))
        self.assertFalse(port_is_blocked(applied, blocker))

    def test_device_keeps_its_outward_connector_accessible(self):
        scene = simple_scene()
        scene["regions"].append(region("left", (0, .3, 0, .6)))
        blocker = item("blocker", "box", (.2, .1, .6), (.4, .77, .3), ["desktop"], fixed=True)
        device = item("device", "device", (.2, .1, .1), (.2, .77, .3), ["left"])
        device["ports"] = [connector()]
        device["allowed_rotations_y_rad"] = [0]
        scene["items"] = [device, blocker]
        original = copy.deepcopy(scene)
        self.assertTrue(port_is_blocked(device, blocker))
        result = plan_packing(scene)
        applied = preview_scene(scene, result)
        self.assertEqual(result["status"], "success")
        self.assertTrue(validate_layout(applied)["geometry_valid"])
        self.assertFalse(port_is_blocked(applied["items"][0], applied["items"][1]))
        self.assertEqual(scene, original)

    def test_clutter_does_not_block_an_already_placed_connector(self):
        scene = simple_scene()
        scene["regions"].append(region("left", (0, .3, 0, .6)))
        device = item("device", "device", (.2, .1, .6), (.4, .77, .3), ["desktop"], fixed=True)
        device["ports"] = [connector((-1, 0, 0), (-.1, .05, 0))]
        clutter = item("clutter", "box", (.2, .1, .6), (.2, .77, .3), ["left"])
        clutter["allowed_rotations_y_rad"] = [0]
        scene["items"] = [device, clutter]
        self.assertTrue(port_is_blocked(device, clutter))
        applied = preview_scene(scene, plan_packing(scene))
        self.assertFalse(port_is_blocked(applied["items"][0], applied["items"][1]))
        self.assertEqual(applied["items"][0]["position"], device["position"])
        self.assertTrue(validate_layout(applied)["geometry_valid"])

    def test_rotated_connector_uses_its_world_direction(self):
        scene = simple_scene()
        scene["regions"].append(region("device-zone", (.4, .6, .15, .6)))
        blocker = item("blocker", "box", (.6, .1, .1), (.5, .77, .1), ["desktop"], fixed=True)
        device = item("device", "device", (.2, .1, .2), (.5, .77, .25), ["device-zone"])
        device["rotation_y_rad"] = math.pi / 2
        device["allowed_rotations_y_rad"] = [math.pi / 2]
        device["ports"] = [connector()]
        scene["items"] = [device, blocker]
        self.assertTrue(port_is_blocked(device, blocker))
        applied = preview_scene(scene, plan_packing(scene))
        self.assertFalse(port_is_blocked(applied["items"][0], applied["items"][1]))
        self.assertTrue(validate_layout(applied)["geometry_valid"])

    def test_access_is_soft_and_preserves_preferred_regions(self):
        scene = simple_scene()
        scene["regions"].append(region("preferred", (.1, .3, 0, .6)))
        blocker = item("blocker", "box", (.2, .1, .6), (.4, .77, .3), ["desktop"], fixed=True)
        device = item("device", "device", (.2, .1, .1), (.2, .77, .3), ["preferred", "desktop"])
        device["preferred_region_ids"] = ["preferred"]
        device["allowed_rotations_y_rad"] = [0]
        device["ports"] = [connector()]
        scene["items"] = [device, blocker]
        result = plan_packing(scene)
        applied = preview_scene(scene, result)
        self.assertTrue(fits_region(applied["items"][0], scene["regions"][-1]))
        self.assertTrue(port_is_blocked(applied["items"][0], applied["items"][1]))
        self.assertTrue(validate_layout(applied)["geometry_valid"])


if __name__ == "__main__":
    unittest.main()
