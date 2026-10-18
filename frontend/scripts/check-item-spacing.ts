import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseBundle } from '../src/algorithm-lab/contract'
import { canonicalScene, mapPackingOrganizationResult, toPackingPosition, toPackingScene } from '../src/api/core/packingWire'
import { boundsOf, boxPart, worldCollision } from '../src/scene/collisionGeometry'
import { horizontalItemGap, itemSpacingViolations, type SpacingCollision } from '../src/scene/itemSpacing'
import { resolveOrganizationPreferences } from '../src/types/organization'
import type { SceneObject, Vec3 } from '../src/types/project'
import { createLegacyDemoProject } from './fixtures/legacyDemo'

const demo = createLegacyDemoProject()
const preferences = resolveOrganizationPreferences(demo)
function object(id: string, position: Vec3, size: Vec3 = [.1, .1, .1], rotationY = 0): SceneObject {
  return { ...demo.objects[0], id, name: id, model: { status: 'placeholder', source: 'demo', shape: 'genericBox' },
    fixed: false, locked: false, ports: [], dimensions: { width: size[0], height: size[1], depth: size[2] },
    transform: { position, rotationY } }
}
const body = (boxes: Array<[Vec3, Vec3]>): SpacingCollision => {
  const parts = boxes.map(([min, max]) => boxPart(min, max))
  return { parts, bounds: boundsOf(parts.flatMap((part) => part.vertices_m)) }
}
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-7, `${a} should equal ${b}`)
const a = object('a', [0, 0, 0])
const actualSize = worldCollision(a).bounds.max.map((value, axis) => value - worldCollision(a).bounds.min[axis]) as Vec3
const exact = object('exact', [actualSize[0] + .02, 0, 0])
close(horizontalItemGap(worldCollision(a), worldCollision(exact)), .02)
assert.equal(itemSpacingViolations([a, exact], .02).length, 0, 'exactly 20 mm is permitted')
const tooClose = object('too-close', [actualSize[0] + .019, 0, 0])
assert.equal(itemSpacingViolations([a, tooClose], .02).length, 1, 'a 19 mm gap is rejected')
assert.equal(itemSpacingViolations([a, tooClose], 0).length, 0, 'absent/zero gap retains legacy behavior')
const diagonal = object('diagonal', [actualSize[0] + .012, 0, actualSize[2] + .016])
close(horizontalItemGap(worldCollision(a), worldCollision(diagonal)), .02)
assert.equal(itemSpacingViolations([a, diagonal], .02).length, 0, 'a diagonal Euclidean 20 mm gap is permitted')
const above = object('above', [0, actualSize[1], 0])
assert.equal(horizontalItemGap(worldCollision(a), worldCollision(above)), Infinity, 'touching Y ranges do not require horizontal separation')
assert.equal(itemSpacingViolations([a, above], .02).length, 0, 'different levels remain eligible')

// Parallel rotated boxes have overlapping AABBs, while their true 45-degree faces are 20 mm apart.
const yaw = Math.PI / 4
const rotatedA = object('rotated-a', [0, 0, 0], [.3, .1, .02], yaw)
const unrotated = worldCollision({ ...rotatedA, transform: { ...rotatedA.transform, rotationY: 0 } }).bounds
const offset = unrotated.max[2] - unrotated.min[2] + .02
const rotatedB = object('rotated-b', [Math.sin(yaw) * offset, 0, Math.cos(yaw) * offset], [.3, .1, .02], yaw)
close(horizontalItemGap(worldCollision(rotatedA), worldCollision(rotatedB)), .02)
assert.equal(itemSpacingViolations([rotatedA, rotatedB], .02).length, 0, 'AABB overlap must not create a false spacing violation')
const rotatedClose = { ...rotatedB, transform: { ...rotatedB.transform, position: rotatedB.transform.position.map((v) => v * .975) as Vec3 } }
assert.equal(itemSpacingViolations([rotatedA, rotatedClose], .02).length, 1, 'rotated 19 mm face clearance is rejected')

const notch = body([[[0, 0, 0], [.1, .2, .4]], [[.1, 0, 0], [.4, .2, .1]]])
const insideNotch = body([[[.2, 0, .2], [.3, .1, .3]]])
close(horizontalItemGap(notch, insideNotch), .1)
const underRaisedPart = body([[[.2, .2, .2], [.3, .3, .3]], [[.5, 0, .5], [.6, .3, .6]]])
close(horizontalItemGap(underRaisedPart, insideNotch), Math.hypot(.2, .2))
assert.throws(() => itemSpacingViolations([a], -1))

const input = { projectId: demo.id, objects: [object('moving', [-.4, .75, .4]), { ...object('fixed', [.4, .75, .4]), fixed: true }], room: demo.room, preferences, confirmed: true }
const scene = { ...toPackingScene(input), scene_id: 'spacing-check', scene_revision: 2, baseline_id: 'spacing-baseline' }
assert.equal(scene.constraints?.min_item_gap_m, .02)
assert.equal(scene.reserved_zones.length, input.room.cableHoles.length)
const hole = input.room.cableHoles[0], holeRadius = hole.diameter / 2 + .01
assert.deepEqual(scene.reserved_zones[0], { id: `packing:hole:${hole.id}`,
  min: toPackingPosition([hole.position[0] - holeRadius, input.room.desk.height, hole.position[2] - holeRadius], input.room),
  max: toPackingPosition([hole.position[0] + holeRadius, input.room.desk.height + .05, hole.position[2] + holeRadius], input.room) })
