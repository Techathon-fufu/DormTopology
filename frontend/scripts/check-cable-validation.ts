import assert from 'node:assert/strict'
import { createDemoProject } from '../src/data/demoProject'
import { createCableBetween, endpointOf, validateCableConnection } from '../src/scene/cables'
import { checkCableRoute, estimateCableLength, planCableRoute } from '../src/scene/cableRoute'
import { polylineLength } from '../src/scene/geometry'
import { useProjectsStore } from '../src/state/projectsStore'
import { useWorkspaceStore } from '../src/state/workspaceStore'
import { usePlansStore } from '../src/state/plansStore'
import { useCableStore } from '../src/state/cableStore'
import { mockCablePlanningService } from '../src/api/mock/cablePlanning'
import { resolveOrganizationPreferences } from '../src/types/organization'
import { planFromProject } from '../src/lib/plans'
import { buildGuideBundle, guideStampOf } from '../src/lib/guide'
import type { CableConnection, Port, Project, SceneObject, Vec3 } from '../src/types/project'

const demo = createDemoProject()
const device = (id: string, x: number, port: Partial<Port> = {}): SceneObject => ({
  ...structuredClone(demo.objects[0]), id, name: id,
  model: { status: 'placeholder', source: 'demo', shape: 'genericBox' },
  dimensions: { width: 0.04, height: 0.04, depth: 0.04 },
  transform: { position: [x, 1.3, 1], rotationY: 0 },
  ports: [{ id: `${id}-port`, type: 'hdmi', powered: false, confirmed: true,
    offset: [x < 0 ? 0.02 : -0.02, 0.02, 0], direction: x < 0 ? 'right' : 'left', ...port }],
})
const from = device('from', -0.2)
const to = device('to', 0.2)
const makeProject = (objects: SceneObject[] = [from, to], cables: CableConnection[] = []): Project => ({
  ...structuredClone(demo), id: 'cable-validation', objects: structuredClone(objects), cables: structuredClone(cables),
})
const created = createCableBetween(makeProject(), from.id, from.ports[0].id, to.id, to.ports[0].id)
assert.equal(created.ok, true)
if (!created.ok) throw new Error(created.reason)
const cable: CableConnection = { ...created.cable, actualLengthM: 2, reserveLengthM: 0.1,
  route: { channels: ['free'], points: [created.cable.from.position, created.cable.to.position], smooth: true } }
const valid = (objects: SceneObject[], a = objects[0], b = objects[1], cables: CableConnection[] = [], kind?: CableConnection['kind']) =>
  validateCableConnection({ objects, cables }, endpointOf(a, a.ports[0]), endpointOf(b, b.ports[0]), { kind })
assert.equal(valid([from, to], from, from).ok, false, 'one port cannot connect to itself')
assert.equal(valid([from, to], from, to, [cable]).ok, false, 'duplicate connections are rejected in either direction')
assert.equal(valid([from, to], to, from, [cable]).ok, false)
assert.equal(validateCableConnection({ objects: [from, to], cables: [cable] }, cable.from, cable.to, { excludeCableId: cable.id, kind: cable.kind }).ok, true, 'editing a connection excludes its own occupancy')
const third = device('third', 0.4)
assert.equal(valid([from, to, third], from, third, [cable]).ok, false, 'occupied ports reject another cable')
assert.equal(valid([from, to], from, to, [], 'power').ok, false, 'HDMI cannot be relabelled as a power cable')
const usbA = device('usb-a', -0.2, { type: 'usb-a' })
const usbC = device('usb-c', 0.2, { type: 'usb-c', powered: true })
assert.equal(valid([usbA, usbC], usbA, usbC, [], 'charging').ok, true, 'USB-A/C are one supported USB connection family')
assert.equal(valid([from, usbC]).ok, false, 'USB and HDMI require different connectors')
const wireless = device('wireless', 0.2, { type: 'wireless' })
assert.equal(valid([from, wireless]).ok, false)
const strip = { ...device('strip', 0.2, { type: 'power-ac', powered: true }), model: { ...to.model, shape: 'powerStrip' as const } }
const acSink = device('ac-sink', -0.2, { type: 'power-ac', powered: true })
assert.equal(valid([acSink, strip], acSink, strip, [], 'power').ok, true)
assert.equal(valid([acSink, device('ac-sink-2', 0.2, { type: 'power-ac', powered: true })]).ok, false, 'two power inputs cannot supply one another')
assert.equal(valid([usbC, strip]).ok, false, 'USB devices need adapter output, not a direct AC connection')
const network = [device('network-a', -0.2, { type: 'rj45' }), device('network-b', 0.2, { type: 'rj45' })]
const networkCable = createCableBetween(makeProject(network), network[0].id, network[0].ports[0].id, network[1].id, network[1].ports[0].id)
assert.equal(networkCable.ok && networkCable.cable.kind, 'network')

