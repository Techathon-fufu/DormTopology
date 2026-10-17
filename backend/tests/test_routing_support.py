import unittest
from unittest.mock import patch

from backend.app.domain.routing.geometry import AABB, BEZIER_SAMPLE_ERROR
from backend.app.domain.routing.support import (
    SupportContext,
    SupportVolume,
    analyze_support,
    build_support_context,
)


def line(start, end):
    return tuple(
        tuple(a + (b - a) * fraction for a, b in zip(start, end))
        for fraction in (0.0, 1.0 / 3.0, 2.0 / 3.0, 1.0)
    )


class SupportGeometryTests(unittest.TestCase):
    def test_legacy_scene_has_no_support_evaluation(self):
        self.assertIsNone(build_support_context({"routing_graph": {}}))

    def test_face_bands_follow_all_six_outward_normals_and_tangent_axes(self):
        obstacle = {"id": "desk", "min": [1.0, 2.0, 3.0], "max": [2.0, 3.0, 4.0]}
        for axis, letter in enumerate("xyz"):
            tangents = [index for index in range(3) if index != axis]
            bounds = [
                coordinate
                for tangent in tangents
                for coordinate in (obstacle["min"][tangent], obstacle["max"][tangent])
            ]
            for side in ("min", "max"):
                with self.subTest(face=f"{letter}_{side}"):
                    scene = {
                        "obstacles": [obstacle],
                        "routing_graph": {
                            "support_policy": {"max_unsupported_span_m": 0.1},
                            "supports": [
                                {
                                    "id": "support",
                                    "kind": "cable_tray",
                                    "obstacle_id": "desk",
                                    "face": f"{letter}_{side}",
                                    "bounds_uv_m": bounds,
                                    "stand_off_m": 0.02,
                                }
                            ],
                        },
                    }
                    context = build_support_context(scene)
                    box = context.volumes[0].box
                    normal = obstacle[side][axis]
                    expected_min = normal - 0.02 if side == "min" else normal
                    expected_max = normal if side == "min" else normal + 0.02
                    self.assertAlmostEqual(box.minimum[axis], expected_min)
                    self.assertAlmostEqual(box.maximum[axis], expected_max)
                    for tangent in tangents:
                        self.assertEqual(box.minimum[tangent], obstacle["min"][tangent])
                        self.assertEqual(box.maximum[tangent], obstacle["max"][tangent])

    def test_unmounted_underdesk_line_is_unsupported(self):
        scene = {
            "obstacles": [
                {"id": "desk", "min": [0.0, 0.7, 0.0], "max": [1.0, 0.75, 0.6]}
            ],
            "routing_graph": {
                "support_policy": {"max_unsupported_span_m": 0.2},
                "supports": [],
            },
        }
        report = analyze_support(
            [line((0.1, 0.69, 0.3), (0.9, 0.69, 0.3))],
            build_support_context(scene),
            0.002,
        )
        self.assertFalse(report.valid)
        self.assertAlmostEqual(report.max_unsupported_span_m, 0.8)
        self.assertFalse(report.exhausted)

    def test_continuously_supported_curve_is_certified(self):
        context = SupportContext(
            (SupportVolume("tray", AABB((0.0, 0.0, 0.0), (1.0, 0.1, 0.1))),), 0.02
        )
        report = analyze_support(
            [line((0.02, 0.05, 0.05), (0.98, 0.05, 0.05))], context, 0.003
        )
        self.assertTrue(report.valid)
        self.assertEqual(report.max_unsupported_span_m, 0.0)
        self.assertEqual(report.unsupported_length_m, 0.0)
        self.assertEqual(report.support_ids, ("tray",))

    def test_unsupported_runs_continue_across_bezier_seams(self):
        context = SupportContext((), 0.15)
        report = analyze_support(
            [
                line((0.0, 0.0, 0.0), (0.1, 0.0, 0.0)),
                line((0.1, 0.0, 0.0), (0.2, 0.0, 0.0)),
            ],
            context,
            0.002,
        )
        self.assertFalse(report.valid)
        self.assertAlmostEqual(report.max_unsupported_span_m, 0.2)

    def test_positive_supported_intervals_reset_unsupported_runs(self):
        context = SupportContext(
            (SupportVolume("tie", AABB((0.09, -0.02, -0.02), (0.11, 0.02, 0.02))),), 0.1
        )
        report = analyze_support(
            [line((0.0, 0.0, 0.0), (0.2, 0.0, 0.0))], context, 0.002
        )
        self.assertTrue(report.valid)
        self.assertGreater(report.unsupported_length_m, 0.18)
        self.assertLess(report.max_unsupported_span_m, 0.1)
        self.assertEqual(report.support_ids, ("tie",))

    def test_curved_length_uses_an_upper_bound_instead_of_shorter_chords(self):
        segment = ((0.0, 0.0, 0.0), (0.0, 1.0, 0.0), (1.0, 1.0, 0.0), (1.0, 0.0, 0.0))
        report = analyze_support([segment], SupportContext((), 1.5), 0.002)
        self.assertFalse(report.valid)
        self.assertEqual(report.max_unsupported_span_m, 3.0)

    def test_smoothing_that_lifts_off_support_fails_despite_supported_endpoints(self):
        context = SupportContext(
            (SupportVolume("surface", AABB((-0.1, -0.01, -0.1), (1.1, 0.01, 0.1))),),
            0.1,
        )
        segment = ((0.0, 0.0, 0.0), (0.3, 0.4, 0.0), (0.7, 0.4, 0.0), (1.0, 0.0, 0.0))
        report = analyze_support([segment], context, 0.002)
        self.assertFalse(report.valid)
        self.assertGreater(report.max_unsupported_span_m, 1.0)
        self.assertFalse(report.exhausted)

    def test_overlapping_support_union_does_not_create_artificial_gap(self):
        volumes = (
            SupportVolume("left", AABB((-0.1, -0.1, -0.1), (0.51, 0.1, 0.1))),
            SupportVolume("right", AABB((0.49, -0.1, -0.1), (1.1, 0.1, 0.1))),
        )
        report = analyze_support(
            [line((0.0, 0.0, 0.0), (1.0, 0.0, 0.0))],
            SupportContext(volumes, 0.001),
            0.002,
        )
        self.assertTrue(report.valid)
        self.assertEqual(report.unsupported_length_m, 0.0)
        self.assertEqual(report.support_ids, ("left", "right"))

    def test_narrow_gap_between_supports_cannot_be_missed(self):
        volumes = (
            SupportVolume("left", AABB((-0.1, -0.1, -0.1), (0.5, 0.1, 0.1))),
            SupportVolume("right", AABB((0.5001, -0.1, -0.1), (1.1, 0.1, 0.1))),
        )
        report = analyze_support(
            [line((0.0, 0.0, 0.0), (1.0, 0.0, 0.0))],
            SupportContext(volumes, 0.001),
            0.0,
        )
        self.assertFalse(report.valid)
        self.assertGreaterEqual(report.max_unsupported_span_m, 0.0011)
        self.assertFalse(report.exhausted)

    def test_subdivision_can_certify_curve_with_initial_controls_outside_band(self):
        volume = SupportVolume("surface", AABB((-0.1, -0.01, -0.1), (1.1, 0.02, 0.1)))
        segment = (
            (0.0, 0.0, 0.0),
            (0.3, 0.025, 0.0),
            (0.7, 0.025, 0.0),
            (1.0, 0.0, 0.0),
        )
        report = analyze_support([segment], SupportContext((volume,), 0.001), 0.0)
        self.assertTrue(report.valid)
        self.assertEqual(report.unsupported_length_m, 0.0)
        self.assertFalse(report.exhausted)

    def test_cable_volume_must_fit_inside_support_band(self):
        context = SupportContext(
            (SupportVolume("tray", AABB((0.0, 0.0, 0.0), (1.0, 0.01, 0.01))),), 0.1
        )
        report = analyze_support(
            [line((0.1, 0.005, 0.005), (0.9, 0.005, 0.005))], context, 0.005
        )
        self.assertFalse(report.valid)
        self.assertGreater(report.max_unsupported_span_m, 0.79)
        self.assertEqual(report.support_ids, ())

    def test_band_boundary_reserves_the_continuous_curve_error_margin(self):
        volume = SupportVolume("tray", AABB((0.0, 0.0, 0.0), (1.0, 0.1, 0.1)))
        context = SupportContext((volume,), 0.1)
        radius = 0.002
        y = radius + BEZIER_SAMPLE_ERROR / 2.0
        report = analyze_support(
            [line((0.1, y, 0.05), (0.9, y, 0.05))], context, radius
        )
        self.assertFalse(report.valid)

    def test_exhausted_subdivision_budget_cannot_report_success(self):
        context = SupportContext(
            (SupportVolume("tie", AABB((0.49, -0.1, -0.1), (0.51, 0.1, 0.1))),), 2.0
        )
        with patch("backend.app.domain.routing.support._MAX_SUBDIVISIONS", 0):
            report = analyze_support(
                [line((0.0, 0.0, 0.0), (1.0, 0.0, 0.0))], context, 0.002
            )
        self.assertTrue(report.exhausted)
        self.assertFalse(report.valid)
        self.assertAlmostEqual(report.unsupported_length_m, 1.0)

    def test_exhausted_depth_budget_cannot_report_success(self):
        context = SupportContext(
            (SupportVolume("tie", AABB((0.49, -0.1, -0.1), (0.51, 0.1, 0.1))),),
            2.0,
        )
        with patch("backend.app.domain.routing.support._MAX_DEPTH", 0):
            report = analyze_support(
                [line((0.0, 0.0, 0.0), (1.0, 0.0, 0.0))], context, 0.002
            )
        self.assertTrue(report.exhausted)
        self.assertFalse(report.valid)

    def test_zero_length_supported_point_does_not_reset_a_run(self):
        volume = SupportVolume("tie", AABB((-0.01, -0.01, -0.01), (0.01, 0.01, 0.01)))
        context = SupportContext((volume,), 0.11)
        # The degenerate middle segment certifies no positive support interval.
        segments = [
            line((-0.1, 0.0, 0.0), (-0.02, 0.0, 0.0)),
            ((0.0, 0.0, 0.0),) * 4,
            line((0.02, 0.0, 0.0), (0.1, 0.0, 0.0)),
        ]
        report = analyze_support(segments, context, 0.002)
        self.assertFalse(report.valid)
        self.assertAlmostEqual(report.max_unsupported_span_m, 0.16)


if __name__ == "__main__":
    unittest.main()
