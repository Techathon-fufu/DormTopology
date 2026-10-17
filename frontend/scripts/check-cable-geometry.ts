import assert from 'node:assert/strict'
import { createDemoProject } from '../src/data/demoProject'
import { cablePathLength, cablePathSamples, createCableTube, totalCablePathLength } from '../src/scene/cableGeometry'
import { hasUsableCableRoute } from '../src/scene/cables'
import { computePlanMetrics } from '../src/lib/planMetrics'
import { buildGuideBundle, guideStampOf } from '../src/lib/guide'
import { planFromProject } from '../src/lib/plans'
import { resolveOrganizationPreferences } from '../src/types/organization'
import type { CableConnection, SceneObject, Vec3 } from '../src/types/project'

const points: Vec3[] = Array.from({ length: 301 }, (_, index) => [
  index / 300, Math.sin(index * 0.12) * 0.01 + 1.2, Math.pow(index / 300, 2),
])
const radialSegments = 8
const tube = createCableTube(points, 0.003, radialSegments)!
assert.equal(tube.parameters.tubularSegments, points.length - 1, 'large verified paths cannot be capped at 160 or 200 tube segments')
const position = tube.getAttribute('position')
for (let index = 0; index < points.length; index += 1) {
  const center = [0, 0, 0]
  for (let side = 0; side < radialSegments; side += 1) {
    const vertex = index * (radialSegments + 1) + side
    center[0] += position.getX(vertex) / radialSegments
    center[1] += position.getY(vertex) / radialSegments
    center[2] += position.getZ(vertex) / radialSegments
  }
  assert.ok(center.every((value, axis) => Math.abs(value - points[index][axis]) < 1e-6), `tube ring ${index} must remain centered on the original sample`)
}
tube.dispose()
assert.equal(createCableTube([], 0.003), null)
assert.equal(createCableTube([[0, 0, 0]], 0.003), null)
assert.equal(createCableTube([[0, 0, 0], [1, Number.NaN, 0]], 0.003), null)
const repeated = createCableTube([[0, 1, 0], [0, 1, 0], [1, 1, 0]], 0.003)!
assert.ok(Array.from(repeated.getAttribute('position').array).every(Number.isFinite), 'repeated samples do not produce invalid tube frames')
repeated.dispose()

const demo = createDemoProject()
const object = (id: string, x: number): SceneObject => ({
  ...structuredClone(demo.objects[0]), id, name: id, needsPower: false,
  model: { status: 'placeholder', source: 'demo', shape: 'genericBox' },
  dimensions: { width: 0.04, height: 0.04, depth: 0.04 },
  transform: { position: [x, 1.3, 1], rotationY: 0 },
  ports: [{ id: `${id}-port`, type: 'hdmi', powered: false, confirmed: true, offset: [0, 0.02, 0] }],
})
const objects = [object('a', -0.2), object('b', 0.2)]
const samples: Vec3[] = [[-0.2, 1.32, 1], [-0.18, 1.4, 1], [0.12, 1.42, 1], [0.2, 1.32, 1]]
const cable: CableConnection = {
  id: 'verified', projectId: demo.id, kind: 'video', status: 'planned', planSource: 'algorithm',
  from: { objectId: 'a', portId: 'a-port', position: samples[0] },
  to: { objectId: 'b', portId: 'b-port', position: samples[samples.length - 1] },
  actualLengthM: 1, reserveLengthM: 0.1, accessories: [],
  route: { channels: ['deskUnderside'], points: samples, smooth: false, pathLengthM: 0.738451,
    verification: { sceneId: 'scene-test', sceneRevision: 3, status: 'valid', supportStatus: 'not_evaluated' } },
}
const project = { ...demo, objects, cables: [cable] }
assert.deepEqual(cablePathSamples(cable, objects), samples, 'backend samples cannot be passed through Catmull-Rom again')
assert.equal(cablePathLength(cable, objects), 0.738451, 'continuous curve integral takes priority over a new sampled estimate')
assert.equal(totalCablePathLength([cable], objects), 0.738451)
const guide = buildGuideBundle(project)
assert.equal(guide.stats.totalLengthM, 0.738451)
assert.equal(guide.stats.requiredLengthM, 0.838451)
assert.equal(guide.connections.length, 1)
assert.ok(guide.connections[0].detail.includes('已验证路径长度 0.74 m'))
assert.ok(guide.issues.some((issue) => issue.id === 'support:verified'), 'unassessed physical support remains visible in the guide')
const unknownGuide = buildGuideBundle({ ...project, cables: [{ ...cable, actualLengthM: undefined }] })
assert.equal(unknownGuide.stats.requiredLengthM, guide.stats.requiredLengthM)
assert.ok(unknownGuide.connections[0].detail.includes('备线长度至少 0.84 m'))
assert.ok(!unknownGuide.issues.some((issue) => issue.kind === 'length'), 'unknown availability is not an unresolved input problem')
const metric = computePlanMetrics(planFromProject(project, 'candidate', 'verified sample'), {
  projectRoom: project.room, projectObjects: objects, preferences: resolveOrganizationPreferences(project),
})
assert.equal(metric.cableLengthM, 0.74)
assert.equal(metric.estimated.cableLength, false)

