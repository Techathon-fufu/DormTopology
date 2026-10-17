import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { toPackingScene, mapPackingOrganizationResult, toPackingPosition } from '../src/api/core/packingWire'
import { createDemoProject } from '../src/data/demoProject'
import { computeOrganizationZones } from '../src/scene/organizationZones'
import { worldCollision } from '../src/scene/collisionGeometry'
import { resolveOrganizationPreferences } from '../src/types/organization'
import type { SceneObject, Vec3 } from '../src/types/project'

const demo = createDemoProject()
const preferences = resolveOrganizationPreferences(demo)
const input = { projectId: demo.id, objects: demo.objects, room: demo.room, preferences, confirmed: true }
type Input = typeof input

function plan(name: string, variant: Input, expectedStatus: 'success' | 'partial' = 'success') {
  const scene = { ...toPackingScene(variant), baseline_id: `monitor-${name}` }
  const python = spawnSync('python3', ['-B', '-c', [
    'import json,sys',
    'from backend.app.domain.packing import plan_packing,validate_layout',
    'from backend.examples.packing_demo import preview_scene',
    's=json.load(sys.stdin); r=plan_packing(s)',
    'print(json.dumps({"result":r,"check":validate_layout(preview_scene(s,r))}))',
  ].join('\n')], {
    cwd: resolve(process.cwd(), '..'), input: JSON.stringify(scene), encoding: 'utf8', timeout: 120_000,
  })
  assert.equal(python.status, 0, `${name}: ${python.stderr}`)
  const { result, check } = JSON.parse(python.stdout)
  const mapped = mapPackingOrganizationResult(result, { ...variant, scene, jobId: `monitor-${name}` })
  assert.equal(check.geometry_valid, true, `${name}: ${JSON.stringify(check.issues)}`)
  assert.equal(result.status, expectedStatus, `${name}: ${JSON.stringify(result.issues)}`)
  assert.equal(mapped.serviceMeta?.applicable, true, `${name}: ${JSON.stringify(mapped.serviceMeta?.issues)}`)
  assert.deepEqual(new Set(mapped.assignments.map((assignment) => assignment.objectId)), new Set(variant.objects.map((object) => object.id)), `${name}: every object is retained`)
  for (const assignment of mapped.assignments) {
    const object = variant.objects.find((entry) => entry.id === assignment.objectId)!
    if (object.fixed || object.locked) {
      assert.ok(assignment.position.every((coordinate, axis) => Math.abs(coordinate - object.transform.position[axis]) < 1e-12), `${name}: fixed position`)
      assert.equal(assignment.rotationY, object.transform.rotationY, `${name}: fixed rotation`)
    } else if (Math.abs(assignment.position[1]) < 1e-7) {
      assert.ok(object.model.shape === 'computerTower' || (object.model.shape === 'storageBox' && variant.preferences.preferredStorageZone === 'underDesk'), `${name}: ${object.id} must not land on the floor`)
    }
  }
  const appliedObjects = variant.objects.map((object) => {
    const assignment = mapped.assignments.find((entry) => entry.objectId === object.id)!
    return assignment.placementStatus === 'placed'
      ? { ...object, transform: { position: assignment.position, rotationY: assignment.rotationY } } : object
  })
  const rebuilt = toPackingScene({ ...variant, objects: appliedObjects })
  assert.deepEqual(rebuilt.regions, scene.regions, `${name}: applying movable poses must preserve canonical regions`)
  for (const original of scene.items) {
    const item = rebuilt.items.find((entry) => entry.id === original.id)!
    assert.deepEqual(item.allowed_region_ids, original.allowed_region_ids, `${name}: applying a result must preserve allowed regions for ${original.id}`)
    assert.deepEqual(item.preferred_region_ids, original.preferred_region_ids, `${name}: applying a result must preserve preferred regions for ${original.id}`)
    assert.deepEqual(item.allowed_rotations_y_rad, original.allowed_rotations_y_rad, `${name}: applying a result must preserve allowed rotations for ${original.id}`)
  }
  console.log(`${name}: ${variant.objects.length} objects, complete geometry-valid Python plan and frontend acceptance.`)
  return mapped
}

