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
const baseCable = structuredClone(project.cables[0])
// Second cable always fails verification: acceptance must leave it untouched.
const failingCable = {
  ...structuredClone(baseCable),
  id: 'cable-failing',
  status: 'conflict' as const,
  planSource: 'algorithm' as const,
  note: '算法未找到可用路径',
  route: { channels: [] as string[], points: [] as number[][] },
}
project.cables = [baseCable, failingCable]
project.objects = project.objects.map(o=>({...o,ports:o.ports.map(p=>({...p,confirmed:true}))}))
useProjectsStore.setState({projects:{[project.id]:project}})
usePlansStore.getState().captureBaseline(project)
const baselineId = usePlansStore.getState().baselines[project.id].id
const ref={sceneId:'scene-preview-race',sceneRevision:1,baselineId:'backend-baseline'}
const result:CablePlanningResult={
  algorithmVerified:true,plannedCount:1,conflictCount:1,notes:[],sceneRef:ref,
  trayAnalysis:{sceneId:ref.sceneId,sceneRevision:ref.sceneRevision,optimizations:[]},
  cables:[
    {...baseCable,status:'planned',planSource:'algorithm',route:{channels:[],strategy:'backboard',points:[[0,1,.2],[.3,1,.2]],smooth:false,pathLengthM:.3,verification:{pathStyle:'orthogonal',sceneId:ref.sceneId,sceneRevision:1,status:'valid',supportStatus:'not_evaluated'}}},
    failingCable,
  ],
}
const preview=useRoutingPreviewStore.getState()
const stage=()=>preview.stage(useProjectsStore.getState().projects[project.id],result,baselineId)
const reset=()=>{useProjectsStore.setState({projects:{[project.id]:structuredClone(project)}});useWorkspaceStore.getState().resetHistory();preview.discard()}
const before=JSON.stringify(project.cables)
stage()
assert.equal(JSON.stringify(useProjectsStore.getState().projects[project.id].cables),before,'staging cannot save routes')
assert.equal(useProjectsStore.getState().projects[project.id].cableTrayAnalysis,undefined,'staging cannot save tray analysis')
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
  assert.equal(useProjectsStore.getState().projects[project.id].cableTrayAnalysis,undefined,'rejected responses cannot save tray analysis')
}
try {
  await heldAcceptance(()=>preview.discard())
  await heldAcceptance(()=>stage()) // same inputs, different candidate identity
  await heldAcceptance(()=>useWorkspaceStore.getState().updateObject(project.id,project.objects[0].id,{name:'changed'}))
  await heldAcceptance(()=>useProjectsStore.getState().update(project.id,current=>({
    ...current,
    objects:current.objects.map((object,index)=>index===0
      ? {...object,model:{...object.model,prefabId:object.model.prefabId==='cup'?'phone':'cup'}}
      : object),
  })))
  await heldAcceptance(()=>{},true)
  reset();stage()
  const scene=toRoutingScene({project,confirmed:true,ref})
  globalThis.fetch=async()=>new Response(JSON.stringify(scene),{headers:{'Content-Type':'application/json'}})
  const summary=await acceptRoutingPreview(project,baselineId)
  assert.deepEqual(summary,{applied:1,skipped:1},'acceptance applies verified routes only')
  assert.equal(useRoutingPreviewStore.getState().candidate,null)
  const accepted=useProjectsStore.getState().projects[project.id].cables
  assert.equal(accepted[0].route.verification?.status,'valid')
  assert.deepEqual(accepted[1],structuredClone(project).cables[1],'failed routes must stay untouched')
  assert.deepEqual(useProjectsStore.getState().projects[project.id].cableTrayAnalysis,result.trayAnalysis,'tray analysis is saved only with accepted routes')
  assert.equal(useWorkspaceStore.getState().past.length,1,'acceptance records one undo step')
  useWorkspaceStore.getState().undo(project.id)
  assert.equal(useProjectsStore.getState().projects[project.id].cables[0].route.verification,undefined)
} finally {globalThis.fetch=originalFetch;preview.discard()}
console.log('Routing preview: full coverage, no eager writes, cancel/replace/edit/version races, verified-only acceptance and one-step undo passed.')
