import assert from 'node:assert/strict'
import { createLegacyDemoProject as createDemoProject } from './fixtures/legacyDemo'
import { localCollision, objectFootprint } from '../src/scene/collisionGeometry'
import { monitorViewRegion } from '../src/scene/organizationPolicy'
import { computeOrganizationZones } from '../src/scene/organizationZones'
import { computeRuleBasedPlan } from '../src/scene/ruleLayout'
import { placementIssues } from '../src/scene/sceneValidation'
import { resolveOrganizationPreferences, type OrganizationPreferences } from '../src/types/organization'
import type { RoomConfig, SceneObject, Vec3 } from '../src/types/project'

const demo = createDemoProject()
const defaults = resolveOrganizationPreferences(demo)
const monitor = demo.objects.find((object) => object.model.shape === 'monitor')!
const printer = demo.objects.find((object) => object.model.shape === 'printer')!

function plan(objects: SceneObject[], preferences = defaults, room = demo.room) {
  const before = JSON.stringify(objects)
  const result = computeRuleBasedPlan({ projectId: demo.id, objects, room, preferences })
  assert.equal(JSON.stringify(objects), before, 'planning must preserve input poses and geometry')
  return result
}

function targetScene(objects: SceneObject[], result: ReturnType<typeof plan>) {
  return objects.map((object) => {
    const target = result.assignments.find((assignment) => assignment.objectId === object.id)
    return target ? { ...object, transform: { position: target.position, rotationY: target.rotationY } } : object
  })
}

function preferredPosition(object: SceneObject, preferences: OrganizationPreferences, room: RoomConfig): Vec3 {
  const zones = computeOrganizationZones(room, preferences)
  const view = monitorViewRegion(object, zones)
  assert.ok(view, 'the fixture must provide a feasible central viewing region')
  const bounds = localCollision(object).bounds
  return [
    (zones.typing.rect.x0 + zones.typing.rect.x1) / 2,
    view.y,
    (view.rect.z0 + view.rect.z1 - bounds.min[2] - bounds.max[2]) / 2,
  ]
}

const full = plan(demo.objects)
assert.deepEqual(full.unplaced, [], 'the complete 17-object demo must remain fully placed after prioritizing the printer')
const centered = full.assignments.find((assignment) => assignment.objectId === monitor.id)!
assert.ok(centered, 'the full 17-object scene must retain a monitor target')
assert.deepEqual(centered.position, preferredPosition(monitor, defaults, demo.room))
assert.equal(centered.rotationY, 0, 'the screen must face the user')
assert.match(centered.reason, /中央主视区.*中线对齐/)
assert.equal(full.metrics.overlapCount, 0, 'the complete output must remain collision-free')
assert.equal(full.metrics.outOfBoundsCount, 0, 'the complete output must remain inside the room and furniture')
const fullScene = targetScene(demo.objects, full)
const printerTarget = full.assignments.find((assignment) => assignment.objectId === printer.id)!
assert.ok(printerTarget, 'the full scene must provide a printer side target')
assert.equal(printerTarget.rotationY, 0, 'printer placement must first try its normal orientation')
assert.match(printerTarget.reason, /侧部设备区/)
const monitorFootprint = objectFootprint(monitor, centered.position, centered.rotationY)
const printerFootprint = objectFootprint(printer, printerTarget.position, printerTarget.rotationY)
assert.ok(printerFootprint.x1 <= monitorFootprint.x0 || printerFootprint.x0 >= monitorFootprint.x1, 'the printer must stand beside the monitor viewing column')
const typing = computeOrganizationZones(demo.room, defaults).typing.rect
assert.ok(printerFootprint.x1 <= typing.x0 || printerFootprint.x0 >= typing.x1, 'the printer must stand beside the typing column')
for (const target of fullScene) {
  assert.deepEqual(placementIssues(target, target.transform.position, fullScene, demo.room), [], `${target.name} must keep valid geometry`)
}

const shiftedPreferences = { ...defaults, typingOffsetX: 0.15 }
const shifted = plan([monitor], shiftedPreferences)
const shiftedTarget = shifted.assignments[0]
assert.ok(Math.abs(shiftedTarget.position[0] - shiftedPreferences.typingOffsetX) < 1e-9, 'monitor alignment must follow the working area')
assert.equal(shiftedTarget.rotationY, 0)

const reordered = plan([...demo.objects].reverse())
assert.deepEqual(reordered.assignments.find((assignment) => assignment.objectId === monitor.id)?.position, centered.position, 'small-item order cannot consume the central viewing position')
assert.deepEqual(reordered.assignments.find((assignment) => assignment.objectId === printer.id)?.position, printerTarget.position, 'small-item order cannot consume the printer side position')

for (const state of ['fixed', 'locked'] as const) {
  const stationary = { ...monitor, [state]: true }
  const stationaryPlan = plan([stationary])
  assert.equal(stationaryPlan.assignments.length, 0, `${state} monitors must not be moved or rotated`)
  assert.equal(stationaryPlan.unplaced.length, 0)
  assert.deepEqual(targetScene([stationary], stationaryPlan)[0].transform, monitor.transform)
}