function centered(name: string, variant: Input) {
  const mapped = plan(name, variant)
  const typing = computeOrganizationZones(variant.room, variant.preferences).typing.rect
  const centerX = (typing.x0 + typing.x1) / 2
  for (const object of variant.objects.filter((entry) => entry.model.shape === 'monitor' && !entry.fixed && !entry.locked)) {
    const target = mapped.assignments.find((assignment) => assignment.objectId === object.id)!
    assert.ok(Math.abs(target.position[0] - centerX) <= .002, `${name}: ${object.id} must align with the typing centre; got ${target.position[0]}, expected ${centerX}`)
    assert.equal(target.rotationY, 0, `${name}: a movable monitor must face the user`)
    const bounds = worldCollision({ ...object, transform: { position: target.position, rotationY: target.rotationY } }).bounds
    assert.ok(bounds.max[2] <= typing.z0, `${name}: monitor must stay behind the typing area`)
    assert.doesNotMatch(target.reason, /回退/, `${name}: centred placement must not claim fallback`)
  }
  const cup = computeOrganizationZones(variant.room, variant.preferences).cup.rect
  const overlaps = (bounds: ReturnType<typeof worldCollision>['bounds'], rect: typeof typing) =>
    bounds.min[0] < rect.x1 - 1e-7 && bounds.max[0] > rect.x0 + 1e-7 && bounds.min[2] < rect.z1 - 1e-7 && bounds.max[2] > rect.z0 + 1e-7
  for (const object of variant.objects.filter((entry) => entry.model.shape === 'printer' && !entry.fixed && !entry.locked)) {
    const target = mapped.assignments.find((assignment) => assignment.objectId === object.id)!
    const bounds = worldCollision({ ...object, transform: { position: target.position, rotationY: target.rotationY } }).bounds
    assert.match(target.targetRegionId ?? '', /^printer-side-/, `${name}: printer must use a side equipment region`)
    assert.equal(target.rotationY, 0, `${name}: printer controls and output must face the user`)
    assert.equal(overlaps(bounds, typing), false, `${name}: printer must preserve the typing area`)
    assert.equal(overlaps(bounds, cup), false, `${name}: printer must preserve the cup area`)
    for (const screen of variant.objects.filter((entry) => entry.model.shape === 'monitor')) {
      const screenTarget = mapped.assignments.find((assignment) => assignment.objectId === screen.id)!
      const screenBounds = worldCollision({ ...screen, transform: { position: screenTarget.position, rotationY: screenTarget.rotationY } }).bounds
      assert.ok(bounds.max[0] <= screenBounds.min[0] + 1e-7 || bounds.min[0] >= screenBounds.max[0] - 1e-7, `${name}: printer must sit beside the monitor instead of behind it`)
    }
  }
  return mapped
}

const monitor = demo.objects.find((object) => object.model.shape === 'monitor')!
for (const state of ['fixed', 'locked'] as const) {
  plan(`${state}-monitor`, { ...input, objects: [{ ...monitor, [state]: true }] })
}

function expectFallback(name: string, variant: Input) {
  const mapped = plan(name, variant)
  const target = mapped.assignments.find((assignment) => assignment.objectId === monitor.id)!
  const typing = computeOrganizationZones(variant.room, variant.preferences).typing.rect
  assert.ok(Math.abs(target.position[0] - (typing.x0 + typing.x1) / 2) > .002, `${name}: fixture must actually force a side placement`)
  assert.equal(target.rotationY, 0, `${name}: fallback must preserve front-facing orientation`)
  assert.match(target.reason, /中央主视位.*回退/, `${name}: explain fallback instead of claiming centred success`)
  assert.ok(mapped.serviceMeta?.warnings?.some((warning) => /中央主视位.*回退/.test(warning)), `${name}: fallback must be visible in warnings`)
}

const blocker: SceneObject = {
  ...monitor, id: 'monitor-centre-blocker', name: 'Fixed centre blocker', ports: [],
  model: { ...monitor.model, shape: 'genericBox' },
  dimensions: { width: .2, height: .25, depth: .2 },
  transform: { position: [0, input.room.desk.height, .44] as Vec3, rotationY: 0 }, fixed: true, locked: false,
}
expectFallback('fixed-centre-obstacle', { ...input, room: { ...input.room, desk: { ...input.room.desk, width: 1.8 } }, objects: [monitor, blocker] })
expectFallback('centre-outside-desk', {
  ...input,
  objects: [{ ...monitor, dimensions: { ...monitor.dimensions, width: .7 } }],
  preferences: { ...preferences, typingOffsetX: .6 },
})
const retained = { ...monitor, transform: { position: [-.5, input.room.desk.height, .55] as Vec3, rotationY: Math.PI / 2 } }
const retainedPlan = plan('retained-manual-quarter-turn', { ...input, objects: [retained, blocker] })
const retainedTarget = retainedPlan.assignments.find((assignment) => assignment.objectId === monitor.id)!
assert.equal(retainedTarget.placementStatus, 'unchanged')
assert.ok(retainedTarget.position.every((coordinate, axis) => Math.abs(coordinate - retained.transform.position[axis]) < 1e-12))
assert.equal(retainedTarget.rotationY, retained.transform.rotationY)
assert.match(retainedTarget.reason, /未采用中央主视位.*保留原位/)
assert.ok(retainedPlan.serviceMeta?.warnings?.some((warning) => /未采用中央主视位.*保留原位/.test(warning)))

