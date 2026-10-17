import assert from 'node:assert/strict'
import { createDemoProject } from '@/data/demoProject'
import { useProjectsStore } from '@/state/projectsStore'
import { usePlansStore } from '@/state/plansStore'
import { useWorkspaceStore } from '@/state/workspaceStore'
import { useRoutingPreviewStore, acceptRoutingPreview } from '@/features/connections/routingPreview'
import { toRoutingScene } from '@/api/core/routingWire'
import type { CablePlanningResult } from '@/api/types'

// Transport/state race fixtures only; these do not assert algorithm feasibility.
const project = createDemoProject()
project.id = 'preview-races'
project.cables = [structuredClone(project.cables[0])]
project.objects = project.objects.map(o=>({...o,ports:o.ports.map(p=>({...p,confirmed:true}))}))
useProjectsStore.setState({projects:{[project.id]:project}})
usePlansStore.getState().captureBaseline(project)
const baselineId = usePlansStore.getState().baselines[project.id].id
const ref={sceneId:'scene-preview-race',sceneRevision:1,baselineId:'backend-baseline'}
const result:CablePlanningResult={
  algorithmVerified:true,plannedCount:1,conflictCount:0,notes:[],sceneRef:ref,
  cables:project.cables.map(c=>({...c,status:'planned',planSource:'algorithm',route:{channels:[],points:[[0,1,.2],[.3,1,.2]],smooth:false,pathLengthM:.3,verification:{sceneId:ref.sceneId,sceneRevision:1,status:'valid'}}})),
}
const preview=useRoutingPreviewStore.getState()
const stage=()=>preview.stage(useProjectsStore.getState().projects[project.id],result,baselineId)
const reset=()=>{useProjectsStore.setState({projects:{[project.id]:structuredClone(project)}});useWorkspaceStore.getState().resetHistory();preview.discard()}
const before=JSON.stringify(project.cables)
stage()
assert.equal(JSON.stringify(useProjectsStore.getState().projects[project.id].cables),before,'staging cannot save routes')
assert.notEqual(useRoutingPreviewStore.getState().candidate?.result,result,'candidate owns a cloned result')
assert.throws(()=>preview.stage(project,{...result,cables:[]},baselineId),/覆盖全部/)
assert.throws(()=>preview.stage(project,{...result,cables:[result.cables[0],result.cables[0]]},baselineId),/重复/)
assert.throws(()=>preview.stage(project,{...result,algorithmVerified:false},baselineId),/未经/)

const originalFetch=globalThis.fetch
async function heldAcceptance(change:()=>void, badRevision=false) {
  reset();stage()
  const scene=toRoutingScene({project,confirmed:true,ref})
  if(badRevision)scene.scene_revision++
  let release!:()=>void, reached!:()=>void
  const hold=new Promise<void>(r=>release=r), requested=new Promise<void>(r=>reached=r)
  globalThis.fetch=async(_url,init)=>{assert.equal(init?.method,'GET');reached();await hold;return new Response(JSON.stringify(scene),{headers:{'Content-Type':'application/json'}})}
  const accepting=acceptRoutingPreview(project,baselineId)
  await requested;change();const editedCables=JSON.stringify(useProjectsStore.getState().projects[project.id].cables);release()
  await assert.rejects(accepting)
  assert.equal(JSON.stringify(useProjectsStore.getState().projects[project.id].cables),editedCables,'rejected responses must not overwrite cables')
}
try {
  await heldAcceptance(()=>preview.discard())
  await heldAcceptance(()=>stage()) // same inputs, different candidate identity
  await heldAcceptance(()=>useWorkspaceStore.getState().updateObject(project.id,project.objects[0].id,{name:'changed'}))
  await heldAcceptance(()=>{},true)
  reset();stage()
  const scene=toRoutingScene({project,confirmed:true,ref})
  globalThis.fetch=async()=>new Response(JSON.stringify(scene),{headers:{'Content-Type':'application/json'}})
  await acceptRoutingPreview(project,baselineId)
  assert.equal(useRoutingPreviewStore.getState().candidate,null)
  assert.equal(useProjectsStore.getState().projects[project.id].cables[0].route.verification?.status,'valid')
  assert.equal(useWorkspaceStore.getState().past.length,1,'acceptance records one undo step')
  useWorkspaceStore.getState().undo(project.id)
  assert.equal(useProjectsStore.getState().projects[project.id].cables[0].route.verification,undefined)
} finally {globalThis.fetch=originalFetch;preview.discard()}
console.log('Routing preview: full coverage, no eager writes, cancel/replace/edit/version races and one-step acceptance passed.')
