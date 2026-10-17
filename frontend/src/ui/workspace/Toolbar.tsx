import { Dropdown } from '@/ui/kit/dropdown'
import {
  Cable,
  CheckCircle2,
  Eye,
  EyeOff,
  GitCompareArrows,
  MoreHorizontal,
  ChevronDown,
  LayoutGrid,
  Loader2,
  PanelLeft,
  PanelRight,
  Redo2,
  RotateCcw,
  Save,
  Sparkles,
  Undo2,
  Wand2,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Project } from '@/types/project'
import { LogoMark } from '@/ui/brand/LogoMark'
import { ProjectSteps } from '@/ui/layout/ProjectSteps'
import { Button } from '@/ui/kit/button'
import { DataBadge } from '@/ui/kit/data-badge'
import { Select } from '@/ui/kit/primitives'
import { Segmented } from '@/ui/kit/segmented'
import { useDeskModelStore } from '@/state/deskModelStore'
import { useOrganizeStore } from '@/state/organizeStore'
import { usePlansStore } from '@/state/plansStore'
import { useTourStore } from '@/state/tourStore'
import { useWorkspaceStore, type ViewPreset } from '@/state/workspaceStore'

/** 保存状态：所有改动自动写入本地存储（zustand persist）；拖拽过程中提示调整中 */
function SaveStatus({ updatedAt }: { updatedAt: number }) {
  const editing = useWorkspaceStore((s) => s.drag !== null)
  if (editing) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin text-primary" />
        调整中，松开后自动保存
      </span>
    )
  }
  const time = new Date(updatedAt).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground"
      title="布局与属性编辑会自动保存到本机（刷新页面后恢复）"
    >
      <CheckCircle2 className="h-3 w-3 text-success" />
      已自动保存 · {time}
    </span>
  )
}

interface ToolbarProps {
  project: Project
  onOpenOrganize: () => void
  onPlanCables: () => void
  onSavePlan: () => void
  onOpenPlans: () => void
  plansOpen: boolean
  busy: 'cable' | null
  onToggleLeftPanel: () => void
  onToggleRightPanel: () => void
}