const printer = demo.objects.find((object) => object.model.shape === 'printer')!
const narrowPrinter = { ...printer, transform: { position: [0, input.room.desk.height, .3] as Vec3, rotationY: 0 } }
const narrowPlan = plan('printer-side-too-narrow', {
  ...input,
  room: { ...input.room, desk: { ...input.room.desk, width: 1 }, shelf: { ...input.room.shelf, enabled: false } },
  objects: [narrowPrinter],
}, 'partial')
const unplacedPrinter = narrowPlan.assignments.find((assignment) => assignment.objectId === printer.id)!
assert.equal(unplacedPrinter.placementStatus, 'unplaced', 'an unavailable printer side region must not become a successful rear placement')
assert.ok(unplacedPrinter.position.every((coordinate, axis) => Math.abs(coordinate - narrowPrinter.transform.position[axis]) < 1e-12), 'an unplaced printer must remain at its original pose')
assert.equal(unplacedPrinter.rotationY, narrowPrinter.transform.rotationY)
assert.match(unplacedPrinter.reason, /侧部.*保留原位/, 'an unavailable side region must have an explicit placement explanation')
assert.ok(narrowPlan.unplaced.some((object) => object.objectId === printer.id && object.reason.length > 0))
assert.ok(narrowPlan.serviceMeta?.issues.some((issue) => issue.entity_id === printer.id && issue.code === 'no_space'))
assert.throws(() => toPackingScene({
  ...input,
  room: { ...input.room, desk: { ...input.room.desk, width: 1 }, shelf: { ...input.room.shelf, enabled: false } },
  objects: [{ ...monitor, fixed: true, dimensions: { ...monitor.dimensions, width: 1 }, transform: { position: [0, input.room.desk.height, .3], rotationY: 0 } }, narrowPrinter],
}), /侧部设备区/, 'if no side region exists, fail explicitly before submitting an invalid domain scene')

const accessInput = {
  ...input,
  room: { ...input.room, desk: { ...input.room.desk, width: 1.8 }, shelf: { ...input.room.shelf, enabled: false } },
  objects: [monitor, { ...printer, dimensions: { ...printer.dimensions, depth: .2 } }],
}
const accessScene = { ...toPackingScene(accessInput), baseline_id: 'final-device-access' }
const accessTargets: Record<string, Vec3> = { [monitor.id]: [.59, .75, .58], [printer.id]: [.59, .75, .18] }
const accessResponse = {
  schema_version: '1.0', scene_id: accessScene.scene_id, scene_revision: accessScene.scene_revision, status: 'success', issues: [],
  items: accessInput.objects.map((object) => {
    const position = accessTargets[object.id]
    const bounds = worldCollision({ ...object, transform: { position, rotationY: 0 } }).bounds
    const low = toPackingPosition(bounds.min, accessInput.room), high = toPackingPosition(bounds.max, accessInput.room)
    const item = accessScene.items.find((entry) => entry.id === object.id)!
    const region = accessScene.regions.find((entry) => {
      const [x0, x1, z0, z1] = entry.bounds_xz_m
      return item.allowed_region_ids.includes(entry.id) && Math.abs(position[1] - entry.surface_y_m) < 1e-7
        && low[0] >= x0 - 1e-7 && high[0] <= x1 + 1e-7 && low[2] >= z0 - 1e-7 && high[2] <= z1 + 1e-7
        && high[1] <= entry.surface_y_m + entry.clearance_height_m + 1e-7
    })
    assert.ok(region, `${object.id}: final-device access fixture must fit an allowed region`)
    return { item_id: object.id, current_pos: toPackingPosition(object.transform.position, accessInput.room), target_pos: toPackingPosition(position, accessInput.room), target_rotation_y_rad: 0, target_region_id: region.id, placement_status: 'placed' }
  }),
}
const inaccessible = mapPackingOrganizationResult(accessResponse, { ...accessInput, scene: accessScene, jobId: 'final-device-access' })
assert.equal(inaccessible.serviceMeta?.applicable, false, 'a printer in the final monitor column must not be applicable')
assert.deepEqual(inaccessible.serviceMeta?.issues.map((issue) => issue.code), ['device_access'], 'the fixture must fail access validation without physical or region collisions')

centered('full-demo', input)
centered('typing-offset', { ...input, preferences: { ...preferences, typingOffsetX: .12 } })
centered('original-quarter-turn', {
  ...input,
  objects: demo.objects.map((object) => object.model.shape === 'monitor'
    ? { ...object, transform: { ...object.transform, rotationY: Math.PI / 2 } } : object),
})
console.log('Real device regressions passed: centred monitor, accessible side printer, full demo, typing offset, original rotation, preserved poses, legal fallback and unavailable side-region failures.')