const centralPosition = preferredPosition(monitor, defaults, demo.room)
const fixedBlocker: SceneObject = {
  ...monitor,
  id: 'fixed-central-blocker', name: '固定中央设备', fixed: true, needsPower: false, ports: [],
  model: { ...monitor.model, shape: 'genericBox' },
  dimensions: { width: 0.16, height: 0.35, depth: 0.16 },
  transform: { position: centralPosition, rotationY: 0 },
}
const fallback = plan([monitor, fixedBlocker])
const fallbackTarget = fallback.assignments.find((assignment) => assignment.objectId === monitor.id)!
assert.ok(fallbackTarget, 'a fixed central obstruction must permit another valid desk target')
assert.notDeepEqual(fallbackTarget.position, centralPosition)
assert.equal(fallbackTarget.rotationY, 0)
assert.match(fallbackTarget.reason, /中央主视区不可用.*回退/)
const fallbackScene = targetScene([monitor, fixedBlocker], fallback)
assert.deepEqual(placementIssues(fallbackScene[0], fallbackTarget.position, fallbackScene, demo.room), [], 'fallback must pass the complete collision and support check')

const fullDeskBlocker: SceneObject = {
  ...fixedBlocker, id: 'fixed-full-desk', name: '固定整桌障碍',
  dimensions: { width: demo.room.desk.width, height: 0.35, depth: demo.room.desk.depth },
  transform: { position: [0, demo.room.desk.height, 0.05 + demo.room.desk.depth / 2], rotationY: 0 },
}
const blocked = plan([monitor, fullDeskBlocker])
assert.equal(blocked.assignments.length, 0, 'an unavailable desk must not create an invalid or floor target')
assert.equal(blocked.unplaced[0]?.objectId, monitor.id)
assert.match(blocked.unplaced[0].reason, /中央主视区不可用.*保留原位/)
assert.deepEqual(targetScene([monitor, fullDeskBlocker], blocked)[0].transform, monitor.transform)
assert.ok(blocked.metrics.overlapCount > 0, 'unplaced retained geometry must remain in the final collision metrics')

const asymmetricRoom = { ...demo.room, shelf: { ...demo.room.shelf, enabled: false } }
const asymmetricMonitor = { ...monitor, dimensions: { width: 0.54, height: 0.20, depth: 0.42 } }
const asymmetric = plan([asymmetricMonitor], defaults, asymmetricRoom)
const asymmetricTarget = asymmetric.assignments[0]
assert.ok(asymmetricTarget)
assert.deepEqual(asymmetricTarget.position, preferredPosition(asymmetricMonitor, defaults, asymmetricRoom))
const footprint = objectFootprint(asymmetricMonitor, asymmetricTarget.position, asymmetricTarget.rotationY)
const view = monitorViewRegion(asymmetricMonitor, computeOrganizationZones(asymmetricRoom, defaults))!
assert.ok(footprint.z0 >= view.rect.z0 - 1e-6 && footprint.z1 <= view.rect.z1 + 1e-6, 'central anchor must retain the real asymmetric base offset')

const narrowRoom = { ...demo.room, desk: { ...demo.room.desk, width: 0.9 } }
const narrowPrinter = { ...printer, transform: { position: [0, demo.room.desk.height, 0.23] as Vec3, rotationY: 0 } }
const narrow = plan([monitor, narrowPrinter], defaults, narrowRoom)
assert.equal(narrow.assignments.some((assignment) => assignment.objectId === printer.id), false, 'a narrow desk cannot send the printer behind the screen')
assert.match(narrow.unplaced.find((item) => item.objectId === printer.id)?.reason ?? '', /侧部设备区无合法空位.*保留原位/)
assert.deepEqual(targetScene([monitor, narrowPrinter], narrow)[1].transform, narrowPrinter.transform, 'an unplaced printer must keep its original geometry')
assert.equal(narrow.metrics.overlapCount, 0)
assert.equal(narrow.metrics.outOfBoundsCount, 0)

const rotatedRoom = { ...demo.room, desk: { ...demo.room.desk, width: 1.2 } }
const widePrinter = { ...printer, name: '显示器旁打印机', dimensions: { width: 0.48, height: 0.2, depth: 0.2 } }
const rotated = plan([monitor, widePrinter], defaults, rotatedRoom)
assert.equal(rotated.assignments.some((assignment) => assignment.objectId === printer.id), false, 'a printer must not rotate sideways just to fit a narrow side region')
assert.match(rotated.unplaced.find((item) => item.objectId === printer.id)?.reason ?? '', /侧部设备区无合法空位/)

console.log('Monitor/printer Mock checks passed: complete 17-object geometry, centered screen and side printer, orientation priority, typing alignment, order independence, fixed/locked poses, blocked-center fallback, retained failures, asymmetric offsets and narrow-desk printer failure.')
