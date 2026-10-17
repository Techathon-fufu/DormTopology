import assert from 'node:assert/strict'
import { createLegacyDemoProject as createDemoProject } from './fixtures/legacyDemo'
import { allowsFloorPlacement } from '../src/scene/organizationPolicy'
import { computeRuleBasedPlan } from '../src/scene/ruleLayout'
import { containedInCavity } from '../src/scene/collisionGeometry'
import { deskBeamTopY, placementIssues } from '../src/scene/sceneValidation'
import { resolveOrganizationPreferences, type OrganizationPreferences, type ZoneKind } from '../src/types/organization'
import type { PrimitiveShape, SceneObject } from '../src/types/project'

const demo = createDemoProject()
const defaults = resolveOrganizationPreferences(demo)
const zones: ZoneKind[] = ['desk', 'shelf', 'underDesk']
const tower = demo.objects.find((object) => object.model.shape === 'computerTower')!
const container = demo.objects.find((object) => object.model.shape === 'storageBox')!
const strip = demo.objects.find((object) => object.model.shape === 'powerStrip')!
const ordinary: SceneObject = {
  ...structuredClone(demo.objects[0]), id: 'ordinary-box', name: 'ordinary box',
  model: { status: 'placeholder', source: 'demo', shape: 'genericBox' },
  dimensions: { width: 0.22, height: 0.12, depth: 0.2 },
  transform: { position: [0, demo.room.desk.height, 0.4], rotationY: 0 },
  category: 'nonElectrical', needsPower: false, frequent: false, fixed: false, locked: false, ports: [],
}
const desktopShapes: PrimitiveShape[] = [
  'laptop', 'monitor', 'keyboard', 'mouse', 'lamp', 'books', 'book', 'printer',
  'powerAdapter', 'thermos', 'cup', 'powerStrip',
]
const assertFloorPolicy = (objects: SceneObject[], preferences: OrganizationPreferences, plan: ReturnType<typeof computeRuleBasedPlan>) => {
  for (const assignment of plan.assignments) {
    if (Math.abs(assignment.position[1]) > 1e-7) continue
    const object = objects.find((entry) => entry.id === assignment.objectId)!
    assert.equal(allowsFloorPlacement(object, preferences), true, `${object.id} cannot receive a new floor target`)
  }
  const covered = new Set([...plan.assignments.map((assignment) => assignment.objectId), ...plan.unplaced.map((item) => item.objectId)])
  for (const object of objects.filter((entry) => entry.visible && !entry.fixed && !entry.locked)) {
    assert.equal(covered.has(object.id), true, `${object.id} must remain represented even when unplaced`)
  }
}

for (const preferredStorageZone of zones) {
  const preferences = { ...defaults, preferredStorageZone }
  assert.equal(allowsFloorPlacement(tower, preferences), true)
  assert.equal(allowsFloorPlacement({ ...tower, frequent: true, category: 'storage' }, preferences), true)
  assert.equal(allowsFloorPlacement(strip, preferences), false)
  assert.equal(allowsFloorPlacement(ordinary, preferences), false)
  assert.equal(allowsFloorPlacement(container, preferences), preferredStorageZone === 'underDesk')
  assert.equal(allowsFloorPlacement({ ...container, frequent: true }, preferences), false)
  for (const shape of desktopShapes) {
    assert.equal(allowsFloorPlacement({ ...ordinary, category: 'storage', model: { ...ordinary.model, shape } }, preferences), false, `${shape} cannot become floor storage through a category mistake`)
  }
  const genericContainer = { ...ordinary, name: 'equipment bin', category: 'storage' as const }
  assert.equal(allowsFloorPlacement(genericContainer, preferences), preferredStorageZone === 'underDesk')
  assert.equal(allowsFloorPlacement({ ...genericContainer, model: { ...genericContainer.model, shape: undefined } }, preferences), preferredStorageZone === 'underDesk')
  assert.equal(allowsFloorPlacement({ ...genericContainer, name: 'book or phone' }, preferences), preferredStorageZone === 'underDesk', 'confirmed properties, not names, determine floor eligibility')
  assert.equal(allowsFloorPlacement({ ...genericContainer, powerStrip: strip.powerStrip }, preferences), false)

  const before = JSON.stringify(demo)
  const plan = computeRuleBasedPlan({ projectId: demo.id, objects: demo.objects, room: demo.room, preferences })
  assertFloorPolicy(demo.objects, preferences, plan)
  assert.equal(JSON.stringify(demo), before, 'planning cannot rewrite the original 17-item demo')
}

