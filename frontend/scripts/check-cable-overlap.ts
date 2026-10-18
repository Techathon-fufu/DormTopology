import assert from 'node:assert/strict'
import { createDemoProject } from '../src/data/demoProject'
import { createCableBetween } from '../src/scene/cables'
import { checkCableRoute } from '../src/scene/cableRoute'
import type { CableConnection, Port, Project, SceneObject } from '../src/types/project'

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
const sharedDevices = [from, to].map(object => ({ ...object, ports: [...object.ports,
  { ...object.ports[0], id: `${object.ports[0].id}-second` }] }))
const sharedCable = { ...cable, id: 'overlapping-line', thickness: 'thin' as const,
  from: { ...cable.from, portId: `${cable.from.portId}-second` },
  to: { ...cable.to, portId: `${cable.to.portId}-second` } }
const overlapCheck = checkCableRoute({ points: cable.route.points, from: cable.from, to: cable.to,
  objects: sharedDevices, room: demo.room, avoidZones: [], cable, cables: [cable, sharedCable], selfCableId: cable.id })
assert.equal(overlapCheck.ok, true, 'independent ports may use overlapping cables of different diameters')
assert.deepEqual(overlapCheck.advisories, [], 'overlapping cables no longer produce spacing advisories')
const blocker = { ...device('blocker', 0), ports: [] }
const obstructed = checkCableRoute({ points: cable.route.points, from: cable.from, to: cable.to,
  objects: [...sharedDevices, blocker], room: demo.room, avoidZones: [], cable,
  cables: [cable, sharedCable], selfCableId: cable.id })
assert.equal(obstructed.ok, false, 'cable overlap allowance does not bypass solid collisions')
assert.ok(obstructed.issues.some(issue => issue.kind === 'object'))
console.log('Cable overlap passed: different diameters share a route without spacing warnings; solid collisions still fail.')
