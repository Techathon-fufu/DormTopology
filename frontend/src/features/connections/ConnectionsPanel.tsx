import { useEffect, useMemo, useRef, useState } from 'react'
import type { Port, PortType, Project, SceneObject, Vec3 } from '@/types/project'
import { PORT_TYPE_LABELS } from '@/types/project'
import { localToWorld, resolvePortOffset } from '@/scene/ports'
import { useCableLink } from '@/lib/useCableLink'
import { uid } from '@/lib/utils'
import { useWorkspaceStore } from '@/state/workspaceStore'
import { useProjectsStore } from '@/state/projectsStore'
import { useOrganizeStore } from '@/state/organizeStore'
import { Button } from '@/ui/kit/button'
import { auditConnections } from './model'
import { resolvePortLocalDirection } from './portGeometry'
import { useConnectionsStore } from './store'

type Draft = {objectId:string; portId?:string; label:string; type:PortType; powered:boolean; note:string; offset:Vec3; localDirection:Vec3; source:string}
const signature = (o:SceneObject) => JSON.stringify([o.transform,o.dimensions,o.model,o.ports])
export function ConnectionsPanel({project,busy=false}: {project:Project;busy?:boolean}) {
  const session = useConnectionsStore()
  const [objectId,setObjectId] = useState(project.objects.find(o=>o.visible)?.id ?? '')
  const [draft,setDraft] = useState<Draft|null>(null)
  const [notice,setNotice] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const pendingRelocation = useRef<Draft|null>(null)
  const link = useCableLink()
  const blocked = useOrganizeStore(s=>s.applying || s.status==='planning' || s.plan!==null) || busy
  const audit = useMemo(()=>auditConnections(project),[project])
  const object = project.objects.find(o=>o.id===objectId)
  useEffect(()=> {
    useConnectionsStore.getState().open(project.id)
    const current=useProjectsStore.getState().projects[project.id]
    setObjectId(current?.objects.find(o=>o.visible)?.id??'')
    setDraft(null);setNotice('');pendingRelocation.current=null
    return ()=>{pendingRelocation.current=null;useConnectionsStore.getState().reset()}
  },[project.id])
  useEffect(()=> {
    const hit = session.hit
    if (session.projectId !== project.id || !hit) return
    const o=useProjectsStore.getState().projects[project.id]?.objects.find(o=>o.id===hit.objectId)
    if (!o) return
    const prior=pendingRelocation.current
    if(prior && prior.objectId===o.id){
      pendingRelocation.current=null
      setDraft({...prior,offset:hit.offset,localDirection:hit.localDirection})
      return
    }
    const p=o.ports.find(p=>p.id===session.editingPortId)
    setDraft({objectId:o.id,portId:p?.id,label:p?.label??'',type:p?.type??'usb-a',powered:p?.powered??false,note:p?.note??'',offset:hit.offset,localDirection:hit.localDirection,source:signature(o)})
  },[session.hit,session.projectId,session.editingPortId,project.id])
  useEffect(()=> {
    if (draft && !dialog.current?.open) dialog.current?.showModal()
    if (!draft) dialog.current?.close()
  },[draft])
  function cancel() {pendingRelocation.current=null;setDraft(null);setNotice('');session.cancelPick()}
  useEffect(()=> {
    const escape=(e:KeyboardEvent)=>{if(e.key==='Escape' && useConnectionsStore.getState().pickingObjectId){e.preventDefault();e.stopImmediatePropagation();cancel()}}
    window.addEventListener('keydown',escape,true);return ()=>window.removeEventListener('keydown',escape,true)
  })
  function begin(o:SceneObject,p?:Port) {
    if(blocked)return
    pendingRelocation.current=null
    useWorkspaceStore.getState().select(o.id)
    session.startPick(project.id,o.id,p?.id)
    setNotice(`请点击「${o.name}」的模型表面；拖动旋转视角，Esc 取消。`)
    if(p) setDraft({objectId:o.id,portId:p.id,label:p.label??'',type:p.type,powered:p.powered,note:p.note??'',offset:resolvePortOffset(o,p),localDirection:resolvePortLocalDirection(p),source:signature(o)})
  }
  function save() {
    if(!draft || blocked)return
    if (useOrganizeStore.getState().isPreviewBlocking()) return
    const current=useProjectsStore.getState().projects[project.id]?.objects.find(o=>o.id===draft.objectId)
    if(!current || signature(current)!==draft.source){cancel();setNotice('物品在编辑期间已变化，请重新描点。');return}
    const old=current.ports.find(p=>p.id===draft.portId)
    const p:Port={...old,id:old?.id??uid('port'),label:draft.label.trim()||undefined,type:draft.type,powered:draft.powered,note:draft.note.trim()||undefined,offset:draft.offset,localDirection:draft.localDirection,confirmed:old?.confirmed??false}
    useWorkspaceStore.getState().updateObject(project.id,current.id,{ports:old?current.ports.map(x=>x.id===p.id?p:x):[...current.ports,p]})
    cancel();setNotice('接口已保存；请核对并确认。可撤销本次修改。')
  }
  function remove(o:SceneObject,p:Port) {
    if(project.cables.some(c=>[c.from,c.to].some(e=>e.objectId===o.id && e.portId===p.id))){setNotice('接口仍被线缆引用，请先移除或改接线缆。');return}
    useWorkspaceStore.getState().updateObject(project.id,o.id,{ports:o.ports.filter(x=>x.id!==p.id)})
  }
  return <details className="rounded-lg border border-border p-2" open>
    <summary className="cursor-pointer text-sm font-semibold">描点与连接检查</summary>
    <div className="mt-2 space-y-2 text-xs [&_button]:min-h-11 sm:[&_button]:min-h-0">
      <label className="block">标记物品<select aria-label="标记物品" className="mt-1 w-full rounded border border-border bg-surface p-2" value={objectId} onChange={e=>{setObjectId(e.target.value);cancel()}}>
        {project.objects.filter(o=>o.visible).map(o=><option key={o.id} value={o.id}>{o.name}</option>)}
      </select></label>
      <Button size="sm" variant="outline" className="w-full" disabled={!object || blocked} onClick={()=>object&&begin(object)}>在表面标记接口</Button>
      {session.projectId===project.id && session.pickingObjectId ? <Button size="sm" variant="ghost" onClick={cancel}>取消描点</Button>:null}
      {object?.ports.map(p=><div key={p.id} className="space-y-1 rounded border border-border p-2" data-port-id={p.id}>
        <p className="break-words font-medium">{p.label??PORT_TYPE_LABELS[p.type]} · {p.confirmed?'已确认':'待确认'}</p>
        {p.note?<p className="break-words text-muted-foreground">{p.note}</p>:null}
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="ghost" disabled={blocked} onClick={()=>begin(object,p)}>编辑标记</Button>
          {!p.confirmed?<Button size="sm" variant="ghost" disabled={blocked} onClick={()=>useWorkspaceStore.getState().updateObject(project.id,object.id,{ports:object.ports.map(x=>x.id===p.id?{...x,confirmed:true}:x)})}>确认接口</Button>:null}
          <Button size="sm" variant="ghost" disabled={blocked || !p.confirmed || p.type==='wireless'} onClick={()=>link(project,object.id,p.id)}>以此点连线</Button>
          <Button size="sm" variant="ghost" disabled={blocked} aria-label={`删除接口 ${p.label??p.id}`} onClick={()=>remove(object,p)}>删除</Button>
        </div>
      </div>)}
      {notice?<p role="status" className="break-words text-muted-foreground">{notice}</p>:null}
      <details><summary className="cursor-pointer">全场检查 · {audit.objects.length} 件物品 · {audit.issues.length} 项阻断</summary>
        <ul className="mt-2 space-y-2">{audit.objects.map((o,i)=><li key={`${o.objectId}-${i}`}><button className="text-left underline" onClick={()=>{setObjectId(o.objectId);useWorkspaceStore.getState().select(o.objectId)}}>{o.name}</button>：{o.message}</li>)}</ul>
        {audit.issues.map((issue,i)=><p key={i} className="mt-2 break-words text-danger">{issue.message}</p>)}
        <p className="mt-2 text-muted-foreground">未接线设备请复核用途；兼容接口不会自动连接。隐藏物品仍参与检查。</p>
      </details>
    </div>
    <dialog ref={dialog} onCancel={e=>{e.preventDefault();cancel()}} aria-label="编辑接口标记" className="fixed inset-0 m-auto max-h-[85vh] w-[min(92vw,400px)] overflow-y-auto rounded-xl border border-border bg-surface p-4 text-foreground shadow-xl backdrop:bg-black/40">
      {draft?<form className="space-y-3" onSubmit={e=>{e.preventDefault();save()}}>
        <h3 className="font-semibold">{draft.portId?'编辑接口标记':'新建接口标记'}</h3>
        <label className="block text-xs">标记名称<input autoFocus maxLength={100} className="mt-1 w-full rounded border border-border bg-surface p-2" value={draft.label} onChange={e=>setDraft({...draft,label:e.target.value})}/></label>
        <label className="block text-xs">接口类型<select className="mt-1 w-full rounded border border-border bg-surface p-2" value={draft.type} onChange={e=>setDraft({...draft,type:e.target.value as PortType})}>{Object.entries(PORT_TYPE_LABELS).map(([t,l])=><option key={t} value={t}>{l}</option>)}</select></label>
        <label className="flex gap-2 text-xs"><input type="checkbox" checked={draft.powered} onChange={e=>setDraft({...draft,powered:e.target.checked})}/>受电接口（电源输入）</label>
        <label className="block text-xs">标记说明<textarea maxLength={500} className="mt-1 w-full rounded border border-border bg-surface p-2" value={draft.note} onChange={e=>setDraft({...draft,note:e.target.value})}/></label>
        <p className="text-xs text-muted-foreground">朝向取自所选表面。位置：{(project.objects.some(o=>o.id===draft.objectId)?localToWorld(project.objects.find(o=>o.id===draft.objectId)!,draft.offset):draft.offset).map(n=>Math.round(n*1000)).join(' / ')} mm</p>
        <Button type="button" variant="outline" size="sm" onClick={()=>{pendingRelocation.current={...draft};setDraft(null);session.startPick(project.id,draft.objectId,draft.portId);setNotice('请在模型表面选择新位置。')}}>重新描点</Button>
        <p className="text-xs text-muted-foreground">保存后需确认接口；修改位置会使旧理线失效。</p>
        <div className="flex gap-2"><Button type="submit" disabled={blocked}>保存接口</Button><Button type="button" variant="outline" onClick={cancel}>取消</Button></div>
      </form>:null}
    </dialog>
  </details>
}
