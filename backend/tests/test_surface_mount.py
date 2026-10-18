"""A PDU is supported by a real backboard face, with all collisions retained."""
import copy
import unittest
from backend.tests.test_packing import simple_scene
from backend.examples.packing_demo import item, port, zone
from backend.app.domain.rules import validate_scene
from backend.app.domain.errors import SceneInputError
from backend.app.domain.packing import validate_layout, plan_packing


def mounted_scene():
    scene = simple_scene()
    strip = item('pdu', 'power_strip', (.21, .05, .03), (.5, .625, .075), [], fixed=True)
    strip['surface_mount'] = {'obstacle_id': 'backboard', 'face': 'z_max'}
    strip['socket_count'] = 4
    strip['ports'] = [port(f'socket-{i}', 'power_source', ((i-1.5)*.05, .025, .015), (0,0,1)) for i in range(4)]
    strip['ports'].append(port('bus', 'power_sink', (.105,.025,0), (1,0,0)))
    scene['items'] = [strip]
    scene['obstacles'] = [zone('backboard', (0,.575,.042), (1,.725,.06))]
    return scene


class SurfaceMountTests(unittest.TestCase):
    def test_real_contact_and_fixed_plan(self):
        scene = mounted_scene()
        self.assertTrue(validate_layout(scene)['geometry_valid'])
        result = plan_packing(scene)
        self.assertEqual(result['status'], 'success')
        self.assertEqual(result['items'][0]['target_pos'], scene['items'][0]['position'])
        self.assertIsNone(result['items'][0]['target_region_id'])

    def test_reference_and_only_fixed_pdu(self):
        for changes in [ {'surface_mount': {'obstacle_id':'missing', 'face':'z_max'}},
                         {'surface_mount': {'obstacle_id':'backboard', 'face':'y_max'}},
                         {'category':'box'}, {'fixed':False} ]:
            with self.subTest(changes=changes):
                scene = mounted_scene()
                scene['items'][0].update(changes)
                with self.assertRaises(SceneInputError): validate_scene(scene)

    def test_separation_bounds_and_rotation_rejected(self):
        for changes in [{'position':[.5,.625,.1]}, {'position':[.02,.625,.075]},
                        {'position':[.5,.71,.075]}, {'rotation_y_rad':.1}]:
            with self.subTest(changes=changes):
                scene = mounted_scene()
                scene['items'][0].update(changes)
                check = validate_layout(scene)
                self.assertFalse(check['geometry_valid'])
                self.assertTrue(any(i['code']=='no_space' for i in check['issues']))

    def test_mount_never_exempts_collisions(self):
        scene = mounted_scene()
        scene['items'][0]['position'][2] -= .002
        self.assertTrue(any(i['code']=='collision' for i in validate_layout(scene)['issues']))
        scene = mounted_scene()
        scene['obstacles'].append(zone('blocker', (.49,.63,.07), (.51,.66,.10)))
        self.assertTrue(any(i['code']=='collision' for i in validate_layout(scene)['issues']))
        scene = mounted_scene()
        other = copy.deepcopy(scene['items'][0])
        other['id'] = 'other'; other['ports'] = [{**p, 'id':p['id']+'-other'} for p in other['ports']]
        scene['items'].append(other)
        self.assertTrue(any(i['code']=='collision' for i in validate_layout(scene)['issues']))

    def test_legacy_strip_still_requires_horizontal_support(self):
        scene = mounted_scene()
        del scene['items'][0]['surface_mount']
        self.assertFalse(validate_layout(scene)['geometry_valid'])

if __name__ == '__main__': unittest.main()
