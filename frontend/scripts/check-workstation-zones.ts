import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { createDemoProject } from '../src/data/demoProject'
import { toPackingScene, mapPackingOrganizationResult, type PackingScene } from '../src/api/core/packingWire'
import { resolveOrganizationPreferences } from '../src/types/organization'
import { organizationClearanceIssues, organizationReservedZones } from '../src/scene/organizationClearance'
import { objectRoomHits } from '../src/scene/collisionGeometry'
import { prefabModelRef, PREFAB_ITEMS } from '../src/scene/prefabItems'
import { isDailyMiscellaneous } from '../src/scene/organizationPolicy'
import { DESKTOP_BINDINGS, desktopMovementRange, initialDesktopPose } from '../src/scene/desktopBindings'
import { knownSceneForBaseline, rememberOrganizationScene, remoteOrganizationProjectId } from '../src/api/core/organizationScenes'
import { createHttpServices } from '../src/api/http'
import { requestJson } from '../src/api/core/client'
import { planFromProject } from '../src/lib/plans'

const project = createDemoProject()
assert.deepEqual(project.objects.find((o) => o.id === 'demo-monitor')!.transform.position, DESKTOP_BINDINGS.monitor.position)
assert.deepEqual(project.objects.find((o) => o.id === 'demo-keyboard')!.transform.position, DESKTOP_BINDINGS.keyboard.position)
assert.deepEqual(project.objects.find((o) => o.id === 'demo-mouse')!.transform.position, [.485, .75, .46])
const padPrototype = { ...project.objects.find((o) => o.id === 'demo-cup')!, id: 'pad', model: prefabModelRef('mousepad', 'genericBox'), dimensions: { width: .3, height: .001, depth: .3 }, transform: { position: [...DESKTOP_BINDINGS.mousepad.position] as [number, number, number], rotationY: 0 } }
const tissuePrototype = { ...project.objects.find((o) => o.id === 'demo-cup')!, id: 'tissue', model: prefabModelRef('tissue_box', 'genericBox'), dimensions: { width: .15, height: .07, depth: .1 }, transform: { position: [...DESKTOP_BINDINGS.tissue_box.position] as [number, number, number], rotationY: 0 } }
assert.ok(initialDesktopPose(padPrototype, project.room, project.objects).position.every((v, i) => Math.abs(v - DESKTOP_BINDINGS.mousepad.position[i]) < 1e-6))
assert.ok(initialDesktopPose(tissuePrototype, project.room, project.objects).position.every((v, i) => Math.abs(v - DESKTOP_BINDINGS.tissue_box.position[i]) < 1e-6))
assert.ok((desktopMovementRange(padPrototype, project.room, project.objects)!.x1 - desktopMovementRange(padPrototype, project.room, project.objects)!.x0) > .009)
const input = { projectId: project.id, objects: project.objects, room: project.room, preferences: resolveOrganizationPreferences(project), confirmed: true }
const scene = { ...toPackingScene(input), baseline_id: 'workstation-test' }
const find = (id: string) => scene.items.find((item) => item.id === id)!
assert.deepEqual(find('demo-monitor').allowed_region_ids, ['monitor-view-demo-monitor'])
assert.deepEqual(find('demo-laptop').allowed_rotations_y_rad, [-Math.PI / 9])
assert.deepEqual(find('demo-keyboard').allowed_region_ids, ['keyboard'])
assert.deepEqual(find('demo-mouse').allowed_region_ids, ['mouse'])
assert.deepEqual(find('demo-cup').allowed_region_ids, ['miscellaneous'])
assert.ok(find('demo-book-math').preferred_region_ids.includes('support-shelf-2'))
assert.ok(!find('demo-storage-box').allowed_region_ids.includes('support-shelf-2'))
const cup = project.objects.find((o) => o.id === 'demo-cup')!
assert.equal(isDailyMiscellaneous({ ...cup, model: { ...cup.model, prefabId: undefined } }), false)
const extras = [
  { ...cup, id: 'study-prefab', model: prefabModelRef('books_stack', 'books') },
  { ...cup, id: 'tissue-prefab', model: prefabModelRef('tissue_box', 'genericBox') },
  { ...cup, id: 'unknown-cup', model: { ...cup.model, prefabId: undefined } },
]
const extraScene = toPackingScene({ ...input, objects: [...input.objects, ...extras] })
assert.deepEqual(extraScene.items.find((o) => o.id === 'study-prefab')!.allowed_region_ids, ['support-shelf-2'])
assert.deepEqual(extraScene.items.find((o) => o.id === 'tissue-prefab')!.allowed_region_ids, ['miscellaneous'])
assert.ok(!extraScene.items.find((o) => o.id === 'unknown-cup')!.allowed_region_ids.includes('miscellaneous'))
const wrongShelf = { ...extras[2], fixed: true, transform: { position: [.07, 1.46, .16] as [number, number, number], rotationY: 0 } }
const wrongMisc = { ...extras[2], fixed: true, transform: { position: [.8, .75, .75] as [number, number, number], rotationY: 0 } }
for (const object of [wrongShelf, wrongMisc]) assert.ok(organizationClearanceIssues([object], project.room).some((issue) => issue.code === 'target_region'), 'fixed unknown objects must not bypass exclusive storage zones')
const [padWidth, padHeight, padDepth] = PREFAB_ITEMS.mousepad.size
const padScene = toPackingScene({ ...input, objects: [...input.objects, { ...cup, id: 'check-pad', model: prefabModelRef('mousepad', 'genericBox'), dimensions: { width: padWidth, height: padHeight, depth: padDepth }, transform: { position: [.485, .75, .46], rotationY: 0 } }] })
assert.deepEqual(padScene.items.find((o) => o.id === 'check-pad')!.allowed_region_ids, ['mouse'])
assert.equal(padScene.items.find((o) => o.id === 'demo-mouse')!.allowed_region_ids[0], 'mouse-on-check-pad')
assert.ok(padScene.regions.find((r) => r.id === 'mouse')!.bounds_xz_m[1] - padScene.regions.find((r) => r.id === 'mouse')!.bounds_xz_m[0] > .30)
const run = spawnSync(process.env.PYTHON ?? 'python3', ['-B', '-c', 'import json,sys; from backend.app.domain.packing import plan_packing; print(json.dumps(plan_packing(json.load(sys.stdin))))'], {
  cwd: resolve(process.cwd(), '..'), input: JSON.stringify(scene), encoding: 'utf8', timeout: 120_000,
})
assert.equal(run.status, 0, run.stderr)
const result = JSON.parse(run.stdout)
assert.equal(result.status, 'success', JSON.stringify(result.issues))
const mapped = mapPackingOrganizationResult(result, { ...input, scene, jobId: 'workstation-test' })
assert.equal(mapped.serviceMeta?.applicable, true, JSON.stringify(mapped.serviceMeta?.issues))
assert.equal(mapped.unplaced.length, 0)
const targets = project.objects.map((object) => {
  const target = mapped.assignments.find((a) => a.objectId === object.id)!
  return { ...object, transform: { position: target.position, rotationY: target.rotationY } }
})
assert.ok(Math.abs(targets.find((o) => o.id === 'demo-monitor')!.transform.position[0] - .145) < .001)
assert.equal(targets.find((o) => o.id === 'demo-laptop')!.transform.rotationY, -Math.PI / 9)
assert.ok(targets.every((o) => objectRoomHits(o, o.transform.position, organizationReservedZones(project.room)).length === 0))
assert.deepEqual(toPackingScene({ ...input, objects: targets }).regions, scene.regions)
assert.deepEqual(toPackingScene({ ...input, preferences: { ...input.preferences, typingOffsetX: .15, cupCorner: 'frontLeft' } }).regions, scene.regions)

