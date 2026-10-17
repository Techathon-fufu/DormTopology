import { useEffect, useMemo, useRef, useState } from 'react'
import type { Port, PortType, Project, SceneObject, Vec3 } from '@/types/project'
import { PORT_TYPE_LABELS } from '@/types/project'
import { localToWorld, resolvePortOffset } from '@/scene/ports'
import { useCableLink } from '@/lib/useCableLink'
import { cn, uid } from '@/lib/utils'
import { useWorkspaceStore } from '@/state/workspaceStore'
import { useProjectsStore } from '@/state/projectsStore'
import { useOrganizeStore } from '@/state/organizeStore'
import { Button } from '@/ui/kit/button'
import { auditConnections } from './model'
import { resolvePortLocalDirection } from './portGeometry'
import { useConnectionsStore } from './store'
import { IsolatedModelViewport } from './IsolatedModelViewport'

type Draft = { objectId: string; portId?: string; label: string; type: PortType; powered: boolean; note: string; offset: Vec3; localDirection: Vec3; source: string }

/** 保存前的物品快照：尺寸 / 位姿 / 模型 / 接口任一变化都使草稿过期 */
const signature = (o: SceneObject) => JSON.stringify([o.transform, o.dimensions, o.model, o.ports])

/**
 * 独立的单模型描点页：局部展示副本与工作台位姿分离。
 *
 * - 由工作台右键菜单或走线面板入口跳转，三维视口只显示当前物品；
 * - 本页完成描点、重新定位、确认、删除和检查；选定接口后回工作台连线；
 * - 物品下拉包含隐藏物品（标注「已隐藏」），全场检查的条目可直接「定位」到对应物品与接口；
 * - 草稿只存在于本页会话，保存才写项目；物品在编辑期间变化时拒绝写入旧草稿。
 */