const check = (entry: CableConnection = cable, objects = [from, to], smooth = true) => checkCableRoute({
  points: entry.route.points, smooth, from: entry.from, to: entry.to, objects,
  room: demo.room, avoidZones: [], cable: entry, cables: [entry], selfCableId: entry.id,
})
assert.equal(check().ok, true, 'an unobstructed compatible cable with enough length passes local checks')
const short = { ...cable, actualLengthM: 0.01 }
assert.equal(check(short).ok, false)
assert.ok(check(short).issues.some((issue) => issue.message.includes('线长不足')))
assert.equal(planCableRoute(short, [from, to], demo.room, [], [short]).ok, false, 'planner cannot promote a short cable to planned')
assert.equal(check({ ...cable, actualLengthM: 0.4 }).ok, false, 'reserve length counts towards the required cable length')
assert.equal(check({ ...cable, reserveLengthM: -1 }).ok, false)
assert.equal(check({ ...cable, actualLengthM: Number.NaN }).ok, false)
const sampled: Vec3[] = [[-0.18, 1.32, 1], [-0.12, 1.5, 1], [0.18, 1.32, 1]]
assert.equal(estimateCableLength(sampled, false), polylineLength(sampled), 'verified paths keep their exact sampled geometry')
assert.equal(check({ ...cable, route: { ...cable.route, points: sampled } }, [from, to], false).lengthM, polylineLength(sampled))
const blocker = { ...device('thin-obstacle', 0.001), ports: [], dimensions: { width: 0.0001, height: 0.04, depth: 0.04 } }
assert.ok(check(cable, [from, to, blocker]).issues.some((issue) => issue.kind === 'object'), 'swept segments detect thin obstacles between sample points')
const closeBlocker = { ...blocker, id: 'close-to-start', transform: { position: [-0.16, 1.3, 1] as Vec3, rotationY: 0 } }
assert.ok(check(cable, [from, to, closeBlocker]).issues.some((issue) => issue.kind === 'object'), 'another object is never exempted merely because it is near an endpoint')
const radiusBlocker = { ...blocker, id: 'radius-obstacle', transform: { position: [0, 1.3, 1.023] as Vec3, rotationY: 0 } }
assert.ok(check(cable, [from, to, radiusBlocker]).issues.some((issue) => issue.kind === 'object'), 'collision includes the cable radius')
const tight = { ...cable, route: { ...cable.route, points: [cable.from.position, [-0.01, 1.32, 1], [0, 1.33, 1], [0.01, 1.32, 1], cable.to.position] as Vec3[] } }
assert.ok(check(tight).issues.some((issue) => issue.message.includes('弯曲半径')), 'a tight smooth turn fails the local bend estimate')

const verifiedCable: CableConnection = { ...cable, status: 'planned', planSource: 'algorithm', route: { ...cable.route,
  pathLengthM: 0.36, verification: { sceneId: 'scene-test', sceneRevision: 1, status: 'valid', supportStatus: 'not_evaluated' } } }
