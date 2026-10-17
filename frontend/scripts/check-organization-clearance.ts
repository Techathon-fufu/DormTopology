import assert from 'node:assert/strict'
import { createHttpServices } from '../src/api/http'
import { organizationInputSignature } from '../src/api/core/packingWire'
import { rememberOrganizationScene } from '../src/api/core/organizationScenes'
import { assertRecommendedScenePlacement } from '../src/lib/organizationValidation'
import { planFromProject } from '../src/lib/plans'
import { worldCollision } from '../src/scene/collisionGeometry'
import { itemSpacingViolations } from '../src/scene/itemSpacing'
import { useOrganizeStore } from '../src/state/organizeStore'
import { usePlansStore } from '../src/state/plansStore'
import { useProjectsStore } from '../src/state/projectsStore'
import { useWorkspaceStore } from '../src/state/workspaceStore'
import { resolveOrganizationPreferences, type OrganizationPlan } from '../src/types/organization'
import type { Project, SceneObject, Vec3 } from '../src/types/project'
import { createLegacyDemoProject } from './fixtures/legacyDemo'

const values = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
  removeItem: (key: string) => values.delete(key),
} })
const source = createLegacyDemoProject()
const box = (id: string, x: number): SceneObject => ({ ...structuredClone(source.objects[0]), id, name: id,
  fixed: false, locked: false, visible: true, ports: [],
  model: { status: 'placeholder', source: 'demo', shape: 'genericBox' },
  dimensions: { width: .1, height: .1, depth: .1 }, transform: { position: [x, .75, .4], rotationY: 0 } })
const project: Project = { ...source, id: 'organization-clearance-check', objects: [box('a', -.3), box('b', .3)], cables: [],
  room: { ...source.room, furnitureModel: undefined, desk: { width: 1.6, depth: .8, height: .75, thickness: .025 },
    shelf: { ...source.room.shelf, enabled: false }, posts: [], cableHoles: [{ id: 'clear-hole', position: [-.65, .75, .15], diameter: .05 }] } }
const preferences = resolveOrganizationPreferences(project)
const objectsAt = (gap: number) => {
  const bounds = worldCollision(project.objects[0]).bounds
  const width = bounds.max[0] - bounds.min[0]
  return [box('a', 0), box('b', width + gap)]
}
const install = () => {
  useProjectsStore.setState({ projects: { [project.id]: structuredClone(project) } })
  useWorkspaceStore.getState().resetHistory()
  useOrganizeStore.getState().closePanel()
}
const rejectedWithoutMutation = (action: () => unknown) => {
  const saved = JSON.stringify(useProjectsStore.getState().projects[project.id])
  const history = JSON.stringify(useWorkspaceStore.getState().past)
  assert.throws(action, /布局校验未通过/)
  assert.equal(JSON.stringify(useProjectsStore.getState().projects[project.id]), saved)
  assert.equal(JSON.stringify(useWorkspaceStore.getState().past), history)
}
const tooClose = { ...project, objects: objectsAt(.015) }
const snapshot = planFromProject(tooClose, 'candidate', 'Old 15 mm layout', { withScene: true })
for (const scene of [snapshot.scene, undefined]) {
  install()
  rejectedWithoutMutation(() => useWorkspaceStore.getState().applyPlanSnapshot(project.id, { ...snapshot, scene }))
}
const exactlySpaced = { ...project, objects: objectsAt(.02) }
for (const scene of [true, false]) {
  install()
  const exactSnapshot = planFromProject(exactlySpaced, 'candidate', 'Exact 20 mm layout', { withScene: scene })
  assert.ok(useWorkspaceStore.getState().applyPlanSnapshot(project.id, exactSnapshot))
  assert.deepEqual(itemSpacingViolations(useProjectsStore.getState().projects[project.id].objects, .02), [])
}

