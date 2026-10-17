"""Regression tests for the convex compound collision caches.

These tests pin the exactness and cache-invalidation contract of
``backend.app.domain.geometry.convex``:

* exact SAT agreement with an independent reference implementation,
* in-place mutation of collision vertices, rotation, position and box size,
* edge-touching tolerance, separation, and same-id independent scenes,
* no reliance on object identity for cache correctness.
"""
import copy
import itertools
import math
import unittest

from backend.app.domain.geometry import items_overlap as public_items_overlap
from backend.app.domain.geometry.convex import (
    TOLERANCE,
    bounds,
    items_overlap,
    local_parts,
    overlap,
    world_parts,
)


def compound_box(width, height, depth, offset=(0.0, 0.0, 0.0)):
    """Axis-aligned box as a single closed convex part (8 vertices, 12 faces)."""
    half_w, half_d = width / 2, depth / 2
    ox, oy, oz = offset
    vertices = [
        [-half_w + ox, 0.0 + oy, -half_d + oz],
        [half_w + ox, 0.0 + oy, -half_d + oz],
        [half_w + ox, 0.0 + oy, half_d + oz],
        [-half_w + ox, 0.0 + oy, half_d + oz],
        [-half_w + ox, height + oy, -half_d + oz],
        [half_w + ox, height + oy, -half_d + oz],
        [half_w + ox, height + oy, half_d + oz],
        [-half_w + ox, height + oy, half_d + oz],
    ]
    faces = [
        [0, 1, 2], [0, 2, 3],
        [4, 6, 5], [4, 7, 6],
        [0, 5, 1], [0, 4, 5],
        [1, 6, 2], [1, 5, 6],
        [2, 7, 3], [2, 6, 7],
        [3, 4, 0], [3, 7, 4],
    ]
    return {"type": "compound", "parts": [{"vertices_m": vertices, "faces": faces}]}


def make_item(item_id, size, position, rotation=0.0, collision=None):
    return {
        "id": item_id,
        "size_m": list(size),
        "position": list(position),
        "rotation_y_rad": rotation,
        "collision": collision if collision is not None else {"type": "box"},
    }


def reference_items_overlap(a, b):
    """Independent tiny SAT reference: expands all local parts then tests axes.

    Written without caching and with a flat 3D dot so it can cross-check the
    cached production path exactly.
    """
    def reference_dot(u, v):
        return u[0] * v[0] + u[1] * v[1] + u[2] * v[2]

    def reference_sub(u, v):
        return (u[0] - v[0], u[1] - v[1], u[2] - v[2])

    def reference_cross(u, v):
        return (
            u[1] * v[2] - u[2] * v[1],
            u[2] * v[0] - u[0] * v[2],
            u[0] * v[1] - u[1] * v[0],
        )

    def reference_unit(u):
        norm = math.sqrt(reference_dot(u, u))
        if norm <= 1e-12:
            return None
        return (u[0] / norm, u[1] / norm, u[2] / norm)

    def reference_rotate(v, angle):
        c, s = math.cos(angle), math.sin(angle)
        return (c * v[0] + s * v[2], v[1], -s * v[0] + c * v[2])

    def reference_axes(values):
        out = []
        for value in values:
            n = reference_unit(value)
            if n and not any(abs(reference_dot(n, p)) > 1 - 1e-9 for p in out):
                out.append(n)
        return tuple(out)

    def reference_parts(item):
        collision = item.get("collision", {"type": "box"})
        if collision["type"] == "compound":
            prepared = []
            for part in collision["parts"]:
                vertices = tuple(tuple(v) for v in part["vertices_m"])
                faces = tuple(tuple(f) for f in part["faces"])
                normals, edges = [], []
                for i, j, k in faces:
                    pa, pb, pc = vertices[i], vertices[j], vertices[k]
                    normals.append(reference_cross(reference_sub(pb, pa), reference_sub(pc, pa)))
                    edges.extend((
                        reference_sub(pb, pa),
                        reference_sub(pc, pb),
                        reference_sub(pa, pc),
                    ))
                prepared.append((vertices, reference_axes(normals), reference_axes(edges)))
        else:
            w, h, d = item["size_m"]
            vertices = tuple(
                (x, y, z)
                for x in (-w / 2, w / 2)
                for y in (0, h)
                for z in (-d / 2, d / 2)
            )
            identity = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))
            prepared = [(vertices, identity, identity)]

        angle, position = item["rotation_y_rad"], item["position"]
        world = []
        for vertices, normals, edges in prepared:
            world.append((
                tuple(
                    tuple(x + y for x, y in zip(reference_rotate(v, angle), position))
                    for v in vertices
                ),
                tuple(reference_rotate(n, angle) for n in normals),
                tuple(reference_rotate(e, angle) for e in edges),
            ))
        return world

    def reference_overlap(pa, pb):
        av, an, ae = pa
        bv, bn, be = pb
        amin = tuple(min(v[i] for v in av) for i in range(3))
        amax = tuple(max(v[i] for v in av) for i in range(3))
        bmin = tuple(min(v[i] for v in bv) for i in range(3))
        bmax = tuple(max(v[i] for v in bv) for i in range(3))
        for i in range(3):
            if min(amax[i], bmax[i]) - max(amin[i], bmin[i]) <= TOLERANCE:
                return False
        for axis in (*an, *bn, *(reference_cross(x, y) for x in ae for y in be)):
            n = reference_unit(axis)
            if n is None:
                continue
            pa_proj = [reference_dot(v, n) for v in av]
            pb_proj = [reference_dot(v, n) for v in bv]
            if min(max(pa_proj), max(pb_proj)) - max(min(pa_proj), min(pb_proj)) <= TOLERANCE:
                return False
        return True

    return any(
        reference_overlap(pa, pb)
        for pa in reference_parts(a)
        for pb in reference_parts(b)
    )


