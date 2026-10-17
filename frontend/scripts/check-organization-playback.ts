import assert from 'node:assert/strict'
import { createLegacyDemoProject as createDemoProject } from './fixtures/legacyDemo'
import { computeRuleBasedPlan } from '../src/scene/ruleLayout'
import { resolveOrganizationPreferences } from '../src/types/organization'
import { compileOrganizationCommands } from '../src/lib/organizationCommands'
import { organizationSource, canApplyOrganization } from '../src/lib/organizationSession'
import { useOrganizeStore } from '../src/state/organizeStore'
import { useWorkspaceStore } from '../src/state/workspaceStore'
import { useProjectsStore } from '../src/state/projectsStore'
import { usePlansStore } from '../src/state/plansStore'
import { planFromProject } from '../src/lib/plans'
import { assertOrganizationApplicable } from '../src/lib/organizationValidation'
import type { Project, SceneObject, Vec3 } from '../src/types/project'
const p = createDemoProject()
const original = JSON.stringify(p)
const plan = computeRuleBasedPlan({ projectId: p.id, objects: p.objects, room: p.room, preferences: resolveOrganizationPreferences(p) })
const store = () => useOrganizeStore.getState()
store().setPlan(plan, p.objects, organizationSource(p), p.room)
assert.ok(store().commands.length > 1)
assert.ok(store().commands.every(c => c.objectIds.length === 1 && c.reason))
store().startPlayback()
assert.equal(store().status, 'playing')
assert.deepEqual(store().overrides, store().originals)
store().tick(600)
assert.equal(store().batchProgress, 0.5)
store().pausePlayback()
const paused = JSON.stringify(store().overrides)
store().tick(9999)
assert.equal(JSON.stringify(store().overrides), paused)
store().resumePlayback()
store().setCompare('before')
assert.equal(store().status, 'paused')
store().resumePlayback()
assert.equal(store().compare, 'after')
store().tick(1e6)
assert.equal(store().status, 'finished')
for (const a of plan.assignments) assert.deepEqual(store().overrides[a.objectId], {position:a.position, rotationY:a.rotationY})
store().startPlayback()
assert.deepEqual(store().overrides, store().originals)
store().commands[0].durationMs = 1000
store().commands[1].durationMs = 2000
store().tick(1500)
assert.equal(store().batchIndex, 1)
assert.equal(store().batchProgress, 0.25)
store().skipToEnd()
assert.equal(store().status, 'finished')
assert.equal(JSON.stringify(p), original, 'preview never mutates project')
const bad = structuredClone(plan)
bad.assignments[0].position[0] = NaN
assert.throws(() => compileOrganizationCommands(bad,p.objects))
const duplicate = {...plan, assignments:[plan.assignments[0],plan.assignments[0]]}
assert.throws(() => compileOrganizationCommands(duplicate,p.objects))
const unknown = {...plan, assignments:[{...plan.assignments[0], objectId:'missing'}]}
assert.throws(() => compileOrganizationCommands(unknown,p.objects))
const locked = structuredClone(p.objects)
locked.find(o => o.id === plan.assignments[0].objectId)!.locked = true
assert.throws(() => compileOrganizationCommands(plan, locked))
const first = p.objects[0]
const rotationPlan = {...plan,assignments:[{...plan.assignments[0],objectId:first.id,position:first.transform.position,rotationY:first.transform.rotationY+Math.PI*2-0.1}]}
store().setPlan(rotationPlan,p.objects)
store().startPlayback();store().tick(600)
assert.ok(Math.abs(store().overrides[first.id].rotationY-first.transform.rotationY+0.05)<1e-8)
store().closePanel()
assert.equal(store().commands.length,0)
// Session visibility must not discard a paused preview or invalidate its source.
store().openPanel()
const token = store().sessionToken
const signature = organizationSource(p)
store().setPlan(plan, p.objects, signature)
store().startPlayback(); store().tick(600); store().pausePlayback()
store().setShowZones(false)
const retained = JSON.stringify(store().overrides)
store().hidePanel()
assert.equal(store().panelVisible, false)
assert.equal(store().plan?.id, plan.id)
assert.equal(store().sessionToken, token)
store().openPanel()
assert.equal(store().panelVisible, true)
assert.equal(store().status, 'paused')
assert.equal(store().showZones, false)
assert.equal(JSON.stringify(store().overrides), retained)
assert.ok(canApplyOrganization(store().sourceSignature, p))
const changedRoom = structuredClone(p)
changedRoom.room.desk.width += 0.1
assert.equal(canApplyOrganization(signature, changedRoom), false)
const changedItem = structuredClone(p)
changedItem.objects[0].transform.position[0] += 0.1
assert.equal(canApplyOrganization(signature, changedItem), false)
store().setCompare('before'); store().resumePlayback()
assert.equal(store().compare, 'after')
store().closePanel()
assert.ok(store().sessionToken > token, 'discard invalidates in-flight request token')
assert.equal(store().sourceSignature, null)
store().openPanel(); store().setStatus('planning')
assert.ok(store().isPreviewBlocking(), 'generation also protects editing')
store().hidePanel()
assert.equal(store().status, 'planning')
assert.equal(store().open, true)
store().closePanel(); store().openPanel(); store().hidePanel()
assert.equal(store().open, false, 'closing empty config returns to editing')
console.log('Preview session checks passed: hide/reopen, source invalidation, cancellation token, planning lock, config dismissal.')
Object.assign(globalThis,{window:{matchMedia:()=>({matches:true})}})
store().setPlan(plan,p.objects);store().startPlayback()
assert.equal(store().status,'finished')
console.log('Organization playback regression checks passed: commands, snapshot, pause/resume, replay, overshoot, final poses, invalid IDs/poses, fixed items, rotation, reduced motion.')