export function Toolbar({
  project,
  onOpenOrganize,
  onPlanCables,
  onSavePlan,
  onOpenPlans,
  plansOpen,
  busy,
  onToggleLeftPanel,
  onToggleRightPanel,
}: ToolbarProps) {
  const mode = useWorkspaceStore((s) => s.mode)
  const setMode = useWorkspaceStore((s) => s.setMode)
  const viewPreset = useWorkspaceStore((s) => s.viewPreset)
  const setViewPreset = useWorkspaceStore((s) => s.setViewPreset)
  const resetView = useWorkspaceStore((s) => s.resetView)
  const undo = useWorkspaceStore((s) => s.undo)
  const redo = useWorkspaceStore((s) => s.redo)
  const canUndo = useWorkspaceStore((s) => s.past.length > 0)
  const canRedo = useWorkspaceStore((s) => s.future.length > 0)
  /** 空间整理预览 / 动画进行中：禁止切到走线模式（避免两种会话状态互相干扰） */
  const previewBlocking = useOrganizeStore((s) => s.isPreviewBlocking())
  const staleCount = project.cables.filter((c) => c.status === 'stale').length
  const showDesk = useDeskModelStore((s) => s.showDesk)
  const setShowDesk = useDeskModelStore((s) => s.setShowDesk)
  const candidateCount = usePlansStore((s) => (s.candidates[project.id] ?? []).length)

  return (
    <header className="relative z-30 shrink-0 border-b border-border bg-surface">
      <div className="flex h-14 min-w-0 items-center gap-3 border-b border-border/60 px-3 sm:px-5">
        <Link to="/" className="flex shrink-0 items-center gap-2" title="返回项目列表">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-soft"><LogoMark className="h-5 w-5" /></span>
          <span className="hidden text-sm font-semibold sm:inline">寝空拓扑</span>
        </Link>
        <span className="hidden text-border sm:inline">/</span>
        <div className="min-w-0 flex-1 xl:flex-none">
          <p className="truncate text-[13px] font-semibold sm:max-w-[220px]" title={project.name}>{project.name}</p>
          <div className="hidden sm:block">{previewBlocking ? <span className="text-[11px] text-primary">预览中 · 原布局保留</span> : <SaveStatus updatedAt={project.updatedAt} />}</div>
        </div>
        <ProjectSteps projectId={project.id} current="workspace" className="mx-auto hidden xl:flex" />
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {project.isDemo ? <DataBadge kind="demo" /> : null}
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="打开物品面板" title="打开物品面板" onClick={onToggleLeftPanel}><PanelLeft className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" className="xl:hidden" aria-label="打开属性面板" title="打开属性面板" onClick={onToggleRightPanel}><PanelRight className="h-4 w-4" /></Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-5">
        <Segmented value={mode} onChange={setMode} options={[
          { value: 'organize', label: '整理物品', icon: <LayoutGrid className="h-3.5 w-3.5" /> },
          { value: 'cable', label: '规划走线', icon: <Cable className="h-3.5 w-3.5" />, disabled: previewBlocking,
            title: previewBlocking ? '预览进行中，请先接受方案或取消预览' : '接口管理与路径规划' },
        ]} />
        <div className="hidden h-5 w-px bg-border md:block" />
        <div className="hidden items-center gap-0.5 md:flex">
          <Button variant="ghost" size="icon" title="撤销（Ctrl+Z）" aria-label="撤销" disabled={!canUndo || previewBlocking} onClick={() => undo(project.id)}><Undo2 className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" title="重做（Ctrl+Shift+Z）" aria-label="重做" disabled={!canRedo || previewBlocking} onClick={() => redo(project.id)}><Redo2 className="h-4 w-4" /></Button>
        </div>
        <Select aria-label="场景视角" value={viewPreset} onChange={(e) => setViewPreset(e.target.value as ViewPreset)} className="hidden h-9 w-28 bg-background/60 sm:block">
          <option value="persp">透视视角</option><option value="top">俯视视角</option><option value="front">正面视角</option><option value="desk">桌面视角</option>
        </Select>
        <div className="ml-auto flex items-center gap-2">
          {mode === 'organize' ? (
            <Button size="sm" onClick={onOpenOrganize} title="打开空间整理面板：分区归位与整理方案"><Wand2 className="h-4 w-4" /><span>{previewBlocking ? '查看整理方案' : '生成整理方案'}</span></Button>
          ) : (
            <Button size="sm" disabled={busy !== null || project.cables.length === 0} onClick={onPlanCables} title={project.cables.length === 0 ? '先点击两个接口建立连接' : '规划全部走线'}>
              {busy === 'cable' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cable className="h-4 w-4" />}
              {busy === 'cable' ? '规划中' : staleCount > 0 ? `更新走线 · ${staleCount}` : '规划全部走线'}
            </Button>
          )}
          <Button
            variant={plansOpen ? 'primary' : 'outline'}
            size="sm"
            title={
              candidateCount > 0
                ? `候选方案：查看列表与指标，最多选 3 个并排对比（已保存 ${candidateCount} 个）`
                : '候选方案：先点「保存方案」保存当前布局，再进入对比'
            }
            onClick={onOpenPlans}
          >
            <GitCompareArrows className="h-4 w-4" />
            方案对比{candidateCount > 0 ? `（${candidateCount}）` : ''}
          </Button>
          <Dropdown className="group relative">
            <summary className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted [&::-webkit-details-marker]:hidden" aria-label="更多操作" title="更多操作"><MoreHorizontal className="h-5 w-5" /></summary>
            <div className="absolute right-0 top-11 z-50 flex w-60 flex-col gap-1 rounded-xl border border-border bg-surface p-2 shadow-overlay">
              <p className="px-2 py-1 text-xs text-muted-foreground">项目与视图</p>
              <Button variant="ghost" className="justify-start" size="sm" disabled={previewBlocking} onClick={onSavePlan}><Save className="h-4 w-4" />保存当前方案</Button>
              {project.isDemo ? <Button variant="ghost" className="justify-start" size="sm" onClick={() => { const tour = useTourStore.getState(); if (!tour.active) tour.start(project.id) }}><Sparkles className="h-4 w-4" />演示导览</Button> : null}
              <Button variant="ghost" className="justify-start" size="sm" onClick={resetView}><RotateCcw className="h-4 w-4" />重置视角 · F</Button>
              <Button variant="ghost" className="justify-start" size="sm" onClick={() => setShowDesk(!showDesk)}>{showDesk ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}{showDesk ? '隐藏桌体' : '显示桌体'}</Button>
              <div className="my-1 h-px bg-border" />
              <label className="flex items-center gap-2 px-2 text-xs text-muted-foreground"><ChevronDown className="h-3 w-3" />场景视角</label>
              <Select aria-label="更多操作中的场景视角" value={viewPreset} onChange={(e) => setViewPreset(e.target.value as ViewPreset)}><option value="persp">透视</option><option value="top">俯视</option><option value="front">正面</option><option value="desk">桌面</option></Select>
              <div className="flex gap-1 md:hidden"><Button size="sm" variant="ghost" disabled={!canUndo || previewBlocking} onClick={() => undo(project.id)}><Undo2 className="h-4 w-4" />撤销</Button><Button size="sm" variant="ghost" disabled={!canRedo || previewBlocking} onClick={() => redo(project.id)}><Redo2 className="h-4 w-4" />重做</Button></div>
              <div className="mt-1 border-t border-border pt-2 xl:hidden"><ProjectSteps projectId={project.id} current="workspace" className="flex-wrap" /></div>
            </div>
          </Dropdown>
        </div>
      </div>
    </header>
  )
}
