import { useEffect, useMemo, useRef, useState } from 'react'
import { Outlet, useLocation, useMatch, useNavigate, useParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import type { GenerationJob, Project, SceneObject } from '@/types/project'
import { useProject, useProjectsStore } from '@/state/projectsStore'
import { usePlansStore } from '@/state/plansStore'
import { useJobsStore } from '@/state/jobsStore'
import { useOrganizeStore } from '@/state/organizeStore'
import { useCableStore } from '@/state/cableStore'
import { useDeskModelStore } from '@/state/deskModelStore'
import { useWorkspaceStore } from '@/state/workspaceStore'
import { isMockMode, services } from '@/api'
import { cablePlanningInputSignature } from '@/api/core/routingWire'
import { auditConnections } from '@/features/connections/model'
import { ObjectContextMenu } from '@/features/connections/ObjectContextMenu'
import { useRoutingPreviewStore } from '@/features/connections/routingPreview'
import { useConnectionsStore } from '@/features/connections/store'
import { resolveOrganizationPreferences } from '@/types/organization'
import { validateScene, type SceneIssue } from '@/scene/sceneValidation'
import { cn } from '@/lib/utils'
import { DEMO_PROJECT_ID } from '@/data/demoProject'
import { Toolbar } from '@/ui/workspace/Toolbar'
import { WorkspaceToolPanel } from '@/ui/workspace/WorkspaceToolPanel'
import { WorkspaceGuide } from '@/ui/workspace/WorkspaceGuide'
import { OrganizePanel } from '@/ui/workspace/OrganizePanel'
import { PlanPanel } from '@/ui/workspace/PlanPanel'
import { StatusBar } from '@/ui/workspace/StatusBar'
import { Viewport } from '@/ui/workspace/Viewport'
import { DemoTour } from '@/ui/tour/DemoTour'
import { Button } from '@/ui/kit/button'
import { DataBadge } from '@/ui/kit/data-badge'
import { Drawer } from '@/ui/kit/drawer'
import { EmptyState } from '@/ui/kit/empty-state'

const mm = (v: number) => Math.round(v * 1000) / 1000

function routingConfirmationSignature(project: Project): string {
  return JSON.stringify({
    room: project.room,
    objects: project.objects.map((object) => ({
      id: object.id,
      dimensions: object.dimensions,
      transform: object.transform,
      ports: object.ports,
      visible: object.visible,
    })),
  })
}

/**
 * 拖拽提示芯片：只订阅拖拽状态，拖动时仅此组件重渲染（避免整页重渲染）。
 */
function DragHintChip() {
  const drag = useWorkspaceStore((s) => s.drag)
  if (!drag) return null
  const label =
    drag.support === 'desk'
      ? '桌面'
      : drag.support === 'shelf'
        ? '书架搁板'
        : drag.support === 'floor'
          ? '地面'
          : '—'
  return (
    <div
      className={cn(
        'pointer-events-none rounded-full border bg-surface/95 px-3 py-1.5 text-xs shadow-sm',
        drag.valid ? 'border-border' : 'border-danger/50 text-danger',
      )}
    >
      {drag.valid
        ? `吸附支撑面：${label} · 松开后保存（可撤销）`
        : '当前位置越界或与其它物品相交：松开后将恢复到上一次有效位置'}
    </div>
  )
}

export function WorkspacePage() {
  const { id } = useParams<{ id: string }>()
  const project = useProject(id)
  const navigate = useNavigate()
  const location = useLocation()

  const captureBaseline = usePlansStore((s) => s.captureBaseline)
  const saveCandidate = usePlansStore((s) => s.saveCandidate)
  const resetHistory = useWorkspaceStore((s) => s.resetHistory)
  const mode = useWorkspaceStore((s) => s.mode)
  const selectedId = useWorkspaceStore((s) => s.selectedId)
  const selectedCableId = useCableStore((s) => s.selectedCableId)
  const createJob = useJobsStore((s) => s.create)
  const updateJob = useJobsStore((s) => s.update)
  const panelVisible = useOrganizeStore((s) => s.panelVisible)
  const organizeOpen = useOrganizeStore((s) => s.open)
  const organizeStatus = useOrganizeStore((s) => s.status)
  const cableNotice = useCableStore((s) => s.notice)
  const cableAnimStatus = useCableStore((s) => s.animStatus)
  const deskMetrics = useDeskModelStore((s) => s.metrics)

  const [busy, setBusy] = useState<'cable' | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [leftOpen, setLeftOpen] = useState(false)
  const [rightOpen, setRightOpen] = useState(false)
  const [plansOpen, setPlansOpen] = useState(false)
  // 保留工作台会话和撤销历史；子路由独立渲染单品视口。
  const marking = useMatch('/projects/:id/objects/:objectId/ports') !== null
  /** 物品右键菜单的屏幕坐标 */
  const [objectMenu, setObjectMenu] = useState<{ objectId: string; x: number; y: number } | null>(null)
  const flashTimer = useRef<number | null>(null)
  const cablePlanning = useRef(false)
  const [routingConfirmation, setRoutingConfirmation] = useState<string | null>(null)

  /** 打开所选物品的独立描点路由。 */
  const openMarking = (target?: string | null) => {
    if (!project) return
    if (busy) { showFlash('走线规划进行中，请完成后再描点'); return }
    if (useOrganizeStore.getState().isPreviewBlocking()) {
      showFlash('整理预览进行中，请先结束整理再描点')
      return
    }
    const next =
      (target && project.objects.some((o) => o.id === target) ? target : null) ??
      (selectedId && project.objects.some((o) => o.id === selectedId) ? selectedId : null) ??
      project.objects.find((o) => o.visible)?.id ??
      null
    setObjectMenu(null)
    setLeftOpen(false)
    setRightOpen(false)
    if (!next) { showFlash('请先添加需要标记的物品'); return }
    useWorkspaceStore.getState().select(next)
    navigate(`/projects/${encodeURIComponent(project.id)}/objects/${encodeURIComponent(next)}/ports`)
  }

  const projectId = project?.id
  const routingConfirmed = Boolean(project && routingConfirmation === `${project.id}:${routingConfirmationSignature(project)}`)

  const confirmRouting = (confirmed: boolean) => {
    if (!confirmed || !project) {
      setRoutingConfirmation(null)
      return
    }
    for (const object of project.objects) {
      if (object.ports.length === 0) continue
      useWorkspaceStore.getState().updateObject(project.id, object.id, {
        ports: object.ports.map((port) => ({ ...port, confirmed: port.type !== 'wireless' })),
      })
    }
    const current = useProjectsStore.getState().projects[project.id]
    setRoutingConfirmation(`${current.id}:${routingConfirmationSignature(current)}`)
  }

  // Small screens edit selected scene entities in the left tools drawer.
  useEffect(() => {
    if ((!selectedId && !selectedCableId) || window.matchMedia('(min-width: 1024px)').matches) return
    if (useOrganizeStore.getState().applying) return
    setRightOpen(false)
    setLeftOpen(true)
  }, [selectedId, selectedCableId])

  // 场景摆放校验（越界 / 相交 / 悬空）：随项目数据变化实时重算
  const issuesById = useMemo(
    () =>
      project
        ? validateScene(project.objects, project.room, deskMetrics)
        : new Map<string, SceneIssue[]>(),
    [project, deskMetrics],
  )

  const showFlash = (msg: string) => {
    setFlash(msg)
    if (flashTimer.current) window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => setFlash(null), 3200)
  }

  // 走线模式操作提示（连线 / 节点 / 规划结果）→ 底部 flash
  useEffect(() => {
    if (!cableNotice) return
    showFlash(cableNotice)
    useCableStore.getState().setNotice(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cableNotice])

  // 从方案对比页返回时携带的提示（设为当前方案的结果）：展示后清除，避免刷新重复出现
  useEffect(() => {
    const state = location.state as { flash?: string } | null
    if (!state?.flash) return
    showFlash(state.flash)
    navigate(location.pathname, { replace: true, state: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, location.pathname])

  // 离开走线模式：清理连线 / 拖拽 / 收拢动画等会话状态
  useEffect(() => {
    if (mode === 'cable') return
    const cs = useCableStore.getState()
    cs.setLinkFrom(null)
    cs.setNodeDrag(null)
    cs.resetAnim()
  }, [mode])

  // 进入项目：重置会话历史并采集「整理前」快照（与当前方案分开保存）
  useEffect(() => {
    if (!projectId) return
    resetHistory()
    const p = useProjectsStore.getState().projects[projectId]
    if (p) captureBaseline(p)
    return () => useOrganizeStore.getState().closePanel()
  }, [projectId, resetHistory, captureBaseline])

  // 快捷键：Ctrl+Z 撤销 / Ctrl+Shift+Z 重做 / F 重置视角 / Q·E 旋转 / 方向键微调 / Delete 删除 / Esc 取消选中
  useEffect(() => {
    if (!projectId || marking) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      const mod = e.ctrlKey || e.metaKey
      const store = useWorkspaceStore.getState()
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (useOrganizeStore.getState().isPreviewBlocking()) return
        if (e.shiftKey) store.redo(projectId)
        else store.undo(projectId)
        return
      }
      if (mod) return
      if (useConnectionsStore.getState().pickingObjectId) return

      const p = useProjectsStore.getState().projects[projectId]
      const selected =
        p && store.selectedId ? (p.objects.find((o) => o.id === store.selectedId) ?? null) : null

      if (e.key.toLowerCase() === 'f') {
        store.resetView()
      } else if (e.key === 'Escape') {
        const cableStore = useCableStore.getState()
        if (cableStore.linkFrom) cableStore.setLinkFrom(null)
        else if (cableStore.selectedCableId) cableStore.selectCable(null)
        else store.select(null)
      } else if (useOrganizeStore.getState().isPreviewBlocking()) {
        // 整理预览 / 动画期间不响应移动类快捷键（先接受方案或恢复原布局）
        return
      } else if ((e.key === 'q' || e.key === 'e') && selected && !selected.locked) {
        const delta = e.key === 'e' ? Math.PI / 2 : -Math.PI / 2
        store.updateObject(
          projectId,
          selected.id,
          { transform: { rotationY: selected.transform.rotationY + delta } },
          true,
        )
        showFlash(`已旋转「${selected.name}」90°（可撤销）`)
      } else if (
        ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) &&
        selected &&
        !selected.locked
      ) {
        e.preventDefault()
        const step = e.shiftKey ? 0.1 : 0.01
        const [x, y, z] = selected.transform.position
        const nx =
          e.key === 'ArrowLeft' ? mm(x - step) : e.key === 'ArrowRight' ? mm(x + step) : x
        const nz = e.key === 'ArrowUp' ? mm(z - step) : e.key === 'ArrowDown' ? mm(z + step) : z
        store.updateObject(projectId, selected.id, { transform: { position: [nx, y, nz] } }, true)
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
        e.preventDefault()
        store.removeObject(projectId, selected.id)
        showFlash(`已删除「${selected.name}」（Ctrl+Z 可撤销）`)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [projectId, marking])

  // 整理动画驱动器：playing 状态下按帧推进批次进度（只更新会话内覆盖位姿，不写项目存储）
  useEffect(() => {
    if (organizeStatus !== 'playing') return
    let raf = 0
    let last = performance.now()
    const loop = (now: number) => {
      const dt = Math.min(64, now - last)
      last = now
      useOrganizeStore.getState().tick(dt)
      if (useOrganizeStore.getState().status === 'playing') raf = window.requestAnimationFrame(loop)
    }
    raf = window.requestAnimationFrame(loop)
    return () => window.cancelAnimationFrame(raf)
  }, [organizeStatus])

  // 线缆收拢动画驱动器（仅展示：在会话内插值，不写项目存储）
  useEffect(() => {
    if (cableAnimStatus !== 'playing') return
    let raf = 0
    let last = performance.now()
    const loop = (now: number) => {
      const dt = Math.min(64, now - last)
      last = now
      useCableStore.getState().tick(dt)
      if (useCableStore.getState().animStatus === 'playing') raf = window.requestAnimationFrame(loop)
    }
    raf = window.requestAnimationFrame(loop)
    return () => window.cancelAnimationFrame(raf)
  }, [cableAnimStatus])

  const handleOpenOrganize = () => {
    useWorkspaceStore.getState().setMode('organize')
    useOrganizeStore.getState().openPanel()
    // 宽屏为右侧停靠面板；窄屏同步打开右侧抽屉展示整理面板
    if (typeof window !== 'undefined' && !window.matchMedia('(min-width: 1280px)').matches) {
      setLeftOpen(false)
      setRightOpen(true)
    }
  }

  const handleOpenPlans = () => {
    if (useOrganizeStore.getState().applying) return
    setPlansOpen((v) => !v)
    // 宽屏为右侧停靠面板（优先于整理面板展示）；窄屏同步打开右侧抽屉
    if (typeof window !== 'undefined' && !window.matchMedia('(min-width: 1280px)').matches) {
      setLeftOpen(false)
      setRightOpen(true)
    }
  }

  const runPlanCables = async (targetIds?: string[]) => {
    const p = useProjectsStore.getState().projects[projectId ?? '']
    if (!p || cablePlanning.current || useOrganizeStore.getState().isPreviewBlocking()) return
    if (!routingConfirmed) {
      showFlash('请先核对并确认物品尺寸、位置与接口')
      return
    }
    const audit = auditConnections(p)
    if (audit.blocking) {
      showFlash(`请先处理连接问题：${audit.issues[0].message}（右键物品 →「表面描点」进入描点页面查看全场检查）`)
      return
    }
    useConnectionsStore.getState().cancelPick()
    useRoutingPreviewStore.getState().discard()
    const baseline = usePlansStore.getState().baselines[p.id]
    if (!baseline) { showFlash('整理前快照缺失，请重新进入工作台。'); return }
    const inputSignature = cablePlanningInputSignature(p)
    cablePlanning.current = true
    const job = createJob({
      projectId: p.id,
      type: 'cable',
      title:
        targetIds && targetIds.length > 0
          ? '更新走线（真实后端）'
          : '规划走线（真实后端）',
      mock: false,
    })
    setBusy('cable')
    updateJob(job.id, { status: 'running', progress: 0.05, stageLabel: '准备中' })
    try {
      const result = await services.cablePlanning.planCables({
        project: p,
        baseline,
        confirmed: routingConfirmed,
        projectId: p.id,
        objects: p.objects,
        room: p.room,
        cables: p.cables,
        targetIds,
        preferences: resolveOrganizationPreferences(p),
        onProgress: (progress, stageLabel) =>
          updateJob(job.id, { status: 'running', progress, stageLabel }),
      })
      const current = useProjectsStore.getState().projects[p.id]
      if (!current) return
      if (cablePlanningInputSignature(current) !== inputSignature) {
        throw new Error('场景或线缆已变化，旧走线结果已丢弃。请重新规划。')
      }
      if (usePlansStore.getState().baselines[p.id]?.id !== baseline.id) throw new Error('原始快照已变化，请重新规划。')
      useRoutingPreviewStore.getState().stage(current, result, baseline.id)

      const summary = `规划 ${result.plannedCount} 条${
        result.conflictCount > 0 ? `，${result.conflictCount} 条存在障碍（见右侧路径检查）` : ''
      }`
      const warnCount = result.warnings?.length ?? 0
      const verifyNote = `真实后端算法结果${result.algorithmVerified ? '（后端已标记 verified）' : '（后端未标记 verified）'}${
        warnCount > 0 ? `，本地校验未采用 ${warnCount} 条路径` : ''
      }`
      updateJob(job.id, {
        status: result.conflictCount > 0 ? result.plannedCount > 0 ? 'partial' : 'failed' : 'success',
        progress: 1,
        resultNote: `${summary} · ${verifyNote}`,
      })
      showFlash(
        `${summary}：路径来自真实后端算法${result.plannedCount > 0 ? '，请在左侧预览并接受理线方案' : ''}（可撤销）`,
      )
    } catch (err) {
      showFlash(err instanceof Error ? err.message : String(err))
      updateJob(job.id, {
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      })
    } finally {
      cablePlanning.current = false
      setBusy(null)
    }
  }

  const handleGenerateModel = async (object: SceneObject) => {
    const p = useProjectsStore.getState().projects[projectId ?? '']
    if (!p) return
    const attempt = object.model.status === 'failed' ? 1 : 0
    const job = createJob({
      projectId: p.id,
      type: 'model',
      title: `生成模型：${object.name}${isMockMode ? '' : '（真实后端）'}`,
      itemIds: [object.id],
      mock: isMockMode,
    })
    updateJob(job.id, { status: 'running', progress: 0.05, attempts: attempt + 1 })
    useWorkspaceStore
      .getState()
      .updateObject(p.id, object.id, { model: { status: 'generating' } }, false)
    try {
      const res = await services.modelGeneration.generateObject({
        projectId: p.id,
        object,
        attempt,
        onProgress: (progress, stageLabel) =>
          updateJob(job.id, { status: 'running', progress, stageLabel }),
      })
      useWorkspaceStore.getState().updateObject(
        p.id,
        object.id,
        {
          model: {
            status: res.assetUrl ? 'ready' : 'placeholder',
            source: 'generated',
            format: res.format ?? (res.assetUrl ? 'glb' : 'placeholder-box'),
            assetUrl: res.assetUrl,
            note: res.note,
          },
        },
        false,
      )
      updateJob(job.id, { status: 'success', progress: 1, resultNote: res.note })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      useWorkspaceStore
        .getState()
        .updateObject(p.id, object.id, { model: { status: 'failed', note: msg } }, false)
      updateJob(job.id, { status: 'failed', error: msg })
    }
  }

  const handleSavePlan = () => {
    const p = useProjectsStore.getState().projects[projectId ?? '']
    if (!p) return
    const plan = saveCandidate(p)
    showFlash(
      `已保存「${plan.name}」（含布局 / 线缆 / 来源快照）；可在「方案对比」中查看与对比`,
    )
  }

  const handleRetryJob = (job: GenerationJob) => {
    if (job.type === 'layout') handleOpenOrganize()
    else if (job.type === 'cable') void runPlanCables()
    else if (job.type === 'model' && job.itemIds?.[0]) {
      const p = useProjectsStore.getState().projects[projectId ?? '']
      const object = p?.objects.find((o) => o.id === job.itemIds?.[0])
      if (object) void handleGenerateModel(object)
    }
  }

  if (!project) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <EmptyState
          title="项目不存在或已被删除"
          description="请返回项目列表，或打开内置示例项目继续体验。"
          action={
            <>
              <Button onClick={() => navigate('/')}>返回项目列表</Button>
              <Button
                variant="outline"
                onClick={() => navigate(`/projects/${DEMO_PROJECT_ID}/workspace`)}
              >
                打开示例项目
              </Button>
            </>
          }
        />
      </div>
    )
  }

  if (marking) return <Outlet />

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
        <Toolbar
          project={project}
          onOpenOrganize={handleOpenOrganize}
          onPlanCables={() => void runPlanCables()}
          onSavePlan={handleSavePlan}
          onOpenPlans={handleOpenPlans}
          plansOpen={plansOpen}
          busy={busy}
          onToggleLeftPanel={() => { setRightOpen(false); setLeftOpen((v) => !v) }}
          onToggleRightPanel={() => { setLeftOpen(false); setRightOpen((v) => !v) }}
        />
      <div className="relative flex min-h-0 flex-1">
          <WorkspaceToolPanel
            project={project}
            issuesById={issuesById}
            routingConfirmed={routingConfirmed}
            onConfirmRouting={confirmRouting}
            busy={busy === 'cable'}
            onPlanCables={(ids) => void runPlanCables(ids)}
            onOpenMarking={() => openMarking()}
            onFlash={showFlash}
            onGenerateModel={(o) => void handleGenerateModel(o)}
            className="hidden w-[264px] shrink-0 border-r lg:flex"
          />
        <div className="relative min-w-0 flex-1">
          <Viewport
            project={project}
            issuesById={issuesById}
            onObjectContextMenu={(objectId, x, y) => setObjectMenu({ objectId, x, y })}
          />

            <div className="pointer-events-none absolute left-4 top-3 flex items-center gap-2">
              {project.isDemo ? <DataBadge kind="demo" label="示例项目" /> : null}
              <span className="rounded-full border border-border bg-surface/90 px-2.5 py-1 text-xs font-medium shadow-xs">
                {organizeOpen ? organizeStatus === 'planning' ? '生成中 · 原布局保留' : organizeStatus === 'config' ? '设置整理偏好' : '方案预览 · 尚未应用' : mode === 'organize' ? '编辑原布局' : '确认连接与走线'}
              </span>
            </div>
          {busy === 'cable' ? (
            <div className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-surface/90 px-3 py-1.5 text-xs shadow-sm">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              走线规划中（真实后端）…
            </div>
          ) : null}

            <>
              <div className="pointer-events-none absolute bottom-10 left-1/2 -translate-x-1/2">
                <DragHintChip />
              </div>

              <p className="pointer-events-none absolute bottom-3 left-4 right-4 hidden truncate text-center text-xs text-muted-foreground md:block">
                {mode === 'cable'
                  ? '右键物品进入描点页面 · 点击线缆查看 / 编辑属性 · 点击两个接口建立连接 · Esc 取消'
                  : '拖拽物品移动 · 空白处拖动旋转视角 · 滚轮缩放 · Q/E 旋转物品 · 右键物品描点'}
              </p>
              <p className="pointer-events-none absolute bottom-3 left-3 right-3 text-center text-[11px] text-muted-foreground md:hidden">
                单指旋转 · 双指缩放 · 顶部打开物品与属性
              </p>
            </>
        </div>

        {plansOpen ? (
          <PlanPanel
            project={project}
            onFlash={showFlash}
            className="hidden w-80 shrink-0 border-l xl:flex"
            onClose={() => setPlansOpen(false)}
          />
        ) : organizeOpen && panelVisible ? (
          <OrganizePanel
            project={project}
            onFlash={showFlash}
            onPreviewReady={() => setRightOpen(false)}
            onClose={() => useOrganizeStore.getState().hidePanel()}
            className="hidden w-72 shrink-0 border-l xl:flex"
          />
        ) : (
          <WorkspaceGuide
            project={project}
            routingConfirmed={routingConfirmed}
            onConfirmRouting={confirmRouting}
            busy={busy === 'cable'}
            onPlanCables={(ids) => void runPlanCables(ids)}
            onOpenOrganize={handleOpenOrganize}
            onGuide={() => navigate(`/projects/${project.id}/guide`)}
            className="hidden w-72 shrink-0 border-l xl:flex"
          />
        )}
      </div>

        <StatusBar
          project={project}
          flash={flash}
          issuesById={issuesById}
          onRetryJob={handleRetryJob}
        />

      {/* 物品右键菜单：唯一入口是进入描点页面，不在一般模式里展示描点控件 */}
      {objectMenu ? (
        <ObjectContextMenu
          x={objectMenu.x}
          y={objectMenu.y}
          title={project.objects.find((o) => o.id === objectMenu.objectId)?.name}
          items={[
            {
              label: '表面描点',
              hint: '进入描点页面标记接口',
              onSelect: () => openMarking(objectMenu.objectId),
            },
          ]}
          onClose={() => setObjectMenu(null)}
        />
      ) : null}

      {/* 小屏幕抽屉：侧面板收进抽屉，保留主要操作 */}
      <Drawer
        open={leftOpen}
        side="left"
        onClose={() => setLeftOpen(false)}
        className="w-80 max-w-[90vw]"
      >
        <WorkspaceToolPanel
            project={project}
            issuesById={issuesById}
            routingConfirmed={routingConfirmed}
            onConfirmRouting={confirmRouting}
            busy={busy === 'cable'}
            onPlanCables={(ids) => void runPlanCables(ids)}
            onOpenMarking={() => openMarking()}
            onFlash={showFlash}
            onGenerateModel={(o) => void handleGenerateModel(o)}
            className="h-full w-full border-r"
            onClose={() => setLeftOpen(false)}
          />
      </Drawer>
      <Drawer
        open={rightOpen}
        side="right"
        onClose={() => {
          if (!useOrganizeStore.getState().applying) setRightOpen(false)
        }}
        className="w-80 max-w-[85vw]"
      >
        {plansOpen ? (
          <PlanPanel
            project={project}
            onFlash={showFlash}
            className="h-full w-full border-l"
            onClose={() => {
              setPlansOpen(false)
              setRightOpen(false)
            }}
          />
        ) : organizeOpen && panelVisible ? (
          <OrganizePanel
            project={project}
            onFlash={showFlash}
            onPreviewReady={() => setRightOpen(false)}
            className="h-full w-full border-l"
            onClose={() => {
              useOrganizeStore.getState().hidePanel()
              setRightOpen(false)
            }}
          />
        ) : (
          <WorkspaceGuide
            project={project}
            routingConfirmed={routingConfirmed}
            onConfirmRouting={confirmRouting}
            busy={busy === 'cable'}
            onPlanCables={(ids) => void runPlanCables(ids)}
            onOpenOrganize={handleOpenOrganize}
            onGuide={() => navigate(`/projects/${project.id}/guide`)}
            className="h-full w-full border-l"
            onClose={() => setRightOpen(false)}
          />
        )}
      </Drawer>

      {/* 演示导览卡片（仅激活时渲染；bottom-14 避开底部状态栏） */}
      <DemoTour className="bottom-14" />
    </div>
  )
}
