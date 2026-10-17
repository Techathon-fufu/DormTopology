import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { createDemoProject } from '../src/data/demoProject'
import { planFromProject } from '../src/lib/plans'
import { endpointOf } from '../src/scene/cables'
import { canonicalScene, toPackingPosition } from '../src/api/core/packingWire'
import { apiBaseUrl } from '../src/api/core/config'
import { cablePlanningInputSignature, mapRoutingResult, toRoutingScene } from '../src/api/core/routingWire'
import { resolveOrganizationPreferences } from '../src/types/organization'
import type { Project, SceneObject } from '../src/types/project'

const demo = createDemoProject()
const projectId = `routing-check-${Date.now()}`
const object = (id: string, x: number): SceneObject => ({
  ...demo.objects[0], id, projectId, name: id, source: 'manual', category: 'electrical',
  dimensions: { width: .08, height: .04, depth: .08 },
  transform: { position: [x, .75, .19], rotationY: 0 },
  model: { status: 'placeholder', source: 'demo', shape: 'genericBox' },
  ports: [{ id: `${id}:hdmi`, type: 'hdmi', powered: false, offset: [0, .02, -.04], direction: 'back', confirmed: true }],
})
const a = object('routing-device-a', -.55), b = object('routing-device-b', -.15)
const project: Project = { ...demo, id: projectId, objects: [a, b], room: { ...demo.room, shelf: { ...demo.room.shelf, enabled: false }, posts: [] },
  cables: [{ id: 'routing-wire', projectId, kind: 'video', visibility: 'hidden', thickness: 'thin',
    from: endpointOf(a, a.ports[0]), to: endpointOf(b, b.ports[0]),
    route: { channels: ['free'], points: [endpointOf(a, a.ports[0]).position, endpointOf(b, b.ports[0]).position] },
    actualLengthM: 2, reserveLengthM: .05, status: 'existing', accessories: [] }],
}
const scene = { ...toRoutingScene({ project, confirmed: true }), baseline_id: 'routing-original' }
assert.ok(scene.routing_graph.edges.some((edge) => edge.modes.includes('slot')))
assert.ok(scene.routing_graph.edges.some((edge) => edge.modes.includes('backboard')))
assert.ok(scene.routing_graph.nodes.some((node) => node.kind === 'slot'))
assert.ok(scene.routing_graph.nodes.some((node) => node.kind === 'fixing_point'))
assert.ok(!('supports' in scene.routing_graph), 'do not invent installed ties or trays')
assert.ok(scene.obstacles.some((obstacle) => obstacle.id.startsWith('furniture:desk-top:')))
assert.ok(!scene.obstacles.some((obstacle) => obstacle.id === 'furniture:desk-top'), 'the hole must also open the collision geometry')
const hole = toPackingPosition(project.room.cableHoles[0].position, project.room)
assert.ok(scene.obstacles.filter((obstacle) => obstacle.id.startsWith('furniture:desk-top:')).every((obstacle) => !(hole[0] > obstacle.min[0] && hole[0] < obstacle.max[0] && hole[2] > obstacle.min[2] && hole[2] < obstacle.max[2])))
assert.equal(scene.cables[0].length_m, 2)
assert.equal(scene.cables[0].slack_m, .05)
assert.equal(scene.cables[0].mode, 'backboard')
assert.ok(scene.cables.every((cable) => cable.baseline_path_points === undefined))
assert.ok(scene.items.every((item) => item.dimensions_confirmed && item.ports.every((port) => port.confirmed)))
assert.throws(() => toRoutingScene({ project, confirmed: false }), /确认/)
assert.throws(() => toRoutingScene({ project: { ...project, objects: [{ ...a, ports: [{ ...a.ports[0], confirmed: false }] }, b] }, confirmed: true }), /接口尚未确认/)
const unknownProject = { ...project, cables: [{ ...project.cables[0], actualLengthM: undefined }] }
const unknownScene = { ...toRoutingScene({ project: unknownProject, confirmed: true }), baseline_id: scene.baseline_id }
assert.equal(unknownScene.cables[0].length_m, null)
for (const actualLengthM of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
  assert.throws(() => toRoutingScene({ project: { ...project, cables: [{ ...project.cables[0], actualLengthM }] }, confirmed: true }), /实际线长无效/)
}
assert.throws(() => toRoutingScene({ project: { ...project, cables: [{ ...project.cables[0], to: project.cables[0].from }] }, confirmed: true }), /必须不同/)
const rotated = { ...project, objects: [{ ...a, transform: { ...a.transform, rotationY: Math.PI / 2 } }, b] }
assert.equal(toRoutingScene({ project: rotated, confirmed: true }).items[0].ports[0].confirmed, true)
assert.notEqual(cablePlanningInputSignature(project), cablePlanningInputSignature(rotated))
assert.notEqual(cablePlanningInputSignature(project), cablePlanningInputSignature({ ...project, objects: [...project.objects, object('obstacle', .2)] }))
assert.equal(cablePlanningInputSignature(project), cablePlanningInputSignature({ ...project, objects: [{ ...a, model: { ...a.model, status: 'ready', assetUrl: '/models/appearance.glb' } }, b] }))