const box = (id: string, x: number): SceneObject => ({
  ...structuredClone(p.objects[0]), id, name: id,
  dimensions: { width: 0.12, height: 0.1, depth: 0.12 },
  model: { status: 'placeholder', source: 'demo', format: 'placeholder-box', shape: 'genericBox' },
  transform: { position: [x, p.room.desk.height, 0.5], rotationY: 0 },
  fixed: false, locked: false, ports: [],
})
const valid: Project = { ...structuredClone(p), objects: [box('restore-a', -0.4), box('restore-b', 0.4)], cables: [] }
const snapshot = planFromProject(valid, 'candidate', 'validated snapshot')
const install = (project: Project) => {
  useProjectsStore.setState({ projects: { [project.id]: project } })
  useWorkspaceStore.getState().resetHistory()
}
const rejectAtomically = (action: () => unknown) => {
  const beforeProject = JSON.stringify(useProjectsStore.getState().projects[valid.id])
  const beforeHistory = JSON.stringify(useWorkspaceStore.getState().past)
  assert.throws(action, /布局校验|固定|其他项目|正在应用/)
  assert.equal(JSON.stringify(useProjectsStore.getState().projects[valid.id]), beforeProject, 'rejected layout cannot mutate project or applied-plan marker')
  assert.equal(JSON.stringify(useWorkspaceStore.getState().past), beforeHistory, 'rejected layout cannot create undo history')
}
const restore = () => useWorkspaceStore.getState().applyPlanSnapshot(valid.id, snapshot)

const movedProject = structuredClone(valid)
movedProject.objects[0].transform.position[0] += 0.1
movedProject.objects[0].dimensions.width = 0.14
install(movedProject)
assert.equal(restore()?.objects, 2)
assert.deepEqual(useProjectsStore.getState().projects[valid.id].objects[0].transform.position, snapshot.scene!.objects[0].transform.position)
assert.equal(useProjectsStore.getState().projects[valid.id].objects[0].dimensions.width, 0.14, 'restoring poses preserves current measured item dimensions')

const tallerDesk = structuredClone(valid)
tallerDesk.room.desk.height += 0.2
install(tallerDesk)
rejectAtomically(restore)
rejectAtomically(() => useWorkspaceStore.getState().applyPlanSnapshot(valid.id, { ...snapshot, scene: undefined }))
usePlansStore.setState({ baselines: { [valid.id]: { ...snapshot, kind: 'baseline' } } })
rejectAtomically(() => useWorkspaceStore.getState().resetToBaseline(valid.id))