for (const status of ['planned', 'adjusted'] as const) {
  for (const verification of [undefined, cable.route.verification]) {
    const historical: CableConnection = {
      ...structuredClone(cable), id: 'historical-rule', status, planSource: 'demo-rule',
      route: { ...structuredClone(cable.route), verification },
    }
    const before = JSON.stringify(historical)
    assert.equal(hasUsableCableRoute(historical), false, 'historical rule paths cannot become usable through status or a copied verification marker')
    assert.equal(cablePathLength(historical, objects), null)
    const historicalGuide = buildGuideBundle({ ...project, cables: [historical] })
    assert.equal(historicalGuide.connections.length, 0, 'old rule paths cannot become executable guide steps')
    assert.equal(historicalGuide.stats.plannedCableCount, 0)
    assert.equal(historicalGuide.stats.totalLengthM, null)
    assert.equal(JSON.stringify(historical), before, 'rejecting a historical path preserves its geometry for reference')
  }
  const manual: CableConnection = {
    ...structuredClone(cable), status, planSource: 'manual',
    route: { ...structuredClone(cable.route), verification: undefined, pathLengthM: undefined },
  }
  assert.equal(hasUsableCableRoute(manual), true, 'removing rule mode must retain ordinary manual path support')
  assert.ok(cablePathLength(manual, objects)! > 0)
}

for (const status of ['conflict', 'stale', 'existing'] as const) {
  const invalid = { ...cable, id: status, status }
  assert.equal(hasUsableCableRoute(invalid), false)
  assert.equal(cablePathLength(invalid, objects), null)
  assert.equal(totalCablePathLength([cable, invalid], objects), null, 'a partial valid subset cannot become a complete total')
  const partial = { ...project, cables: [cable, invalid] }
  const bundle = buildGuideBundle(partial)
  assert.equal(bundle.stats.totalLengthM, null)
  assert.equal(bundle.stats.requiredLengthM, null)
  assert.equal(bundle.connections.length, 1, 'failed and stale lines do not become executable connection instructions')
  assert.equal(bundle.stats.plannedCableCount, 1)
  assert.ok(bundle.issues.some((issue) => issue.id === `unresolved:${status}`))
  const partialMetric = computePlanMetrics(planFromProject(partial, 'candidate', 'partial sample'), {
    projectRoom: project.room, preferences: resolveOrganizationPreferences(project),
  })
  assert.equal(partialMetric.cableLengthM, null)
  assert.equal(partialMetric.cableSummary?.unplannedCount, 1)
}
const emptyFailure: CableConnection = { ...cable, status: 'conflict', route: { ...cable.route, points: [], pathLengthM: undefined,
  verification: { ...cable.route.verification!, status: 'failed', reasonCode: 'no_path' } } }
assert.equal(cablePathLength(emptyFailure, objects), null, 'a failed empty path is unknown, never zero meters')
assert.equal(totalCablePathLength([], objects), 0, 'an empty connection set has a known zero total')
const stamp = guideStampOf(project)
assert.notEqual(guideStampOf({ ...project, cables: [{ ...cable, route: { ...cable.route, smooth: true } }] }), stamp)
assert.notEqual(guideStampOf({ ...project, cables: [{ ...cable, route: { ...cable.route, pathLengthM: 0.9 } }] }), stamp)
console.log('Cable geometry checks passed: all 301 samples preserved in tube centers, repeated points, verified length and samples, historical rule rejection, manual path support, partial/failed totals, executable guide filtering and geometry-sensitive guide stamps.')
