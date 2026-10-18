import { Dropdown } from '@/ui/kit/dropdown'
import { CheckCircle2, Eye, EyeOff, History, Loader2, MoreHorizontal, Redo2, RotateCcw, Save, Settings2, Undo2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Project } from '@/types/project'
import { LogoMark } from '@/ui/brand/LogoMark'
import { Button } from '@/ui/kit/button'
import { Select } from '@/ui/kit/primitives'
import { ThemeToggle } from '@/ui/theme/ThemeToggle'
import { useDeskModelStore } from '@/state/deskModelStore'
import { useOrganizeStore } from '@/state/organizeStore'
import { useWorkspaceStore, type ViewPreset } from '@/state/workspaceStore'

function SaveStatus({ updatedAt }: { updatedAt: number }) {
  const editing = useWorkspaceStore((s) => s.drag !== null)
  return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title="改动会自动保存到本机">
    {editing ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3 text-success" />}
    {editing ? '调整中' : `已保存 ${new Date(updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`}
  </span>
}

interface ToolbarProps {
  project: Project
  onSavePlan: () => void
  onOpenPlans: () => void
  plansOpen: boolean
}

export function Toolbar({ project, onSavePlan, onOpenPlans, plansOpen }: ToolbarProps) {
  const viewPreset = useWorkspaceStore((s) => s.viewPreset)
  const setViewPreset = useWorkspaceStore((s) => s.setViewPreset)
  const resetView = useWorkspaceStore((s) => s.resetView)
  const undo = useWorkspaceStore((s) => s.undo)
  const redo = useWorkspaceStore((s) => s.redo)
  const canUndo = useWorkspaceStore((s) => s.past.length > 0)
  const canRedo = useWorkspaceStore((s) => s.future.length > 0)
  const previewBlocking = useOrganizeStore((s) => s.isPreviewBlocking())
  const showDesk = useDeskModelStore((s) => s.showDesk)
  const setShowDesk = useDeskModelStore((s) => s.setShowDesk)

  return <header className="relative z-30 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-5">
    <Link to="/" className="flex shrink-0 items-center gap-2" title="返回项目列表" aria-label="返回项目列表">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-soft"><LogoMark className="h-5 w-5" /></span>
      <span className="text-sm font-semibold">寝空拓扑</span>
    </Link>
    <span className="text-border">/</span>
    <div className="min-w-0 flex-1">
      <p className="max-w-[320px] truncate text-sm font-semibold" title={project.name}>{project.name}</p>
      {previewBlocking ? <span className="text-xs text-primary">预览中，原布局已保留</span> : <SaveStatus updatedAt={project.updatedAt} />}
    </div>
    <Button variant="ghost" size="icon" title="撤销（Ctrl+Z）" aria-label="撤销" disabled={!canUndo || previewBlocking} onClick={() => undo(project.id)}><Undo2 className="h-4 w-4" /></Button>
    <Button variant="ghost" size="icon" title="重做（Ctrl+Shift+Z）" aria-label="重做" disabled={!canRedo || previewBlocking} onClick={() => redo(project.id)}><Redo2 className="h-4 w-4" /></Button>
    <Select aria-label="场景视角" value={viewPreset} onChange={(e) => setViewPreset(e.target.value as ViewPreset)} className="h-9 w-28 bg-background/60">
      <option value="persp">透视</option><option value="top">俯视</option><option value="front">正面</option><option value="desk">桌面</option>
    </Select>
    <ThemeToggle />
    <Dropdown className="group relative">
      <summary className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted [&::-webkit-details-marker]:hidden" aria-label="更多操作" title="更多操作"><MoreHorizontal className="h-5 w-5" /></summary>
      <div className="absolute right-0 top-11 z-50 flex w-52 flex-col gap-1 rounded-xl border border-border bg-surface p-2 shadow-overlay">
        <Link className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm hover:bg-muted" to={`/projects/${encodeURIComponent(project.id)}/setup`}><Settings2 className="h-4 w-4" />空间设置</Link>
        <Button variant="ghost" size="sm" className="justify-start" disabled={previewBlocking} onClick={onSavePlan}><Save className="h-4 w-4" />保存当前方案</Button>
        <Button variant="ghost" size="sm" className="justify-start" onClick={onOpenPlans}><History className="h-4 w-4" />{plansOpen ? '关闭历史方案' : '历史方案'}</Button>
        <Button variant="ghost" size="sm" className="justify-start" onClick={resetView}><RotateCcw className="h-4 w-4" />重置视角 · F</Button>
        <Button variant="ghost" size="sm" className="justify-start" onClick={() => setShowDesk(!showDesk)}>{showDesk ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}{showDesk ? '隐藏桌体' : '显示桌体'}</Button>
      </div>
    </Dropdown>
  </header>
}
