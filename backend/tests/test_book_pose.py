import copy
import math
import unittest

from backend.app.domain.geometry import (
    aabb_from_item, direction_to_local, direction_to_world, local_to_world, world_to_local,
)
from backend.app.domain.geometry.collision_generator import generate_compound_box
from backend.app.domain.packing import plan_packing, validate_layout, measure_free_area
from backend.app.domain.rules import validate_scene
from backend.app.service.organization import _apply_targets
from backend.app.service.errors import InvalidInput
from backend.examples.packing_demo import item, preview_scene, region
from backend.tests.test_packing import simple_scene


def book_scene(clearance=.4, width=.3):
    scene = simple_scene()
    scene['regions'] = [region('desktop', (0, width, 0, .4), clearance=clearance)]
    scene['items'] = [item('book', 'book', (.21, .025, .28), (.15, .77, .2), ['desktop'])]
    return scene


class BookPoseTests(unittest.TestCase):
    def test_stands_book_without_changing_dimensions_or_input(self):
        scene = book_scene()
        before = copy.deepcopy(scene)
        result = plan_packing(scene)
        self.assertEqual(result['status'], 'success')
        self.assertEqual(result['items'][0]['target_book_pose'], 'upright')
        applied = _apply_targets(scene, result)
        self.assertTrue(validate_layout(applied)['geometry_valid'])
        self.assertEqual(applied['items'][0]['size_m'], before['items'][0]['size_m'])
        self.assertAlmostEqual(aabb_from_item(applied['items'][0]).maximum[1], 1.05)
        self.assertEqual(scene, before)
        self.assertGreater(measure_free_area(applied), measure_free_area(scene))

    def test_upright_fits_narrow_shelf_that_cannot_fit_flat_book(self):
        scene = book_scene(width=.04)
        result = plan_packing(scene)
        self.assertEqual(result['status'], 'success')
        self.assertEqual(result['items'][0]['target_book_pose'], 'upright')
        self.assertTrue(validate_layout(preview_scene(scene, result))['geometry_valid'])

    def test_low_clearance_falls_back_to_flat(self):
        scene = book_scene(clearance=.05)
        result = plan_packing(scene)
        self.assertEqual(result['status'], 'success')
        self.assertNotEqual(result['items'][0]['target_book_pose'], 'upright')
        self.assertTrue(validate_layout(preview_scene(scene, result))['geometry_valid'])

    def test_fixed_book_retains_original_posture_and_rejects_forgery(self):
        scene = book_scene()
        scene['items'][0]['fixed'] = True
        result = plan_packing(scene)
        self.assertEqual(result['items'][0]['target_book_pose'], 'original')
        result['items'][0]['target_book_pose'] = 'upright'
        with self.assertRaises(InvalidInput):
            _apply_targets(scene, result)

    def test_ports_round_trip_and_direction_use_posture_and_heading(self):
        obj = book_scene()['items'][0]
        obj.update(book_pose='upright', rotation_y_rad=math.pi / 2)
        for local in ((0, 0, 0), (.1, .02, -.1)):
            recovered = world_to_local(obj, local_to_world(obj, local))
            for a, b in zip(local, recovered):
                self.assertAlmostEqual(a, b)
        direction = direction_to_world(obj, (0, 0, 1))
        self.assertEqual(direction, (0, 1, 0))
        self.assertEqual(direction_to_local(obj, direction), (0, 0, 1))

    def test_compound_matches_box_with_twenty_mm_spacing(self):
        scene = book_scene()
        scene['constraints'] = {'min_item_gap_m': .02}
        second = copy.deepcopy(scene['items'][0])
        second['id'] = 'second-book'
        second['collision'] = generate_compound_box(*second['size_m'])
        scene['items'].append(second)
        result = plan_packing(scene)
        self.assertEqual(result['status'], 'success')
        applied = _apply_targets(scene, result)
        self.assertTrue(all(obj.get('book_pose') == 'upright' for obj in applied['items']))
        self.assertTrue(validate_layout(applied)['geometry_valid'])

    def test_existing_upright_asset_is_not_rotated_twice(self):
        scene = book_scene()
        scene['items'][0]['size_m'] = [.16, .28, .15]
        result = plan_packing(scene)
        applied = _apply_targets(scene, result)
        box = aabb_from_item(applied['items'][0])
        self.assertAlmostEqual(box.maximum[1] - box.minimum[1], .28)

    def test_invalid_posture_or_nonbook_posture_is_rejected(self):
        for category, posture in [('book', 'sideways'), ('box', 'upright')]:
            scene = book_scene()
            scene['items'][0].update(category=category, book_pose=posture)
            with self.assertRaises(ValueError):
                validate_scene(scene)


if __name__ == '__main__':
    unittest.main()