export function MarkingPage({
  project,
  objectId,
  busy = false,
  onExit,
  onObjectChange,
}: {
  project: Project
  objectId: string | null
  busy?: boolean
  onExit: () => void
  onObjectChange: (objectId: string) => void
}) {
  const session = useConnectionsStore()
  const target = objectId ?? ''
  const [draft, setDraft] = useState<Draft | null>(null)
  const [focusPort, setFocusPort] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const pendingRelocation = useRef<Draft | null>(null)
  const link = useCableLink()
  const blocked = useOrganizeStore((s) => s.applying || s.status === 'planning' || s.plan !== null) || busy
  const canUndo = useWorkspaceStore((s) => s.past.length > 0)
  const audit = useMemo(() => auditConnections(project), [project])
  const object = project.objects.find((o) => o.id === target)

  // 换物品或重新进入页面即开始取点；未保存草稿不跨物品保留。
  useEffect(() => {
    pendingRelocation.current = null
    setDraft(null)
    setNotice('')
    if (target && !blocked) useConnectionsStore.getState().startPick(project.id, target)
    else useConnectionsStore.getState().cancelPick()
  }, [project.id, target, blocked])

  useEffect(() => {
    useConnectionsStore.getState().open(project.id)
    return () => {
      pendingRelocation.current = null
      useConnectionsStore.getState().reset()
    }
  }, [project.id])

  useEffect(() => {
    const hit = session.hit
    if (session.projectId !== project.id || !hit || hit.objectId !== target) return
    const o = useProjectsStore.getState().projects[project.id]?.objects.find((item) => item.id === hit.objectId)
    if (!o) return
    const prior = pendingRelocation.current
    if (prior && prior.objectId === o.id) {
      pendingRelocation.current = null
      setDraft({ ...prior, offset: hit.offset, localDirection: hit.localDirection })
      return
    }
    const p = o.ports.find((port) => port.id === session.editingPortId)
    setDraft({ objectId: o.id, portId: p?.id, label: p?.label ?? '', type: p?.type ?? 'power-ac', powered: p?.powered ?? true, note: p?.note ?? '', offset: hit.offset, localDirection: hit.localDirection, source: signature(o) })
  }, [session.hit, session.projectId, session.editingPortId, project.id, target])

  useEffect(() => {
    if (draft && !dialog.current?.open) dialog.current?.showModal()
    if (!draft) dialog.current?.close()
  }, [draft])

  function cancel() {
    pendingRelocation.current = null
    setDraft(null)
    setNotice('')
    useConnectionsStore.getState().cancelPick()
  }

  const exit = () => {
    pendingRelocation.current = null
    setDraft(null)
    useConnectionsStore.getState().cancelPick()
    onExit()
  }

  // Esc：先取消描点，再关闭本页（对话框自身处理 Esc）。
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (useConnectionsStore.getState().pickingObjectId) {
        e.preventDefault()
        e.stopImmediatePropagation()
        cancel()
        return
      }
      if (dialog.current?.open) return
      e.preventDefault()
      e.stopImmediatePropagation()
      exit()
    }
    window.addEventListener('keydown', escape, true)
    return () => window.removeEventListener('keydown', escape, true)
  })

  function begin(o: SceneObject, p?: Port) {
    if (blocked) return
    pendingRelocation.current = null
    useWorkspaceStore.getState().select(o.id)
    session.startPick(project.id, o.id, p?.id)
    setNotice(`请点击「${o.name}」的模型表面；拖动旋转视角，Esc 取消。`)
    if (p) setDraft({ objectId: o.id, portId: p.id, label: p.label ?? '', type: p.type, powered: p.powered, note: p.note ?? '', offset: resolvePortOffset(o, p), localDirection: resolvePortLocalDirection(p), source: signature(o) })
  }

  function save() {
    if (!draft || blocked) return false
    if (useOrganizeStore.getState().isPreviewBlocking()) return false
    const current = useProjectsStore.getState().projects[project.id]?.objects.find((o) => o.id === draft.objectId)
    if (!current || signature(current) !== draft.source) {
      cancel()
      setNotice('物品在编辑期间已变化，请重新描点。')
      return false
    }
    const old = current.ports.find((p) => p.id === draft.portId)
    const p: Port = { ...old, id: old?.id ?? uid('port'), label: draft.label.trim() || undefined, type: draft.type, powered: draft.powered, note: draft.note.trim() || undefined, offset: draft.offset, localDirection: draft.localDirection, confirmed: old?.confirmed ?? false }
    useWorkspaceStore.getState().updateObject(project.id, current.id, { ports: old ? current.ports.map((x) => (x.id === p.id ? p : x)) : [...current.ports, p] })
    cancel()
    setNotice('接口已保存；请核对并确认。可撤销本次修改。')
    return true
  }

  function remove(o: SceneObject, p: Port) {
    if (project.cables.some((c) => [c.from, c.to].some((e) => e.objectId === o.id && e.portId === p.id))) {
      setNotice('接口仍被线缆引用，请先移除或改接线缆。')
      return
    }
    useWorkspaceStore.getState().updateObject(project.id, o.id, { ports: o.ports.filter((x) => x.id !== p.id) })
  }

  /** 全场检查条目定位：切到该物品并高亮相关接口（隐藏物品同样可定位并确认） */
  function locate(targetId: string, portId?: string) {
    cancel()
    onObjectChange(targetId)
    setFocusPort(portId ?? null)
    setNotice('')
    useWorkspaceStore.getState().select(targetId)
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background" role="region" aria-label="表面描点页面">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-3">
        <Button size="sm" variant="outline" onClick={exit}>返回工作台</Button>
        <h2 className="text-sm font-semibold">表面描点</h2>
        <span className="max-w-[40vw] truncate text-xs text-muted-foreground">
          {object ? `${object.name}${object.visible ? '' : '（已隐藏）'}` : '未选择物品'}
        </span>
        <span
          className={cn(
            'ml-auto rounded-full border px-2 py-0.5 text-[11px]',
            audit.blocking ? 'border-danger/50 text-danger' : 'border-border text-muted-foreground',
          )}
        >
          {audit.blocking ? `连接检查 · ${audit.issues.length} 项待处理` : '连接检查 · 无阻断项'}
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="relative min-h-0 min-w-0 flex-1">
          {object ? <IsolatedModelViewport key={object.id} project={project} object={object} /> : null}
        </div>
      <aside aria-label="接口标记设置" className="w-[320px] shrink-0 space-y-3 overflow-y-auto border-l border-border bg-surface p-4 text-xs">
        <label className="block">
          标记物品
          <select
            aria-label="标记物品"
            className="mt-1 w-full rounded border border-border bg-surface p-2"
            value={target}
            onChange={(e) => { cancel(); setFocusPort(null); onObjectChange(e.target.value) }}
          >
            {project.objects.map((o) => (
              <option key={o.id} value={o.id}>{o.visible ? o.name : `${o.name}（已隐藏）`}</option>
            ))}
          </select>
        </label>

        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="flex-1" disabled={!object || blocked} onClick={() => object && begin(object)}>
            在表面标记接口
          </Button>
          {session.projectId === project.id && session.pickingObjectId ? (
            <Button size="sm" variant="ghost" onClick={cancel}>取消描点</Button>
          ) : null}
        </div>

        {object && !object.visible ? (
          <p className="text-warning">该物品在工作台中已隐藏；此处单独显示，标记后仍保持隐藏。</p>
        ) : null}

        {notice ? <p role="status" className="break-words text-muted-foreground">{notice}</p> : null}
        {blocked ? <p role="status" className="text-warning">请先返回工作台完成当前规划或退出预览，再编辑接口。</p> : null}

        {object?.ports.map((p) => (
          <div key={p.id} data-port-id={p.id} className={cn('space-y-1 rounded border border-border p-2', focusPort === p.id && 'ring-2 ring-primary')}>
            <p className="break-words font-medium">{p.label ?? PORT_TYPE_LABELS[p.type]} · {p.confirmed ? '已确认' : '待确认'}</p>
            {p.note ? <p className="break-words text-muted-foreground">{p.note}</p> : null}
            <div className="flex flex-wrap gap-1">
              <Button size="sm" variant="ghost" disabled={blocked} onClick={() => begin(object, p)}>编辑标记</Button>
              {!p.confirmed ? (
                <Button size="sm" variant="ghost" disabled={blocked} onClick={() => useWorkspaceStore.getState().updateObject(project.id, object.id, { ports: object.ports.map((x) => (x.id === p.id ? { ...x, confirmed: true } : x)) })}>
                  确认接口
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" disabled={blocked || !p.confirmed || p.type === 'wireless'} onClick={() => { useWorkspaceStore.getState().setMode('cable'); link(project, object.id, p.id); exit() }}>以此点连线</Button>
              <Button size="sm" variant="ghost" disabled={blocked} aria-label={`删除接口 ${p.label ?? p.id}`} onClick={() => remove(object, p)}>删除</Button>
            </div>
          </div>
        ))}

        <Button size="sm" variant="ghost" className="w-full" disabled={!canUndo || blocked} onClick={() => useWorkspaceStore.getState().undo(project.id)}>
          撤销上次修改
        </Button>

        <details className="rounded border border-border p-2">
          <summary className="cursor-pointer">全场检查 · {audit.objects.length} 件物品 · {audit.issues.length} 项阻断</summary>
          <ul className="mt-2 space-y-1">
            {audit.objects.map((o, i) => (
              <li key={`${o.objectId}-${i}`}>
                <button type="button" className="text-left underline" onClick={() => locate(o.objectId)}>{o.name}</button>
                <span className="text-muted-foreground">：{o.message}</span>
              </li>
            ))}
          </ul>
          {audit.issues.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {audit.issues.map((issue, i) => (
                <li key={i} className="break-words text-danger">
                  {issue.objectId ? (
                    <button type="button" className="mr-1 underline" onClick={() => locate(issue.objectId!, issue.portId)}>定位</button>
                  ) : null}
                  {issue.message}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-2 text-muted-foreground">点「定位」切到该物品并高亮相关接口；未接线设备请复核用途，兼容接口不会自动连接。</p>
        </details>
      </aside>
      </div>

      <dialog
        ref={dialog}
        onCancel={(e) => { e.preventDefault(); cancel() }}
        aria-label="编辑接口标记"
        className="pointer-events-auto fixed inset-0 m-auto max-h-[85vh] w-[min(92vw,400px)] overflow-y-auto rounded-xl border border-border bg-surface p-4 text-foreground shadow-xl backdrop:bg-black/40"
      >
        {draft ? (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save() }}>
            <h3 className="font-semibold">{draft.portId ? '编辑接口标记' : '新建接口标记'}</h3>
            <label className="block text-xs">标记名称<input autoFocus maxLength={100} className="mt-1 w-full rounded border border-border bg-surface p-2" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} /></label>
            <label className="block text-xs">接口类型<select className="mt-1 w-full rounded border border-border bg-surface p-2" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as PortType })}>{Object.entries(PORT_TYPE_LABELS).map(([t, l]) => <option key={t} value={t}>{l}</option>)}</select></label>
            <label className="flex gap-2 text-xs"><input type="checkbox" checked={draft.powered} onChange={(e) => setDraft({ ...draft, powered: e.target.checked })} />受电口（电源输入）</label>
            <label className="block text-xs">标记说明<textarea maxLength={500} className="mt-1 w-full rounded border border-border bg-surface p-2" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} /></label>
            <p className="text-xs text-muted-foreground">朝向取自所选表面。位置：{(project.objects.some((o) => o.id === draft.objectId) ? localToWorld(project.objects.find((o) => o.id === draft.objectId)!, draft.offset) : draft.offset).map((n) => Math.round(n * 1000)).join(' / ')} mm</p>
            <Button type="button" variant="outline" size="sm" onClick={() => { pendingRelocation.current = { ...draft }; setDraft(null); session.startPick(project.id, draft.objectId, draft.portId); setNotice('请在模型表面选择新位置。') }}>重新描点</Button>
            <p className="text-xs text-muted-foreground">保存后需确认接口；修改位置会使旧理线失效。</p>
            <div className="flex flex-wrap gap-2"><Button type="submit" disabled={blocked}>保存接口</Button><Button type="button" variant="outline" disabled={blocked} onClick={() => { if (save()) exit() }}>保存并返回工作台</Button><Button type="button" variant="ghost" onClick={cancel}>取消</Button></div>
          </form>
        ) : null}
      </dialog>
    </div>
  )
}
