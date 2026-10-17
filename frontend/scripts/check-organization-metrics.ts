import assert from 'node:assert/strict'
import { createDemoProject } from '../src/data/demoProject'
import { toPackingScene, mapPackingOrganizationResult } from '../src/api/core/packingWire'
import { resolveOrganizationPreferences } from '../src/types/organization'
import type { SceneObject, Vec3 } from '../src/types/project'

const demo = createDemoProject(), room = demo.room, preferences = resolveOrganizationPreferences(demo)
function box(id: string, position: Vec3, fixed = false, locked = false): SceneObject {
  return {
    ...demo.objects[0], id, name: id, fixed, locked, visible: true, ports: [], powerStrip: undefined,
    dimensions: { width: .2, height: .2, depth: .2 },
    model: { status: 'placeholder', source: 'demo', shape: 'genericBox' },
    transform: { position, rotationY: 0 },
  }
}
function unchanged(objects: SceneObject[]) {
  const scene = { ...toPackingScene({ projectId: demo.id, objects, room, preferences, confirmed: true }), baseline_id: 'metrics-regression' }
  return mapPackingOrganizationResult({
    schema_version: scene.schema_version, scene_id: scene.scene_id, scene_revision: scene.scene_revision,
    status: 'infeasible', issues: [], items: scene.items.map((item) => ({
      item_id: item.id, current_pos: item.position, target_pos: item.position,
      target_rotation_y_rad: 0, placement_status: 'unchanged', target_region_id: null, reason_code: null,
    })),
  }, { projectId: demo.id, objects, room, preferences, scene, jobId: 'metrics-check' })
}

for (const count of [2, 3, 5]) {
  const plan = unchanged(Array.from({ length: count }, (_, i) => box(`box-${i}`, [i * .02, .75, .2])))
  assert.equal(plan.metrics.overlapCount, count * (count - 1) / 2)
  assert.equal(plan.serviceMeta?.applicable, false)
}
// Five overlapping boxes produce 15 capped detail messages, but ten actual pairs.
// A furniture collision must not be counted as an object pair.
const separated = unchanged([box('a', [-.7, .2, .3]), box('b', [.3, .75, .4], true), box('c', [.8, .75, .7], false, true)])
assert.equal(separated.metrics.overlapCount, 0)
assert.ok(separated.serviceMeta?.issues?.some((issue) => issue.code === 'roomCollision'))
assert.equal(separated.metrics.movableCount, 1)
assert.equal(separated.metrics.placedCount, 0)
console.log('Organization metrics: unique overlap pairs, capped messages, furniture collisions and fixed/locked counts passed.')