function runDomain(value: unknown): Record<string, any> {
  const python = spawnSync('python3', ['-B', '-c', 'import json,sys; from backend.app.domain.routing import plan_routing; print(json.dumps(plan_routing(json.load(sys.stdin))))'], {
    cwd: resolve(process.cwd(), '..'), input: JSON.stringify(value), encoding: 'utf8', timeout: 120_000,
  })
  assert.equal(python.status, 0, python.stderr)
  return JSON.parse(python.stdout)
}
const result = runDomain(scene)
assert.equal(result.status, 'success', JSON.stringify(result))
const valid = mapRoutingResult(result, { scene, project })
const unknownResult = runDomain(unknownScene)
assert.equal(unknownResult.status, 'success', JSON.stringify(unknownResult))
assert.deepEqual(unknownResult.cables, result.cables, 'unknown availability changes no geometry or computed length')
const unknown = mapRoutingResult(unknownResult, { scene: unknownScene, project: unknownProject })
assert.equal(unknown.plannedCount, 1)
assert.equal(unknown.cables[0].actualLengthM, undefined)
assert.equal(unknown.cables[0].route.pathLengthM, result.cables[0].path_length_m)
assert.match(unknown.cables[0].note!, /已计算所需线长，现有线材长度未校验/)
assert.match(valid.cables[0].note!, /现有线材长度已校验/)
assert.throws(() => mapRoutingResult({ ...unknownResult, cables: [{ ...unknownResult.cables[0], path_length_m: null }] }, { scene: unknownScene, project: unknownProject }), /长度/)
assert.equal(valid.plannedCount, 1)
assert.equal(valid.conflictCount, 0)
assert.equal(valid.algorithmVerified, true)
assert.equal(valid.cables[0].route.smooth, false)
assert.equal(valid.cables[0].route.pathLengthM, result.cables[0].path_length_m)
assert.equal(valid.cables[0].route.verification?.supportStatus, 'not_evaluated')
assert.ok(valid.cables[0].route.points[0].every((v, i) => Math.abs(v - project.cables[0].from.position[i]) < 1e-8))
assert.ok(valid.cables[0].route.points[valid.cables[0].route.points.length - 1].every((v, i) => Math.abs(v - project.cables[0].to.position[i]) < 1e-8))
assert.equal(valid.cables[0].route.points.length, result.cables[0].path_points.length, 'render exactly the backend samples')
assert.throws(() => mapRoutingResult({ ...result, scene_revision: 2 }, { scene, project }), /版本/)
assert.throws(() => mapRoutingResult({ ...result, cables: [] }, { scene, project }), /全部/)
assert.throws(() => mapRoutingResult({ ...result, cables: [result.cables[0], result.cables[0]] }, { scene, project }), /重复/)
assert.throws(() => mapRoutingResult({ ...result, cables: [{ ...result.cables[0], path_length_m: 10 }] }, { scene, project }), /长度/)
assert.throws(() => mapRoutingResult({ ...result, cables: [{ ...result.cables[0], end_port_id: a.ports[0].id }] }, { scene, project }), /端点/)
assert.throws(() => mapRoutingResult({ ...result, cables: [{ ...result.cables[0], support_check: { status: 'verified', max_unsupported_span_m: 0, support_ids: [] } }] }, { scene, project }), /支撑/)
const shortProject = { ...project, cables: [{ ...project.cables[0], actualLengthM: .01 }] }
const shortScene = { ...toRoutingScene({ project: shortProject, confirmed: true }), baseline_id: scene.baseline_id }
const failed = runDomain(shortScene)
assert.equal(failed.cables[0].status, 'failed')
assert.equal(failed.cables[0].reason_code, 'length_exceeded')
const mappedFailure = mapRoutingResult(failed, { scene: shortScene, project: shortProject })
assert.equal(mappedFailure.conflictCount, 1)
assert.deepEqual(mappedFailure.cables[0].route.points, [])
assert.equal(mappedFailure.cables[0].route.pathLengthM, undefined)
assert.equal(mappedFailure.cables[0].status, 'conflict')
assert.throws(() => mapRoutingResult({ ...failed, cables: [{ ...failed.cables[0], path_points: result.cables[0].path_points }] }, { scene: shortScene, project: shortProject }), /清空/)
canonicalScene({ ...scene, scene_id: 'saved', baseline_id: 'baseline' }, scene)
console.log('Routing conversion/domain checks passed: unknown length allowed, known length validated, complete graph, real opening, coordinates, explicit confirmation, exact samples, short-cable failure and stale version rejection.')