const fixture = makeProject([from, to, { ...device('unrelated-obstacle', 0.6), ports: [] }], [verifiedCable])
const install = () => {
  useProjectsStore.setState({ projects: { [fixture.id]: structuredClone(fixture) } })
  useWorkspaceStore.getState().resetHistory()
}
const current = () => useProjectsStore.getState().projects[fixture.id]
const workspace = () => useWorkspaceStore.getState()
const stale = () => {
  assert.equal(current().cables[0].status, 'stale')
  assert.equal(current().cables[0].route.verification, undefined)
  assert.equal(current().cables[0].route.pathLengthM, undefined)
}
for (const patch of [{ transform: { position: [0.5, 1.3, 1] as Vec3 } }, { dimensions: { width: 0.1 } }, { visible: false }]) {
  install()
  workspace().updateObject(fixture.id, 'unrelated-obstacle', patch)
  stale()
  workspace().undo(fixture.id)
  stale()
  assert.deepEqual(current().objects, fixture.objects, 'undo restores geometry atomically but requires a new backend revision check')
}
install(); workspace().addObject(fixture.id, { ...device('new-obstacle', 0.7), ports: [] }); stale()
install(); workspace().removeObject(fixture.id, 'unrelated-obstacle'); stale()
install(); workspace().replaceObjects(fixture.id, [...current().objects, { ...device('replacement', 0.7), ports: [] }]); stale()
install(); workspace().updateObject(fixture.id, from.id, { dimensions: { width: 0.05 } }); stale()
assert.equal(current().objects[0].ports[0].confirmed, false, 'resizing requires endpoint reconfirmation')
install(); workspace().updateObject(fixture.id, from.id, { transform: { rotationY: 0.1 } }); stale()
assert.equal(current().objects[0].ports[0].confirmed, true, 'rigid transforms retain local port confirmation')
install(); workspace().updateObject(fixture.id, from.id, { ports: [{ ...from.ports[0], offset: [0.03, 0.02, 0] }] }); stale()
assert.equal(current().objects[0].ports[0].confirmed, false)
workspace().updateObject(fixture.id, from.id, { ports: [{ ...current().objects[0].ports[0], confirmed: true }] })
assert.equal(current().objects[0].ports[0].confirmed, true, 'a separate explicit confirmation is preserved')
install(); workspace().updateCable(fixture.id, cable.id, (entry) => ({ ...entry, actualLengthM: 0.01 })); stale()
assert.equal(current().cables[0].planSource, 'manual', 'manual edits cannot retain backend certification')
install(); workspace().updateCable(fixture.id, cable.id, (entry) => ({ ...entry, note: 'display note only' }))
assert.equal(current().cables[0].route.verification?.status, 'valid', 'editing descriptive text preserves geometry validation')
install(); workspace().addCable(fixture.id, { ...cable, id: 'additional-line' }); stale()
install(); useProjectsStore.getState().update(fixture.id, (p) => ({ ...p, cables: [...p.cables, { ...cable, id: 'another-line' }] }))
workspace().updateCable(fixture.id, 'another-line', (entry) => ({ ...entry, thickness: 'thin' })); stale()
install(); useProjectsStore.getState().update(fixture.id, (p) => ({ ...p, cables: [...p.cables, { ...cable, id: 'another-line' }] }))
workspace().removeCable(fixture.id, 'another-line'); stale()
install(); useProjectsStore.getState().update(fixture.id, (p) => ({ ...p, room: { ...p.room, width: p.room.width + 0.1 } })); stale()
install(); useProjectsStore.getState().update(fixture.id, (p) => ({ ...p, organization: { ...resolveOrganizationPreferences(p),
  cupCorner: resolveOrganizationPreferences(p).cupCorner === 'backLeft' ? 'backRight' : 'backLeft' } })); stale()
install(); useProjectsStore.getState().update(fixture.id, (p) => ({ ...p, objects: p.objects.map((entry) => entry.id === 'unrelated-obstacle'
  ? { ...entry, dimensions: { ...entry.dimensions, width: 0.1 } } : entry) })); stale()
install(); useProjectsStore.getState().update(fixture.id, (p) => ({ ...p, objects: p.objects.map((entry) => entry.id === 'unrelated-obstacle'
  ? { ...entry, model: { ...entry.model, shape: 'printer' } } : entry) })); stale()
