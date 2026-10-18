"""Real monitor GLB: exterior coverage, empty space, transforms and planner/routing use."""
import copy
import json
import math
import unittest
from pathlib import Path

import numpy as np
import trimesh

from backend.app.domain.geometry.convex import items_overlap, segment_hits, validate_compound, world_parts
from backend.app.domain.packing import plan_packing, validate_layout
from backend.examples.packing_demo import item, region
from backend.scripts.generate_colliders import build_monitor, collider_payload, connected_meshes
from backend.tests.test_packing import simple_scene

ROOT = Path(__file__).resolve().parents[2]


def contains(part, point):
    vertices = np.asarray(part["vertices_m"])
    for a, b, c in part["faces"]:
        normal = np.cross(vertices[b] - vertices[a], vertices[c] - vertices[a])
        normal /= np.linalg.norm(normal)
        if normal @ (point - vertices[a]) > 1e-7:
            return False
    return True


class MonitorCollisionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.scene = trimesh.load(ROOT / "Prefabmodel/monitor.glb", force="scene")
        cls.collision = json.loads((ROOT / "Prefabmodel/collisionsize/monitor.collision.json").read_text())
        cls.monitor = item("monitor", "monitor", (.6, .55, .18), (.45, .77, .2), ["desktop"], fixed=True)
        cls.monitor["collision"] = cls.collision

    def test_generated_asset_matches_and_covers_every_authored_surface(self):
        self.assertEqual(collider_payload(build_monitor("monitor.glb", self.scene)), self.collision)
        validate_compound(self.collision)
        self.assertEqual(len(self.collision["parts"]), 8)
        for node in self.scene.graph.nodes_geometry:
            transform, key = self.scene.graph[node]
            mesh = self.scene.geometry[key].copy()
            mesh.apply_transform(transform)
            for face in mesh.faces:
                triangle = mesh.vertices[face]
                for u, v in [(0, 0), (1, 0), (0, 1), (.25, .25), (.5, .5), (.1, .7)]:
                    point = triangle[0] * (1 - u - v) + triangle[1] * u + triangle[2] * v
                    self.assertTrue(any(contains(p, point) for p in self.collision["parts"]), point)

    def test_empty_spaces_and_real_solids_including_bevels(self):
        for point in [(-.2, .1, 0), (.2, .1, 0), (0, .1, .04), (.117, .014, 0),
                      (.0215, .18, -.02), (.2, .4, -.001)]:
            self.assertFalse(any(contains(p, np.array(point)) for p in self.collision["parts"]), point)
        for point in [(0, .005, 0), (0, .1, -.02), (.2, .4, -.01), (0, .35, -.03), (.297, .4, -.002)]:
            self.assertTrue(any(contains(p, np.array(point)) for p in self.collision["parts"]), point)

    def test_screen_front_matches_source_triangles_not_filled_convex_hull(self):
        screen = max(connected_meshes(next(iter(self.scene.geometry.values()))), key=lambda m: m.extents[0])
        for x in [-.299, -.295, -.292, -.29, -.1, .1, .29, .292, .295, .299]:
            for y in [.211, .219, .23, .4, .54, .545, .549]:
                front = []
                for face in screen.faces:
                    tri = screen.vertices[face]
                    matrix = np.vstack([tri[:, :2].T, np.ones(3)])
                    if abs(np.linalg.det(matrix)) < 1e-12:
                        continue
                    weights = np.linalg.solve(matrix, [x, y, 1])
                    if min(weights) >= -1e-9:
                        front.append(float(weights @ tri[:, 2]))
                z = max(front)
                self.assertTrue(any(contains(p, np.array([x, y, z - 1e-5])) for p in self.collision["parts"]))
                self.assertFalse(any(contains(p, np.array([x, y, z + 1e-5])) for p in self.collision["parts"]))

    def test_authored_node_transform_is_applied_once(self):
        moved = self.scene.copy()
        matrix = trimesh.transformations.rotation_matrix(.37, [0, 1, 0])
        matrix[:3, 3] = [.3, .2, -.1]
        moved.apply_transform(matrix)
        result = collider_payload(build_monitor("monitor.glb", moved))
        for part in self.collision["parts"]:
            for point in trimesh.transform_points(part["vertices_m"], matrix):
                self.assertTrue(any(contains(p, point) for p in result["parts"]))
        self.assertEqual(len(result["parts"]), 8)

    def test_low_neighbor_under_screen_fits_but_actual_monitor_material_blocks(self):
        scene = simple_scene()
        neighbor = item("neighbor", "box", (.08, .08, .08), (.66, .77, .2), ["beside-base"])
        scene.update(items=[copy.deepcopy(self.monitor), neighbor],
                     regions=[region("desktop", (0, 1, 0, .6)), region("beside-base", (.62, .70, .16, .24))],
                     constraints={"min_item_gap_m": .02})
        self.assertFalse(items_overlap(*scene["items"]))
        self.assertTrue(validate_layout(scene)["geometry_valid"])
        result = plan_packing(scene)
        self.assertEqual(result["status"], "success", result)
        for position in [(.45, .77, .2), (.45, .85, .18), (.65, 1.1, .19)]:
            probe = {**neighbor, "position": list(position)}
            self.assertTrue(items_overlap(self.monitor, probe), position)

    def test_void_and_solid_rays_after_rotation(self):
        for angle in [0, math.pi / 6, math.pi / 2]:
            monitor = {**self.monitor, "rotation_y_rad": angle}
            def world(point):
                x, y, z = point
                return (math.cos(angle) * x + math.sin(angle) * z + .45, y + .77,
                        -math.sin(angle) * x + math.cos(angle) * z + .2)
            for x, y, hit in [(.2, .1, False), (0, .1, True), (.2, .4, True)]:
                self.assertEqual(segment_hits(world((x, y, -.1)), world((x, y, .1)), world_parts(monitor), .003), hit)


if __name__ == "__main__":
    unittest.main()
