import assert from 'node:assert/strict'
import { createDemoProject } from '../src/data/demoProject'
import { computeRuleBasedPlan } from '../src/scene/ruleLayout'
import { resolveOrganizationPreferences } from '../src/types/organization'
import { compileOrganizationCommands } from '../src/lib/organizationCommands'
import { organizationSource, canApplyOrganization } from '../src/lib/organizationSession'
import { useOrganizeStore } from '../src/state/organizeStore'
const p = createDemoProject()
const original = JSON.stringify(p)
const plan = computeRuleBasedPlan({ projectId: p.id, objects: p.objects, room: p.room, preferences: resolveOrganizationPreferences(p) })
const store = () => useOrganizeStore.getState()
store().setPlan(plan, p.objects)
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
