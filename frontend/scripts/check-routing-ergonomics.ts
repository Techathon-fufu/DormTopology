import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { routingExclusions } from '../src/scene/routingPolicy'
import { worldCollision } from '../src/scene/collisionGeometry'
import { checkCableRoute } from '../src/scene/cableRoute'
import { toRoutingScene, mapRoutingResult } from '../src/api/core/routingWire'
import { fromPackingPosition } from '../src/api/core/packingWire'
import { parseBundle } from '../src/algorithm-lab/contract'
import type { Project, Vec3 } from '../src/types/project'

const fixture = JSON.parse(readFileSync('public/routing-demo/fixed-desk.json', 'utf8'))
const project: Project = fixture.project
const scene = toRoutingScene({ project, confirmed: true })
// The standalone lab accepts box-only items; exercise its graph parser separately.
const labScene = { ...scene, items: [], cables: [], baseline_id: 'ergonomics-test' }
parseBundle(labScene)
const exclusions = routingExclusions(project.room, project.objects)
const mapped = mapRoutingResult(fixture.result, { scene: fixture.scene, project })
for (const route of fixture.result.cables) {
  assert.equal(route.status, 'valid')
  const radius = scene.cables.find(c => c.id === route.id)!.diameter_m / 2
  const points: Vec3[] = route.path_points.map((p: Vec3) => fromPackingPosition(p, project.room))
  // Independent interval intersection, including sparse long segments and cable radius.
  for (const zone of exclusions) for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i]
    let low = 0, high = 1
    for (let k = 0; k < 3; k++) {
      const delta = b[k] - a[k], min = zone.min[k] - radius, max = zone.max[k] + radius
      if (Math.abs(delta) < 1e-10) { if (a[k] < min || a[k] > max) { low = 1; high = 0 } }
      else { const t0 = (min - a[k]) / delta, t1 = (max - a[k]) / delta; low = Math.max(low, Math.min(t0, t1)); high = Math.min(high, Math.max(t0, t1)) }
    }
    assert.ok(low > high, `${route.id} enters ${zone.name}`)
  }
}
const cable = mapped.cables[0]
for (const zone of exclusions.filter(z => z.name !== 'routing:no-baffle-top')) {
  const mid = zone.min.map((v, k) => (v + zone.max[k]) / 2) as Vec3
  const check = checkCableRoute({ points: [[zone.min[0] - .05, mid[1], mid[2]], [zone.max[0] + .05, mid[1], mid[2]]],
    smooth: false, from: cable.from, to: cable.to, room: project.room, objects: project.objects, avoidZones: [], cable })
  assert.ok(check.issues.some(i => /鼠标活动区|笔记本上方/.test(i.message)), 'manual long segment must also fail')
}
const laptop = project.objects.find(o => o.model.shape === 'laptop')!
for (const angle of [0, Math.PI / 2, -Math.PI / 4]) {
  const changed = structuredClone(project)
  const object = changed.objects.find(o => o.id === laptop.id)!
  object.transform = { position: [.8, .75, .4], rotationY: angle }
  object.dimensions.width *= 1.1
  const actual = toRoutingScene({ project: changed, confirmed: true }).reserved_zones.find(z => z.id.endsWith(laptop.id))!
  const min = fromPackingPosition(actual.min, changed.room), max = fromPackingPosition(actual.max, changed.room)
  const body = worldCollision(object)
  for (const part of body.parts) for (const v of part.vertices_m) {
    assert.ok([0, 2].every(k => v[k] >= min[k] - 1e-8 && v[k] <= max[k] + 1e-8), 'edited rotated footprint is covered')
  }
  assert.ok(Math.abs(min[1] - body.bounds.min[1] - .012) < 1e-9)
}
for (const change of [{ seat_weight: -1 }, { distance_scale_m: 0 }, { corner_end: scene.routing_graph.spatial_cost_policy!.corner_start }]) {
  const invalid = structuredClone(labScene)
  Object.assign(invalid.routing_graph.spatial_cost_policy!, change)
  assert.throws(() => parseBundle(invalid), /spatial_cost_policy/)
}
console.log('Seven cable volumes avoid mouse/laptop exclusions; manual edits, moved/rotated/resized laptop and policy parsing verified.')