const blockedRoom = { ...demo.room, shelf: { ...demo.room.shelf, enabled: false } }
const blocker: SceneObject = {
  ...ordinary, id: 'fixed-full-desk', name: 'fixed desk obstruction', fixed: true,
  dimensions: { width: demo.room.desk.width, height: 0.2, depth: demo.room.desk.depth },
  transform: { position: [0, demo.room.desk.height, 0.05 + demo.room.desk.depth / 2], rotationY: 0 },
}
const mobileStrip = { ...strip, fixed: false, locked: false, dimensions: { ...strip.dimensions, depth: 0.12 } }
for (const preferredStorageZone of zones) {
  const preferences = { ...defaults, preferredStorageZone }
  const objects = [...demo.objects, ordinary, blocker]
  const before = JSON.stringify(objects)
  const plan = computeRuleBasedPlan({ projectId: demo.id, objects, room: blockedRoom, preferences })
  assertFloorPolicy(objects, preferences, plan)
  assert.equal(plan.unplaced.some((item) => item.objectId === ordinary.id), true, 'a crowded desk cannot send an ordinary item to the floor')
  assert.equal(plan.assignments.some((assignment) => assignment.objectId === ordinary.id), false)
  assert.equal(JSON.stringify(objects), before, 'unplaced items keep their original transforms')
  assert.ok(plan.metrics.overlapCount > 0, 'retained items still participate in the complete geometry check')

  const containerPlan = computeRuleBasedPlan({ projectId: demo.id, objects: [container, blocker], room: blockedRoom, preferences })
  const containerTarget = containerPlan.assignments.find((assignment) => assignment.objectId === container.id)
  if (preferredStorageZone === 'underDesk') {
    assert.equal(containerTarget?.position[1], 0)
    assert.match(containerTarget!.reason, /地面/)
    assert.doesNotMatch(containerTarget!.reason, /离地/)
  } else {
    assert.equal(containerTarget, undefined)
    assert.equal(containerPlan.unplaced[0]?.objectId, container.id)
  }
  const frequentContainer = { ...container, frequent: true }
  const frequentPlan = computeRuleBasedPlan({ projectId: demo.id, objects: [frequentContainer, blocker], room: blockedRoom, preferences })
  assert.equal(frequentPlan.assignments.some((assignment) => assignment.objectId === container.id), false)
  assert.equal(frequentPlan.unplaced[0]?.objectId, container.id)

  const towerPlan = computeRuleBasedPlan({ projectId: demo.id, objects: [tower, blocker], room: blockedRoom, preferences })
  assert.equal(towerPlan.assignments.find((assignment) => assignment.objectId === tower.id)?.position[1], 0)
  const stripPlan = computeRuleBasedPlan({ projectId: demo.id, objects: [mobileStrip, blocker], room: blockedRoom, preferences })
  assert.equal(stripPlan.assignments.length, 0, 'a strip that cannot fit the beam or desk must not fall back to bare floor')
  assert.equal(stripPlan.unplaced[0]?.objectId, strip.id)
}

const small: SceneObject = {
  ...ordinary, id: 'small-ordinary', name: 'small ordinary item',
  dimensions: { width: 0.04, height: 0.04, depth: 0.04 },
}
const floorPreferences = { ...defaults, preferredStorageZone: 'underDesk' as const }
const floorStorage = computeRuleBasedPlan({ projectId: demo.id, objects: [container, small, blocker], room: blockedRoom, preferences: floorPreferences })
const containerTarget = floorStorage.assignments.find((assignment) => assignment.objectId === container.id)!
const smallTarget = floorStorage.assignments.find((assignment) => assignment.objectId === small.id)!
assert.equal(containerTarget.position[1], 0)
assert.ok(smallTarget, 'small items can enter an explicitly allowed floor container')
assert.ok(smallTarget.position[1] > 0, 'an item in a real container rests on its inner floor, not the bare room floor')
assert.equal(allowsFloorPlacement(small, floorPreferences), false)
assert.match(smallTarget.reason, /内部/)
const placedContainer = { ...container, transform: { position: containerTarget.position, rotationY: containerTarget.rotationY } }
const placedSmall = { ...small, transform: { position: smallTarget.position, rotationY: smallTarget.rotationY } }
assert.equal(containedInCavity(placedSmall, placedSmall.transform.position, placedContainer, placedContainer.transform.position), true, 'the complete small-item collision volume must fit the actual cavity')
assert.deepEqual(placementIssues(placedSmall, placedSmall.transform.position, [placedContainer, placedSmall, blocker], blockedRoom), [])
const withoutContainer = computeRuleBasedPlan({ projectId: demo.id, objects: [small, blocker], room: blockedRoom, preferences: floorPreferences })
assert.equal(withoutContainer.assignments.length, 0, 'removing the container cannot place the same small item on bare floor')
assert.equal(withoutContainer.unplaced[0]?.objectId, small.id)

const beamPlan = computeRuleBasedPlan({ projectId: demo.id, objects: [{ ...strip, fixed: false, locked: false }], room: demo.room, preferences: defaults })
assert.equal(beamPlan.assignments[0]?.position[1], deskBeamTopY(demo.room), 'the supported beam remains available for power strips')
const floorKeepers: SceneObject[] = [
  { ...ordinary, id: 'fixed-floor', fixed: true, transform: { position: [-0.3, 0, 0.45], rotationY: 0.3 } },
  { ...ordinary, id: 'locked-floor', locked: true, transform: { position: [0.3, 0, 0.45], rotationY: -0.2 } },
]
const keptBefore = JSON.stringify(floorKeepers)
const kept = computeRuleBasedPlan({ projectId: demo.id, objects: floorKeepers, room: demo.room, preferences: defaults })
assert.equal(kept.assignments.length, 0)
assert.equal(kept.unplaced.length, 0)
assert.equal(kept.metrics.overlapCount, 0)
assert.equal(kept.metrics.outOfBoundsCount, 0)
assert.equal(JSON.stringify(floorKeepers), keptBefore, 'fixed and locked floor objects retain their original support and transforms')

console.log('Floor placement checks passed: all preferences, original 17 items, crowded desk without shelf, explicit/nonfrequent containers, shape/category precedence, real floor-container cavities, supported strips, tower fallback, retained collisions and fixed/locked floor objects.')
