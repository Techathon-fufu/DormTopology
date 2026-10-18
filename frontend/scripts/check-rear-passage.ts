import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { rearCablePassage, baffleTopExclusion } from '../src/scene/fixedFurniture'
import { fromPackingPosition, toPackingPosition } from '../src/api/core/packingWire'
import { mapRoutingResult, toRoutingScene } from '../src/api/core/routingWire'
import { checkCableRoute } from '../src/scene/cableRoute'
import type { Project, Vec3 } from '../src/types/project'

const fixture = JSON.parse(readFileSync('public/routing-demo/fixed-desk.json', 'utf8'))
const project: Project = fixture.project
const scene = { ...toRoutingScene({ project, confirmed: true }), baseline_id: fixture.scene.baseline_id }
assert.deepEqual(scene, fixture.scene, 'demo uses current business geometry and graph')
assert.ok(scene.routing_graph.nodes.some(n => n.id.endsWith(':entry')))
assert.ok(!scene.routing_graph.nodes.some(n => /:over-|over-/.test(n.id)))
const mapped = mapRoutingResult(fixture.result, { scene, project })
for (const cable of mapped.cables) {
  const check = checkCableRoute({ points: cable.route.points, smooth: false, from: cable.from, to: cable.to,
    objects: project.objects, room: project.room, avoidZones: [], cable, cables: mapped.cables, selfCableId: cable.id })
  assert.ok(check.ok, JSON.stringify({ cable: cable.id, issues: check.issues }))
}
const probe = mapped.cables[0]
const crest = checkCableRoute({ points: [[-.2, .93, .05], [.2, .93, .05]], smooth: false,
  from: probe.from, to: probe.to, objects: project.objects, room: project.room, avoidZones: [], cable: probe })
assert.ok(crest.issues.some(i => i.message.includes('背板顶沿')), 'manual route checks also reject the crest')
const passage = rearCablePassage, cap = baffleTopExclusion(project.room)
const middleY = (passage.min[1] + passage.max[1]) / 2
for (const cable of fixture.result.cables) {
  assert.equal(cable.status, 'valid')
  const radius = scene.cables.find(c => c.id === cable.id)!.diameter_m / 2
  const points: Vec3[] = cable.path_points.map((p: Vec3) => fromPackingPosition(p, project.room))
  let crossings = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i]
    if ((a[1] - middleY) * (b[1] - middleY) < 0) {
      const t = (middleY - a[1]) / (b[1] - a[1])
      const p = a.map((v, k) => v + t * (b[k] - v))
      assert.ok([0, 2].every(k => p[k] - radius > passage.min[k] && p[k] + radius < passage.max[k]), `${cable.id}: crosses only the real notch with clearance`)
      crossings++
    }
    // Independent slab intersection checks every segment, including endpoint connectors.
    let low = 0, high = 1
    for (let k = 0; k < 3; k++) {
      const delta = b[k] - a[k], min = cap.min[k] - radius, max = cap.max[k] + radius
      if (Math.abs(delta) < 1e-10) { if (a[k] < min || a[k] > max) { low = 1; high = 0 } }
      else { const t0 = (min - a[k]) / delta, t1 = (max - a[k]) / delta; low = Math.max(low, Math.min(t0, t1)); high = Math.min(high, Math.max(t0, t1)) }
    }
    assert.ok(low > high, `${cable.id}: no part of a cable may enter the baffle crest exclusion`)
  }
  assert.ok(crossings >= 1, `${cable.id}: uses the authored rear passage`)
}
// Filling the only passage must fail explicitly, rather than reverting to a crest route.
const blocked = { ...scene, cables: [scene.cables.find(c => c.id === 'demo-cable-monitor')!],
  obstacles: [...scene.obstacles, { id: 'test:blocked-passage', min: toPackingPosition(passage.min, project.room), max: toPackingPosition(passage.max, project.room) }] }
const run = spawnSync('python3', ['-B', '-c', 'import json,sys; from backend.app.domain.routing import plan_routing; print(json.dumps(plan_routing(json.load(sys.stdin))))'],
  { cwd: resolve('..'), input: JSON.stringify(blocked), encoding: 'utf8', timeout: 120_000 })
assert.equal(run.status, 0, run.stderr)
const failed = JSON.parse(run.stdout)
assert.notEqual(failed.status, 'success')
assert.equal(failed.cables[0].path_points.length, 0)
console.log('All seven routes cross the authored notch with clearance; crest excluded; blocked passage fails explicitly.')