const widerItem = structuredClone(valid)
widerItem.objects[0].dimensions.width = 1.6
install(widerItem)
rejectAtomically(restore)

const fixedMoved = structuredClone(movedProject)
fixedMoved.objects[0].fixed = true
install(fixedMoved)
rejectAtomically(restore)
const lockedMoved = structuredClone(movedProject)
lockedMoved.objects[0].locked = true
install(lockedMoved)
rejectAtomically(restore)

const retainedFixed = structuredClone(movedProject)
retainedFixed.objects.push({ ...box('retained-fixed', -0.4), fixed: true })
install(retainedFixed)
rejectAtomically(restore)
const hiddenFixed = structuredClone(retainedFixed)
hiddenFixed.objects[2].visible = false
install(hiddenFixed)
rejectAtomically(restore)
assert.equal(useProjectsStore.getState().projects[valid.id].objects[2].visible, false, 'collision checks cannot reveal hidden objects')

const validPlan = {
  ...structuredClone(plan), projectId: valid.id,
  assignments: [{ ...plan.assignments[0], objectId: valid.objects[0].id, position: [-0.25, p.room.desk.height, 0.5] as Vec3, rotationY: 0 }],
  metrics: { ...plan.metrics, overlapCount: 0, outOfBoundsCount: 0 },
}
assertOrganizationApplicable(validPlan, valid)
const collidingPlan = structuredClone(validPlan)
collidingPlan.assignments[0].position = [...valid.objects[1].transform.position]
assert.throws(() => assertOrganizationApplicable(collidingPlan, valid), /布局校验/)
assert.throws(() => compileOrganizationCommands(collidingPlan, valid.objects, valid.room), /布局校验/)
const hiddenTarget = structuredClone(valid)
hiddenTarget.objects[1].visible = false
assert.throws(() => assertOrganizationApplicable(collidingPlan, hiddenTarget), /布局校验/, 'hidden retained items still block accepting a target pose')
assert.equal(hiddenTarget.objects[1].visible, false)
const infeasible = {
  ...validPlan, kind: 'algorithm' as const,
  serviceMeta: { source: 'real' as const, status: 'infeasible' as const, sceneId: 'scene-test', sceneRevision: 1, jobId: 'job-test', applicable: false,
    issues: [{ entity_id: null, code: 'collision', message: '固定物品阻挡目标布局' }] },
}
assert.deepEqual(compileOrganizationCommands(infeasible, valid.objects, valid.room), [])
assert.throws(() => assertOrganizationApplicable(infeasible, valid), /固定物品/)
store().setPlan(infeasible, valid.objects, organizationSource(valid), valid.room)
store().startPlayback(); store().skipToEnd()
assert.equal(store().status, 'preview', 'infeasible result stays read-only')
assert.deepEqual(store().commands, [])
assert.deepEqual(store().overrides, {})
assert.match(store().error!, /固定物品/)
store().closePanel()
install(valid)
store().openPanel()
store().setPlan(validPlan, valid.objects, organizationSource(valid), valid.room)
store().skipToEnd()
store().setApplying(true)
assert.equal(store().applying, true)
assert.ok(store().isPreviewBlocking())
const applyingToken = store().sessionToken
const applyingOverrides = JSON.stringify(store().overrides)
store().hidePanel()
assert.equal(store().panelVisible, true, 'applying lock survives attempted panel dismissal')
store().startPlayback(); store().setCompare('before')
assert.equal(store().status, 'finished')
assert.equal(store().compare, 'after')
assert.equal(JSON.stringify(store().overrides), applyingOverrides)
rejectAtomically(restore)
rejectAtomically(() => useWorkspaceStore.getState().updateObject(valid.id, valid.objects[0].id, { transform: { position: [0, 0, 0] } }))
assert.equal(store().sessionToken, applyingToken, 'blocked operations cannot discard the applying session')
store().setApplying(false)
store().closePanel()
assert.equal(store().applying, false)
console.log('Organization apply checks passed: full-scene collision/support validation, current dimensions, fixed/locked items, baseline and legacy restore, atomic failures, infeasible read-only results.')