if (process.argv.includes('--http')) {
  const storage = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key),
  } })
  const { createHttpServices } = await import('../src/api/http')
  const { useProjectsStore } = await import('../src/state/projectsStore')
  const { organizationSource } = await import('../src/lib/organizationSession')
  const services = createHttpServices()
  const service = services.cablePlanning
  const baseline = planFromProject(project, 'baseline', 'Original', { withScene: true })
  const args = { projectId, project, baseline, confirmed: true, objects: project.objects, room: project.room, cables: project.cables, preferences: resolveOrganizationPreferences(project) }
  const originalFetch = globalThis.fetch
  let finalGet = false
  globalThis.fetch = async (url, options) => {
    const response = await originalFetch(url, options)
    if ((options?.method ?? 'GET') === 'GET' && String(url).endsWith(`/projects/${projectId}/scene`)) finalGet = true
    return response
  }
  try {
    const pending = service.planCables(args)
    await assert.rejects(() => service.planCables(args), /正在进行/)
    const response = await pending
    assert.equal(response.plannedCount, 1)
    assert.equal(response.algorithmVerified, true)
    assert.ok(finalGet, 'recheck the current backend revision before adopting results')
    const organizationArgs = { projectId, objects: project.objects, room: project.room,
      preferences: resolveOrganizationPreferences(project), baseline, confirmed: true }
    const installVerifiedRoutes = (cables: Project['cables']) => {
      const verified = { ...project, cables }
      useProjectsStore.setState({ projects: { [projectId]: verified } })
      return organizationSource(verified)
    }
    const assertOrganizationInvalidation = (source: string, points: Project['cables'][number]['route']['points']) => {
      const current = useProjectsStore.getState().projects[projectId]
      assert.equal(current.cables[0].status, 'stale', 'organization synchronization invalidates old routing verification before a preview is accepted')
      assert.equal(current.cables[0].route.verification, undefined)
      assert.equal(current.cables[0].route.pathLengthM, undefined)
      assert.deepEqual(current.cables[0].route.points, points, 'keep the old route as history rather than a valid connection')
      assert.equal(organizationSource(current), source, 'derived verification changes must not discard the pending organization preview')
      assert.notEqual(organizationSource({ ...current, cables: [{ ...current.cables[0], actualLengthM: .5 }] }), source, 'actual cable input changes still invalidate the preview')
    }
    const organizationSourceBefore = installVerifiedRoutes(response.cables)
    const organizationPlan = await services.organizationPlanning.planOrganization(organizationArgs)
    assert.ok(organizationPlan.serviceMeta!.sceneRevision > response.sceneRef!.sceneRevision)
    assertOrganizationInvalidation(organizationSourceBefore, response.cables[0].route.points)

    const rerouted = await service.planCables(args)
    const sourceBeforeLostSync = installVerifiedRoutes(rerouted.cables)
    let lostSync = false
    globalThis.fetch = async (url, options) => {
      if (options?.method === 'PUT' && String(url).endsWith(`/projects/${projectId}/scene`)) {
        const committed = await originalFetch(url, options)
        assert.equal(committed.status, 200)
        await committed.arrayBuffer()
        lostSync = true
        throw new TypeError('Lost scene synchronization response')
      }
      if (String(url).endsWith(`/projects/${projectId}/scene-state`)) throw new TypeError('Recovery read unavailable')
      return originalFetch(url, options)
    }
    await assert.rejects(() => services.organizationPlanning.planOrganization(organizationArgs), /连接后端/)
    assert.ok(lostSync, 'the canonical version really advanced before the response was lost')
    assertOrganizationInvalidation(sourceBeforeLostSync, rerouted.cables[0].route.points)
    globalThis.fetch = originalFetch
    await services.organizationPlanning.planOrganization(organizationArgs)
    console.log('Organization/routing state passed: new preview and lost committed synchronization invalidate old verification while preserving routes and the organization input signature.')

    const unknownResponse = await service.planCables({ ...args, project: unknownProject, cables: unknownProject.cables })
    assert.equal(unknownResponse.plannedCount, 1)
    assert.equal(unknownResponse.cables[0].actualLengthM, undefined)
    assert.equal(unknownResponse.cables[0].route.pathLengthM, response.cables[0].route.pathLengthM)
    const savedUnknown = await (await originalFetch(`${apiBaseUrl}/api/v1/projects/${projectId}/scene`)).json()
    assert.equal(savedUnknown.cables[0].length_m, null, 'persist unknown availability honestly')
    const shortResponse = await service.planCables({ ...args, project: shortProject, cables: shortProject.cables })
    assert.equal(shortResponse.conflictCount, 1)
    assert.deepEqual(shortResponse.cables[0].route.points, [])
    assert.ok(shortResponse.sceneRef!.sceneRevision > response.sceneRef!.sceneRevision)
    let advanced = false
    globalThis.fetch = async (url, options) => {
      const response = await originalFetch(url, options)
      if (!advanced && (options?.method ?? 'GET') === 'GET' && String(url).includes('/jobs/')) {
        const job = await response.clone().json()
        if (job.status === 'succeeded') {
          const saved = await (await originalFetch(`${apiBaseUrl}/api/v1/projects/${projectId}/scene`)).json()
          const revision = saved.scene_revision
          saved.items[0].position[0] += .02
          const updated = await originalFetch(`${apiBaseUrl}/api/v1/projects/${projectId}/scene`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scene: saved, expected_revision: revision, baseline_source_id: baseline.id }),
          })
          assert.equal(updated.status, 200)
          assert.equal((await updated.json()).scene_revision, revision + 1)
          advanced = true
        }
      }
      return response
    }
    await assert.rejects(() => service.planCables(args), /版本/)
    assert.ok(advanced, 'another session really changed the saved scene after the job succeeded')
    console.log(`Real HTTP cable plan passed: ${response.sceneRef!.sceneId}, successful geometry, short length failure, project lock and stale canonical revision rejection.`)
  } finally { globalThis.fetch = originalFetch }
}