install(); useProjectsStore.getState().update(fixture.id, (p) => ({ ...p, objects: [...p.objects, laterObject()] })); stale()
install(); useProjectsStore.getState().update(fixture.id, (p) => ({ ...p, objects: p.objects.map((entry) => ({ ...entry,
  model: { ...entry.model, status: 'ready', source: 'rodin', url: '/models/generated.glb', note: 'appearance only' } })) }))
assert.equal(current().cables[0].status, 'planned', 'appearance-only model replacement preserves route validation')
assert.equal(current().cables[0].route.verification?.status, 'valid')

function laterObject(): SceneObject {
  return { ...device('direct-import-obstacle', 0.7), ports: [] }
}

const snapshotProject = makeProject([from, to].map((entry) => ({ ...entry,
  transform: { position: [entry.transform.position[0], demo.room.desk.height, 0.4] as Vec3, rotationY: 0 } })), [verifiedCable])
const snapshot = planFromProject(snapshotProject, 'candidate', 'previously validated')
useProjectsStore.setState({ projects: { [fixture.id]: structuredClone(snapshotProject) } })
const laterObstacle = { ...device('later-obstacle', 0), ports: [],
  transform: { position: [0, demo.room.desk.height, 0.6] as Vec3, rotationY: 0 } }
workspace().addObject(fixture.id, laterObstacle)
assert.equal(workspace().applyPlanSnapshot(fixture.id, snapshot)?.keptCables, 0)
assert.equal(current().objects.some((entry) => entry.id === laterObstacle.id), true, 'restoring an old snapshot preserves later objects')
stale()
assert.deepEqual(current().cables[0].route.points, snapshot.scene!.cables[0].route.points, 'old path remains only as historical geometry, without revived certification')

install()
workspace().updateObject(fixture.id, from.id, { note: 'history before baseline recapture' })
workspace().undo(fixture.id)
useProjectsStore.getState().update(fixture.id, (project) => ({ ...project, cables: structuredClone(fixture.cables) }))
assert.equal(workspace().future.length, 1)
const oldGuideStamp = guideStampOf(current())
useCableStore.getState().startAnim({ [cable.id]: cable.route.points })
usePlansStore.getState().recaptureBaseline(current())
stale()
assert.equal(workspace().past.length, 0, 'recapturing a baseline starts a new undo boundary')
assert.equal(workspace().future.length, 0, 'recapturing a baseline drops redo snapshots from the previous formal scene')
assert.equal(useCableStore.getState().animStatus, 'idle')
assert.notEqual(guideStampOf(current()), oldGuideStamp, 'previous guide certification becomes outdated immediately on recapture')
assert.equal(buildGuideBundle(current()).connections.length, 0, 'recaptured paths are not executable even if replanning is cancelled or fails')
const recaptured = usePlansStore.getState().baselines[fixture.id]
assert.equal(recaptured.scene!.cables[0].status, 'stale')
assert.equal(recaptured.scene!.cables[0].route.verification, undefined, 'the new baseline cannot retain the previous scene certificate')
workspace().undo(fixture.id)
workspace().redo(fixture.id)
stale()

const shortResult = await mockCablePlanningService.planCables({ projectId: fixture.id, objects: [from, to], room: demo.room, cables: [short], preferences: resolveOrganizationPreferences(demo) })
assert.equal(shortResult.plannedCount, 0)
assert.equal(shortResult.cables[0].status, 'conflict')
const occupiedResult = await mockCablePlanningService.planCables({ projectId: fixture.id, objects: [from, to, third], room: demo.room,
  cables: [cable, { ...cable, id: 'second', to: endpointOf(third, third.ports[0]) }], preferences: resolveOrganizationPreferences(demo) })
assert.equal(occupiedResult.plannedCount, 0, 'all cables sharing an over-capacity port fail, regardless of order')
assert.equal(occupiedResult.conflictCount, 2)
console.log('Cable validation checks passed: connection compatibility/capacity, length/reserve, swept volume, bend estimates, verified samples, full-scene staleness, confirmation and certification invalidation.')
