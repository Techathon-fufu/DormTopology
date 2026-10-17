import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { createDemoProject } from '../src/data/demoProject'
import { resolveOrganizationPreferences } from '../src/types/organization'
import { canonicalScene, fromPackingPosition, mapPackingOrganizationResult, packingBaseline, toPackingPosition, toPackingScene } from '../src/api/core/packingWire'
import { compileOrganizationCommands } from '../src/lib/organizationCommands'
import { planFromProject } from '../src/lib/plans'
import type { SceneObject, Vec3 } from '../src/types/project'

const demo = createDemoProject()
const preferences = resolveOrganizationPreferences(demo)
const input = { projectId: demo.id, objects: demo.objects, room: demo.room, preferences, confirmed: true }
const scene = toPackingScene(input)
assert.equal(scene.obstacles.length, 13)
assert.equal(new Set(scene.regions.map((r) => r.id)).size, scene.regions.length)
assert.deepEqual(scene.reserved_zones, [])
const typing = scene.regions.find((region) => region.id === 'typing')!
for (const item of scene.items.filter((entry) => entry.category === 'monitor' || entry.category === 'printer')) {
  assert.equal(item.placement_priority, 100)
  assert.ok(item.allowed_region_ids.length > 0)
  for (const regionId of item.allowed_region_ids) {
    const region = scene.regions.find((entry) => entry.id === regionId)!
    const [x0, x1, z0, z1] = region.bounds_xz_m
    const [tx0, tx1, tz0, tz1] = typing.bounds_xz_m
    assert.ok(x1 <= tx0 || x0 >= tx1 || z1 <= tz0 || z0 >= tz1, `${item.id} must preserve the exclusive typing region`)
  }
}
for (const item of scene.items) {
  const object = demo.objects.find((o) => o.id === item.id)!
  assert.ok(fromPackingPosition(item.position, demo.room).every((v, i) => Math.abs(v - object.transform.position[i]) < 1e-12))
  assert.equal(item.collision.type, 'compound')
  assert.ok(item.ports.every((p) => p.capacity === 1 && p.confirmed === false))
}
const strip = scene.items.find((i) => i.category === 'power_strip')!
assert.equal(strip.ports.filter((p) => p.type === 'power_source').length, 4)
assert.equal(strip.ports.filter((p) => p.type === 'power_sink').length, 1)
const estimated = { ...demo.objects[0], source: 'recognized' as const, recognition: { confidence: .5, source: 'ai' as const, dimensionSource: 'estimated' as const } }
assert.equal(toPackingScene({ ...input, objects: [estimated] }).items[0].dimensions_source, 'estimated')
assert.equal(toPackingScene({ ...input, objects: [estimated] }).items[0].dimensions_confirmed, true)

const baseline = planFromProject(demo, 'baseline', 'Original', { withScene: true })
const changed = { ...input, objects: demo.objects.map((o) => ({ ...o, transform: { ...o.transform, position: [0, 0, 0] as Vec3 } })) }
assert.deepEqual(packingBaseline(baseline, changed).items[0].position, scene.items[0].position)
assert.throws(() => packingBaseline({ ...baseline, scene: undefined }, input))

const python = spawnSync('python3', ['-c', 'import json,sys; from backend.app.domain.rules import validate_scene; s=json.load(sys.stdin); s["baseline_id"]="baseline-test"; validate_scene(s,for_planning=True); print("Domain scene contract passed")'], {
  cwd: resolve(process.cwd(), '..'), input: JSON.stringify(scene), encoding: 'utf8',
})
assert.equal(python.status, 0, python.stderr)
console.log(python.stdout.trim())