const storage = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k) } })
rememberOrganizationScene(project.id, { sceneId: 's1', sceneRevision: 1, baselineId: 'b1', baselineSourceId: 'browser-A' })
assert.equal(knownSceneForBaseline(project.id, 'browser-A')?.sceneId, 's1')
assert.equal(knownSceneForBaseline(project.id, 'browser-B'), null)
assert.notEqual(remoteOrganizationProjectId(project.id, 'browser-A'), remoteOrganizationProjectId(project.id, 'browser-B'))
assert.equal(remoteOrganizationProjectId('user-project', 'browser-A'), 'user-project')
console.log('Workstation geometry, strict monitor/laptop zones, prefab allowlists, study exclusivity, complete layout and demo isolation passed.')

if (process.argv.includes('--http')) {
  storage.clear()
  const baseline = planFromProject(project, 'baseline', 'Workstation HTTP test', { withScene: true })
  const args = { ...input, baseline }
  const service = createHttpServices().organizationPlanning
  const plan = await service.planOrganization(args)
  assert.equal(plan.serviceMeta?.applicable, true, JSON.stringify(plan.serviceMeta?.issues))
  const ref = await service.applyOrganization({ ...args, plan })
  assert.equal(ref!.sceneRevision, plan.serviceMeta!.sceneRevision + 1)
  const remote = remoteOrganizationProjectId(project.id, baseline.id)
  const saved = await requestJson<PackingScene>(`/projects/${encodeURIComponent(remote)}/scene`)
  assert.equal(saved.scene_id, ref!.sceneId)
  for (const assignment of plan.assignments) assert.equal(saved.items.find((i) => i.id === assignment.objectId)!.rotation_y_rad, assignment.rotationY)
  const otherBaseline = planFromProject(project, 'baseline', 'Separate browser baseline', { withScene: true })
  const otherPlan = await service.planOrganization({ ...args, baseline: otherBaseline })
  assert.equal(otherPlan.serviceMeta?.applicable, true)
  assert.notEqual(otherPlan.serviceMeta?.sceneId, ref!.sceneId)
  assert.deepEqual(await requestJson<PackingScene>(`/projects/${encodeURIComponent(remote)}/scene`), saved)
  console.log(`Real HTTP plan/apply/readback passed; separate demo baseline left ${ref!.sceneId} revision ${ref!.sceneRevision} unchanged.`)
}