for (const invalidHole of [{ ...hole, diameter: 0 }, { ...hole, diameter: Infinity }, { ...hole, position: [NaN, .75, .12] as Vec3 },
  { ...hole, position: [0, .8, .12] as Vec3 }, { ...hole, position: [10, .75, .12] as Vec3 }]) {
  assert.throws(() => toPackingScene({ ...input, room: { ...input.room, cableHoles: [invalidHole] } }), /出线孔/)
}
assert.throws(() => canonicalScene({ ...scene, constraints: undefined }, scene), /意外修改/)
assert.throws(() => canonicalScene({ ...scene, constraints: { min_item_gap_m: .01 } }, scene), /意外修改/)
for (const value of [-.1, Infinity, NaN, '0.02', null]) assert.throws(() => canonicalScene({ ...scene, constraints: { min_item_gap_m: value } }), /最小间距无效/)
canonicalScene(scene, scene)
scene.items[0].allowed_region_ids = ['support-desk']
const result = {
  schema_version: '1.0', scene_id: scene.scene_id, scene_revision: scene.scene_revision, status: 'success', issues: [],
  items: input.objects.map((item, i) => ({ item_id: item.id, current_pos: toPackingPosition(item.transform.position, input.room),
    target_pos: toPackingPosition(i ? item.transform.position : [.285, .75, .4], input.room), target_rotation_y_rad: 0,
    target_region_id: 'support-desk', placement_status: i ? 'unchanged' : 'placed' })),
}
const ctx = { ...input, scene, jobId: 'spacing-job' }
const forged = mapPackingOrganizationResult(result, ctx)
assert.equal(forged.serviceMeta?.applicable, false, 'claimed success at a 15 mm gap cannot be applied')
assert.equal(forged.serviceMeta?.issues.filter((issue) => issue.code === 'item_spacing').length, 1)
assert.equal(forged.serviceMeta?.issues.filter((issue) => issue.code === 'overlap').length, 0, 'spacing is separate from collision')
const blockedHole = { ...result, items: [{ ...result.items[0], target_pos: toPackingPosition(hole.position, input.room) }, result.items[1]] }
const blockedHolePlan = mapPackingOrganizationResult(blockedHole, ctx)
assert.equal(blockedHolePlan.serviceMeta?.applicable, false, 'claimed success covering a cable hole cannot be applied')
assert.ok(blockedHolePlan.serviceMeta?.issues.some((issue) => issue.code === 'reserved_zone'))
const exactResult = { ...result, items: [{ ...result.items[0], target_pos: toPackingPosition([.4 - actualSize[0] - .02, .75, .4], input.room) }, result.items[1]] }
assert.equal(mapPackingOrganizationResult(exactResult, ctx).serviceMeta?.applicable, true, 'an exact gap remains applicable')

const leftovers = [{ ...input.objects[0], transform: { ...input.objects[0].transform, position: [.285, .75, .4] as Vec3 } }, input.objects[1]]
const leftoverScene = { ...scene, items: scene.items.map((item, i) => ({ ...item, position: toPackingPosition(leftovers[i].transform.position, input.room) })) }
const leftoverResult = { ...result, status: 'partial', items: result.items.map((item, i) => ({ ...item,
  current_pos: toPackingPosition(leftovers[i].transform.position, input.room), target_pos: toPackingPosition(leftovers[i].transform.position, input.room),
  placement_status: i ? 'unchanged' : 'unplaced' })) }
assert.equal(mapPackingOrganizationResult(leftoverResult, { ...ctx, objects: leftovers, scene: leftoverScene }).serviceMeta?.applicable, false, 'unplaced items stay in final spacing checks')
const fixedObjects = leftovers.map((item) => ({ ...item, fixed: true }))
const fixedResult = { ...leftoverResult, items: leftoverResult.items.map((item) => ({ ...item, placement_status: 'unchanged' })) }
assert.equal(mapPackingOrganizationResult(fixedResult, { ...ctx, objects: fixedObjects, scene: leftoverScene }).serviceMeta?.applicable, false, 'fixed pairs stay in final spacing checks')

const fixture = JSON.parse(readFileSync('public/algorithm-fixtures/packing-success/scene.json', 'utf8'))
assert.equal(parseBundle(fixture).scene.constraints, undefined, 'legacy imported scenes remain compatible')
assert.deepEqual(parseBundle({ ...fixture, constraints: { min_item_gap_m: .02 } }).scene.constraints, { min_item_gap_m: .02 })
for (const value of [-.01, Infinity, NaN, '0.02', null]) assert.throws(() => parseBundle({ ...fixture, constraints: { min_item_gap_m: value } }))
assert.throws(() => parseBundle({ ...fixture, constraints: {} }))
const packingFixture = JSON.parse(readFileSync('public/algorithm-fixtures/packing-success/packing_result.json', 'utf8'))
packingFixture.issues.push({ entity_id: fixture.items[0].id, code: 'item_spacing', message: 'Item spacing is below 20 mm' })
parseBundle(fixture, packingFixture)
console.log('Item spacing passed: 20/19 mm, diagonal Euclidean distance, rotated true geometry, compound cavities, per-part height overlap, fixed/unplaced objects, forged success rejection, canonical constraints and lab imports.')