const base = demo.objects[0]
const mover: SceneObject = { ...base, id: 'check-mover', ports: [], model: { ...base.model, shape: 'genericBox' }, dimensions: { width: .1, height: .1, depth: .1 }, transform: { position: [-.4, .75, .4], rotationY: 0 }, fixed: false, locked: false }
const blocker: SceneObject = { ...mover, id: 'check-fixed', fixed: true, transform: { position: [.4, .75, .4], rotationY: 0 } }
const fixtures = [mover, blocker]
const canonical = { ...toPackingScene({ ...input, objects: fixtures }), scene_id: 'scene-check', scene_revision: 4, baseline_id: 'baseline-check' }
const ctx = { ...input, objects: fixtures, scene: canonical, jobId: 'job-check' }
const response = {
  schema_version: '1.0', scene_id: canonical.scene_id, scene_revision: 4, status: 'success', issues: [],
  metrics: { desk_free_before: null, desk_free_after: .5 },
  items: fixtures.map((o) => ({ item_id: o.id, current_pos: toPackingPosition(o.transform.position, demo.room), target_pos: toPackingPosition(o.transform.position, demo.room), target_rotation_y_rad: 0, target_region_id: 'support-desk', placement_status: 'unchanged' })),
}
const valid = mapPackingOrganizationResult(response, ctx)
assert.equal(valid.serviceMeta?.applicable, true)
assert.equal(valid.metrics.deskFreeAreaBefore, null)
assert.equal(valid.metrics.deskFreeAreaAfter, .5)
assert.equal(valid.serviceMeta?.sceneRevision, 4)
assert.throws(() => mapPackingOrganizationResult({ ...response, scene_id: 'wrong' }, ctx))
assert.throws(() => mapPackingOrganizationResult({ ...response, scene_revision: 3 }, ctx))
assert.throws(() => mapPackingOrganizationResult({ ...response, items: response.items.slice(1) }, ctx))
assert.throws(() => mapPackingOrganizationResult({ ...response, items: [response.items[0], response.items[0]] }, ctx))
assert.throws(() => canonicalScene({ ...canonical, items: [{ ...canonical.items[0], size_m: [1, 1, 1] }, canonical.items[1]] }, canonical))
const reorderKeys = (value: unknown): unknown => Array.isArray(value) ? value.map(reorderKeys)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([key, v]) => [key, reorderKeys(v)])) : value
assert.deepEqual(canonicalScene(reorderKeys(canonical), canonical), canonical)
const moved = (target: Vec3) => ({ ...response, items: [{ ...response.items[0], placement_status: 'placed', target_region_id: 'desk-clear-0', target_pos: toPackingPosition(target, demo.room) }, response.items[1]] })
const collision = mapPackingOrganizationResult(moved(blocker.transform.position), ctx)
assert.equal(collision.serviceMeta?.applicable, false)
assert.ok(collision.serviceMeta?.issues.some((i) => i.code === 'overlap'))
const floating = mapPackingOrganizationResult(moved([-.4, .8, .4]), ctx)
assert.equal(floating.serviceMeta?.applicable, false)
assert.ok(floating.serviceMeta?.issues.some((i) => i.code === 'floating'))
const penetrating = mapPackingOrganizationResult(moved([-.4, .74, .4]), ctx)
assert.equal(penetrating.serviceMeta?.applicable, false)
assert.ok(penetrating.serviceMeta?.issues.some((i) => i.code === 'roomCollision'))
assert.throws(() => mapPackingOrganizationResult({ ...moved([-.2, .75, .4]), status: 'infeasible' }, ctx))
const infeasible = mapPackingOrganizationResult({ ...response, status: 'infeasible', issues: [{ entity_id: mover.id, code: 'collision', message: 'No valid layout' }] }, ctx)
assert.equal(infeasible.serviceMeta?.applicable, false)
assert.equal(compileOrganizationCommands(infeasible, fixtures).length, 0)
assert.equal(infeasible.serviceMeta?.issues[0].message, 'No valid layout')
console.log('Organization backend checks passed: complete contract, coordinates, original baseline, source/confirmation, strict identity/coverage/poses, fixed collisions, support, furniture, infeasible, nullable continuous area.')