const blocksHole = { ...project, objects: [
  { ...project.objects[0], transform: { ...project.objects[0].transform, position: [...project.room.cableHoles[0].position] as Vec3 } },
  project.objects[1],
] }
const blockedSnapshot = planFromProject(blocksHole, 'candidate', 'Covered hole', { withScene: true })
for (const scene of [blockedSnapshot.scene, undefined]) {
  install()
  rejectedWithoutMutation(() => useWorkspaceStore.getState().applyPlanSnapshot(project.id, { ...blockedSnapshot, scene }))
}

// Restoring the original unorganized state and undoing a move retain their established semantics.
install()
usePlansStore.setState({ baselines: { [project.id]: { ...snapshot, kind: 'baseline' } } })
useWorkspaceStore.getState().resetToBaseline(project.id)
assert.equal(itemSpacingViolations(useProjectsStore.getState().projects[project.id].objects, .02).length, 1)
useWorkspaceStore.getState().undo(project.id)
assert.deepEqual(useProjectsStore.getState().projects[project.id].objects, project.objects)
useWorkspaceStore.getState().redo(project.id)
assert.equal(itemSpacingViolations(useProjectsStore.getState().projects[project.id].objects, .02).length, 1)

const known = { sceneId: 'old-gap-scene', sceneRevision: 1, baselineId: 'old-gap-baseline', baselineSourceId: 'original-source' }
rememberOrganizationScene(project.id, known)
const plan = {
  id: 'old-gap-plan', projectId: project.id, kind: 'algorithm', createdAt: Date.now(), preferences,
  assignments: tooClose.objects.map((object) => ({ objectId: object.id, position: object.transform.position,
    rotationY: 0, zone: 'desk', reason: 'Legacy result', targetRegionId: 'support-desk', placementStatus: 'placed' })),
  batches: [], unplaced: [], rules: [], summary: 'Legacy packing result',
  metrics: { deskFreeAreaBefore: 1, deskFreeAreaAfter: 1, placedCount: 2, movableCount: 2, unplacedCount: 0, overlapCount: 0, outOfBoundsCount: 0, method: 'legacy' },
  serviceMeta: { source: 'real', status: 'success', ...known, jobId: 'old-gap-job', applicable: true, issues: [],
    inputSignature: organizationInputSignature({ objects: project.objects, room: project.room, preferences }) },
} as OrganizationPlan
let requests = 0
const previousFetch = globalThis.fetch
globalThis.fetch = async () => { requests++; throw new Error('No request is expected for rejected targets') }
try {
  await assert.rejects(() => createHttpServices().organizationPlanning.applyOrganization({ projectId: project.id,
    plan, objects: project.objects, room: project.room, preferences }), /小于要求/)
  assert.equal(requests, 0, 'an old low-gap algorithm plan is rejected before the apply POST')
  const holePlan = { ...plan, assignments: blocksHole.objects.map((object) => ({ ...plan.assignments[0],
    objectId: object.id, position: object.transform.position })) }
  await assert.rejects(() => createHttpServices().organizationPlanning.applyOrganization({ projectId: project.id,
    plan: holePlan, objects: project.objects, room: project.room, preferences }), /出线孔上方保留空间/)
  assert.equal(requests, 0, 'a covered hole is rejected before the apply POST')
  const oldSignaturePlan = { ...plan, assignments: exactlySpaced.objects.map((object) => ({ ...plan.assignments[0],
    objectId: object.id, position: object.transform.position })), serviceMeta: { ...plan.serviceMeta!,
    inputSignature: JSON.stringify([project.objects, project.room, preferences]) } }
  await assert.rejects(() => createHttpServices().organizationPlanning.applyOrganization({ projectId: project.id,
    plan: oldSignaturePlan, objects: project.objects, room: project.room, preferences }), /整理结果已失效/)
  assert.equal(requests, 0, 'even valid target poses cannot apply an old signature before constraint synchronization')
} finally { globalThis.fetch = previousFetch }
assertRecommendedScenePlacement(exactlySpaced.objects, project.room, project.objects)
console.log('Recommendation clearance passed: full/legacy 15 mm and covered-hole snapshots fail atomically, exact 20 mm succeeds, old low-gap and old-signature algorithm plans fail before HTTP, baseline restoration and undo/redo keep original semantics.')