class CacheOverlapTests(unittest.TestCase):
    def test_world_parts_reflects_in_place_position_and_rotation(self):
        obj = make_item("a", (0.2, 0.1, 0.2), (0.0, 0.0, 0.0))
        first = world_parts(obj)
        obj["position"][0] = 1.0
        second = world_parts(obj)
        self.assertNotEqual(first, second)
        obj["rotation_y_rad"] = math.pi / 2
        third = world_parts(obj)
        self.assertNotEqual(second, third)

    def test_bounds_reflects_in_place_vertex_edits(self):
        obj = make_item("a", (0.0, 0.0, 0.0), (0.0, 0.0, 0.0), collision=compound_box(0.2, 0.1, 0.2))
        parts = local_parts(obj)
        vertices = [list(v) for v in parts[0][0]]
        lo, hi = bounds(vertices)
        for vertex in vertices:
            vertex[0] += 1.0
        lo2, hi2 = bounds(vertices)
        self.assertNotEqual(lo, lo2)
        self.assertAlmostEqual(lo2[0], lo[0] + 1.0)
        self.assertAlmostEqual(hi2[0], hi[0] + 1.0)

    def test_separation_and_overlap_for_translated_boxes(self):
        base = make_item("b", (0.2, 0.1, 0.2), (0.0, 0.0, 0.0))
        far = make_item("f", (0.2, 0.1, 0.2), (0.5, 0.0, 0.0))
        self.assertFalse(items_overlap(base, far))
        self.assertTrue(reference_items_overlap(base, far) is False)
        near = make_item("n", (0.2, 0.1, 0.2), (0.05, 0.0, 0.0))
        self.assertTrue(items_overlap(base, near))
        self.assertTrue(reference_items_overlap(base, near))

    def test_touching_faces_do_not_overlap(self):
        a = make_item("a", (0.2, 0.1, 0.2), (0.0, 0.0, 0.0))
        b = make_item("b", (0.2, 0.1, 0.2), (0.2, 0.0, 0.0))
        self.assertFalse(items_overlap(a, b))
        self.assertFalse(reference_items_overlap(a, b))

    def test_small_penetration_is_overlap(self):
        a = make_item("a", (0.2, 0.1, 0.2), (0.0, 0.0, 0.0))
        b = make_item("b", (0.2, 0.1, 0.2), (0.1995, 0.0, 0.0))
        self.assertTrue(items_overlap(a, b))
        self.assertTrue(reference_items_overlap(a, b))

    def test_rotation_changes_overlap_outcome(self):
        a = make_item("a", (0.5, 0.1, 0.2), (0.0, 0.0, 0.0))
        b = make_item("b", (0.5, 0.1, 0.2), (0.0, 0.0, 0.0))
        b["rotation_y_rad"] = math.pi / 4
        # b rotated away about the origin may still intersect; check consistency.
        self.assertEqual(items_overlap(a, b), reference_items_overlap(a, b))
        b["position"] = [0.4, 0.0, 0.4]
        self.assertEqual(items_overlap(a, b), reference_items_overlap(a, b))

    def test_mutated_collision_vertices_are_observed(self):
        a = make_item("a", (0.2, 0.1, 0.2), (0.0, 0.0, 0.0), collision=compound_box(0.2, 0.1, 0.2))
        b = make_item("b", (0.2, 0.1, 0.2), (0.35, 0.0, 0.0), collision=compound_box(0.2, 0.1, 0.2))
        self.assertFalse(items_overlap(a, b))
        # Widen b's real collision volume in place until it penetrates a.
        part = b["collision"]["parts"][0]
        for vertex in part["vertices_m"]:
            vertex[0] -= 0.2
        self.assertTrue(items_overlap(a, b))
        self.assertTrue(reference_items_overlap(a, b))

    def test_mutated_box_dimensions_are_observed(self):
        a = make_item("a", (0.2, 0.1, 0.2), (0.0, 0.0, 0.0))
        b = make_item("b", (0.2, 0.1, 0.2), (0.35, 0.0, 0.0))
        self.assertFalse(items_overlap(a, b))
        b["size_m"][0] = 0.6
        self.assertTrue(items_overlap(a, b))
        self.assertTrue(reference_items_overlap(a, b))

    def test_same_id_independent_scenes_do_not_share_cached_state(self):
        first = make_item("shared", (0.2, 0.1, 0.2), (0.0, 0.0, 0.0))
        other = make_item("shared", (0.2, 0.1, 0.2), (0.0, 0.0, 0.0))
        probe = make_item("probe", (0.2, 0.1, 0.2), (0.05, 0.0, 0.0))
        self.assertTrue(items_overlap(first, probe))
        # Mutating the second item with the same id must not affect the first result.
        other["position"][0] = 5.0
        self.assertFalse(items_overlap(other, probe))
        self.assertTrue(items_overlap(first, probe))

    def test_public_items_overlap_agrees_with_reference(self):
        a = make_item("a", (0.2, 0.1, 0.2), (0.0, 0.0, 0.0), collision=compound_box(0.2, 0.1, 0.2))
        b = make_item("b", (0.2, 0.1, 0.2), (0.15, 0.0, 0.0), collision=compound_box(0.2, 0.1, 0.2))
        self.assertEqual(public_items_overlap(a, b), reference_items_overlap(a, b))
        self.assertTrue(public_items_overlap(a, b))

    def test_exact_agreement_over_perturbation_grid(self):
        base_a = make_item("a", (0.2, 0.1, 0.2), (0.0, 0.0, 0.0), collision=compound_box(0.2, 0.1, 0.2))
        base_b = make_item("b", (0.2, 0.1, 0.2), (0.0, 0.0, 0.0), collision=compound_box(0.2, 0.1, 0.2))
        for dx, dy, dz in itertools.product((0.0, 0.1, 0.2, 0.3), repeat=3):
            b = copy.deepcopy(base_b)
            b["position"] = [dx, dy, dz]
            with self.subTest(offset=(dx, dy, dz)):
                self.assertEqual(
                    items_overlap(base_a, b),
                    reference_items_overlap(base_a, b),
                )

    def test_overlap_direct_parts_consistent_after_mutation(self):
        a = world_parts(make_item("a", (0.2, 0.1, 0.2), (0.0, 0.0, 0.0)))[0]
        b = world_parts(make_item("b", (0.2, 0.1, 0.2), (0.05, 0.0, 0.0)))[0]
        self.assertTrue(overlap(a, b))
        c = world_parts(make_item("c", (0.2, 0.1, 0.2), (0.5, 0.0, 0.0)))[0]
        self.assertFalse(overlap(a, c))


if __name__ == "__main__":
    unittest.main()