if (process.argv.includes('--http')) {
  const saved = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
    removeItem: (key: string) => saved.delete(key),
  } })
  const { createHttpServices } = await import('../src/api/http')
  const projectId = `organization-check-${Date.now()}`
  const project = { ...demo, id: projectId, objects: fixtures.map((o) => ({ ...o, projectId })), cables: [] }
  const source = planFromProject(project, 'baseline', 'Original', { withScene: true })
  const service = createHttpServices().organizationPlanning
  const args = { projectId, objects: project.objects, room: project.room, preferences, baseline: source, confirmed: true }
  const pendingPlan = service.planOrganization(args)
  await assert.rejects(() => service.planOrganization(args), /正在进行/)
  const plan = await pendingPlan
  assert.equal(plan.serviceMeta?.applicable, true)
  const unchangedPlan = await service.planOrganization(args)
  assert.equal(unchangedPlan.serviceMeta?.sceneRevision, plan.serviceMeta?.sceneRevision)
  const persisted = [...saved.entries()].find(([key]) => key.includes('organization-scene:'))!
  assert.equal(JSON.parse(persisted[1]).sceneId, plan.serviceMeta!.sceneId)
  assert.equal(JSON.parse(persisted[1]).items, undefined, 'persist only the scene reference, never a scene snapshot')
  const ref = await service.applyOrganization({ ...args, plan })
  assert.equal(ref?.sceneRevision, plan.serviceMeta!.sceneRevision + 1)
  await assert.rejects(() => service.applyOrganization({ ...args, plan }))
  await assert.rejects(() => service.applyOrganization({ ...args, plan: unchangedPlan }))
  console.log(`Real HTTP organization plan/apply passed: ${ref?.sceneId} revision ${ref?.sceneRevision}; unchanged sync, persistent references, concurrent requests and repeated apply checked.`)

  const originalFetch = globalThis.fetch
  for (const recovery of ['immediate', 'retry', 'wrong-version'] as const) {
    const recoveryId = `${projectId}-${recovery}`
    const recoveryProject = { ...project, id: recoveryId, objects: project.objects.map((o) => ({ ...o, projectId: recoveryId })) }
    const recoveryArgs = { ...args, projectId: recoveryId, objects: recoveryProject.objects, baseline: planFromProject(recoveryProject, 'baseline', 'Original', { withScene: true }) }
    const recoveryPlan = await service.planOrganization(recoveryArgs)
    let dropped = false, blockedRead = false, wrongVersion = false
    globalThis.fetch = async (url, options) => {
      const path = String(url)
      if (options?.method === 'POST' && path.endsWith(`/jobs/${recoveryPlan.serviceMeta!.jobId}/apply`) && !dropped) {
        const response = await originalFetch(url, options)
        assert.equal(response.status, 200, 'the real backend must commit before its response is dropped')
        await response.arrayBuffer()
        dropped = true
        throw new TypeError('Simulated lost apply response')
      }
      if (recovery === 'retry' && dropped && path.endsWith(`/jobs/${recoveryPlan.serviceMeta!.jobId}`) && !blockedRead) {
        blockedRead = true
        throw new TypeError('Simulated recovery read outage')
      }
      const response = await originalFetch(url, options)
      if (recovery === 'wrong-version' && dropped && path.endsWith(`/projects/${recoveryId}/scene`)) {
        const data = await response.json()
        wrongVersion = true
        return new Response(JSON.stringify({ ...data, scene_revision: data.scene_revision + 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return response
    }
    try {
      if (recovery === 'immediate') {
        const recovered = await service.applyOrganization({ ...recoveryArgs, plan: recoveryPlan })
        assert.equal(recovered?.sceneRevision, recoveryPlan.serviceMeta!.sceneRevision + 1)
      } else {
        await assert.rejects(() => service.applyOrganization({ ...recoveryArgs, plan: recoveryPlan }), (error: unknown) => (error as { kind?: string }).kind === 'network')
        if (recovery === 'retry') assert.equal(blockedRead, true)
        else assert.equal(wrongVersion, true)
      }
      assert.equal(dropped, true)
    } finally { globalThis.fetch = originalFetch }
    if (recovery !== 'immediate') {
      const recovered = await service.applyOrganization({ ...recoveryArgs, plan: recoveryPlan })
      assert.equal(recovered?.sceneRevision, recoveryPlan.serviceMeta!.sceneRevision + 1, 'a retry may recover the same already-consumed job after HTTP 409')
    }
    await assert.rejects(() => service.applyOrganization({ ...recoveryArgs, plan: recoveryPlan }))
  }
  console.log('Lost apply response recovery passed: real commit, immediate readback, later 409 retry, mismatching revision refused, and repeated apply protection retained.')

  const { knownOrganizationScene } = await import('../src/api/core/organizationScenes')
  const syncCases = ['initial', 'noop', 'edited', 'baseline-change', 'retry', 'wrong-source', 'wrong-version', 'wrong-name', 'wrong-usage', 'wrong-image', 'wrong-geometry', 'wrong-id', 'wrong-baseline', 'changed-baseline-id', 'aborted'] as const
  for (const recovery of syncCases) {
    const recoveryId = `${projectId}-sync-${recovery}`
    const recoveryProject = { ...project, id: recoveryId, objects: project.objects.map((object) => ({ ...object, projectId: recoveryId })) }
    let recoveryArgs = { ...args, projectId: recoveryId, objects: recoveryProject.objects, baseline: planFromProject(recoveryProject, 'baseline', 'Original', { withScene: true }) }
    if (['noop', 'edited', 'baseline-change', 'wrong-id', 'wrong-baseline', 'changed-baseline-id'].includes(recovery)) await service.planOrganization(recoveryArgs)
    if (recovery === 'edited') recoveryArgs = { ...recoveryArgs, objects: recoveryArgs.objects.map((object, index) => index ? object : { ...object, name: `${object.name} edited` }) }
    if (recovery === 'baseline-change' || recovery === 'changed-baseline-id') recoveryArgs = { ...recoveryArgs, baseline: { ...recoveryArgs.baseline, id: `${recoveryArgs.baseline.id}-new` } }
    const known = knownOrganizationScene(recoveryId)
    const controller = new AbortController()
    let dropped = false, checkedRead = false
    globalThis.fetch = async (url, options) => {
      const path = String(url)
      if (options?.method === 'PUT' && path.endsWith(`/projects/${recoveryId}/scene`) && !dropped) {
        const response = await originalFetch(url, options)
        assert.equal(response.status, 200, 'the scene must be committed before its response is dropped')
        await response.arrayBuffer()
        dropped = true
        if (recovery === 'aborted') controller.abort()
        throw new TypeError('Simulated lost scene response')
      }
      if (path.endsWith(`/projects/${recoveryId}/scene-state`)) {
        checkedRead = true
        if (recovery === 'retry') throw new TypeError('Simulated scene-state read outage')
        const response = await originalFetch(url, options)
        const state = await response.json()
        if (recovery === 'wrong-source') state.baseline_source_id = 'another-baseline-source'
        if (recovery === 'wrong-version') state.scene.scene_revision += 1
        if (recovery === 'wrong-name') state.scene.items[0].name += ' changed'
        if (recovery === 'wrong-usage') state.scene.items[0].usage_frequency = state.scene.items[0].usage_frequency === 'high' ? 'medium' : 'high'
        if (recovery === 'wrong-image') state.scene.items[0].image_url = 'https://example.invalid/other-image.png'
        if (recovery === 'wrong-geometry') state.scene.items[0].position[0] += .01
        if (recovery === 'wrong-id') state.scene.scene_id += '-another-scene'
        if (recovery === 'wrong-baseline') state.scene.baseline_id += '-another-baseline'
        if (recovery === 'changed-baseline-id') state.scene.baseline_id = known!.baselineId
        return new Response(JSON.stringify(state), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return originalFetch(url, options)
    }
    let recovered
    try {
      const operation = () => service.planOrganization({ ...recoveryArgs, signal: controller.signal })
      if (recovery === 'initial' || recovery === 'noop' || recovery === 'edited' || recovery === 'baseline-change') {
        recovered = await operation()
      } else {
        await assert.rejects(operation, (error: unknown) => (error as { kind?: string }).kind === (recovery === 'aborted' ? 'aborted' : 'network'))
        assert.deepEqual(knownOrganizationScene(recoveryId), known, 'a failed recovery must preserve the previous reference')
      }
      assert.equal(dropped, true)
      assert.equal(checkedRead, recovery !== 'aborted', 'a user abort must not trigger recovery reads')
    } finally { globalThis.fetch = originalFetch }
    recovered ??= await service.planOrganization(recoveryArgs)
    const increments = !known || recovery === 'edited' || recovery === 'baseline-change' || recovery === 'changed-baseline-id'
    assert.equal(recovered.serviceMeta?.sceneRevision, (known?.sceneRevision ?? 0) + Number(increments))
    const stored = knownOrganizationScene(recoveryId)!
    assert.equal(stored.baselineSourceId, recoveryArgs.baseline.id)
    if (known) {
      assert.equal(stored.sceneId, known.sceneId)
      if (recovery === 'baseline-change' || recovery === 'changed-baseline-id') assert.notEqual(stored.baselineId, known.baselineId)
      else assert.equal(stored.baselineId, known.baselineId)
    }
  }
  const unrelatedId = `${projectId}-unrelated-scene`
  const unrelatedProject = { ...project, id: unrelatedId, objects: project.objects.map((object) => ({ ...object, projectId: unrelatedId })) }
  const unrelatedArgs = { ...args, projectId: unrelatedId, objects: unrelatedProject.objects, baseline: planFromProject(unrelatedProject, 'baseline', 'Original', { withScene: true }) }
  const unrelatedScene = toPackingScene({ ...unrelatedArgs, confirmed: true })
  const { requestJson } = await import('../src/api/core/client')
  await requestJson(`/projects/${unrelatedId}/scene`, { method: 'PUT', body: { scene: unrelatedScene, baseline: unrelatedScene, expected_revision: null, baseline_source_id: `${source.id}-other-client` } })
  await assert.rejects(() => service.planOrganization(unrelatedArgs), (error: unknown) => (error as { status?: number }).status === 409)
  assert.equal(knownOrganizationScene(unrelatedId), null, 'matching geometry must not take over another baseline source')
  console.log(`Lost scene PUT response recovery passed: ${syncCases.length + 1} real HTTP cases covering initial/edit/baseline changes, later 409 retry, metadata/content mismatches, unrelated projects, and user abort.`)

  const fullProjectId = `${projectId}-full-demo`
  const fullProject = { ...demo, id: fullProjectId, objects: demo.objects.map((object) => ({ ...object, projectId: fullProjectId })) }
  const fullArgs = { ...args, projectId: fullProjectId, objects: fullProject.objects, baseline: planFromProject(fullProject, 'baseline', 'Original full demo', { withScene: true }) }
  assert.equal(fullArgs.objects.length, 17, 'the original demo must retain every item')
  const fullStarted = performance.now()
  const fullPlan = await service.planOrganization(fullArgs)
  const fullPlanned = performance.now()
  assert.equal(fullPlan.serviceMeta?.status, 'success', JSON.stringify(fullPlan.serviceMeta?.issues))
  assert.equal(fullPlan.serviceMeta?.applicable, true)
  assert.equal(fullPlan.assignments.length, 17)
  assert.deepEqual(new Set(fullPlan.assignments.map((assignment) => assignment.objectId)), new Set(fullArgs.objects.map((object) => object.id)))
  assert.equal(fullPlan.unplaced.length, 0)
  assert.equal(fullPlan.serviceMeta?.issues.length, 0)
  const fullRef = await service.applyOrganization({ ...fullArgs, plan: fullPlan })
  assert.equal(fullRef?.sceneRevision, fullPlan.serviceMeta!.sceneRevision + 1)
  const fullTargets = fullProject.objects.map((object) => {
    const assignment = fullPlan.assignments.find((entry) => entry.objectId === object.id)!
    return { ...object, transform: { position: assignment.position, rotationY: assignment.rotationY } }
  })
  const fullSaved = canonicalScene(await requestJson(`/projects/${fullProjectId}/scene`), toPackingScene({ ...fullArgs, objects: fullTargets, ref: fullRef ?? null }), fullRef ?? undefined)
  assert.equal(fullSaved.items.length, 17)
  console.log(`Original 17-item demo passed: success, complete mapper and geometry validation, no unplaced items, real apply revision ${fullRef?.sceneRevision}; plan ${Math.round(fullPlanned - fullStarted)}ms, total ${Math.round(performance.now() - fullStarted)}ms.`)
}
