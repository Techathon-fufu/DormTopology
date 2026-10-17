import {
  Cable,
  CheckCircle2,
  GitCompareArrows,
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
import { Segmented } from '@/ui/kit/segmented'
import { useOrganizeStore } from '@/state/organizeStore'
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
  busy: 'cable' | null
  onToggleLeftPanel: () => void
  onToggleRightPanel: () => void
}

export function Toolbar({
  project,
  onOpenOrganize,
  onPlanCables,
  onSavePlan,
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

  return (
    <header className="z-30 border-b border-border bg-surface">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2">
        <Link to="/" className="flex items-center gap-2" title="返回项目列表">
          <LogoMark className="h-5 w-5" />
          <span className="text-sm font-semibold">寝空拓扑</span>
        </Link>
        <span className="text-faint">/</span>
        <span className="max-w-[180px] truncate text-sm font-medium" title={project.name}>
          {project.name}
        </span>
        {project.isDemo ? <DataBadge kind="demo" /> : null}
        <SaveStatus updatedAt={project.updatedAt} />
        <ProjectSteps projectId={project.id} current="workspace" className="hidden xl:flex" />

        <div className="mx-1 hidden h-6 w-px bg-border sm:block" />

        {/* 小屏抽屉入口 */}
        <div className="flex items-center gap-1 lg:hidden">
          <Button variant="ghost" size="icon" title="打开物品面板" onClick={onToggleLeftPanel}>
            <PanelLeft className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center gap-1 xl:hidden">
          <Button variant="ghost" size="icon" title="打开属性面板" onClick={onToggleRightPanel}>
            <PanelRight className="h-4 w-4" />
          </Button>
        </div>

        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'organize', label: '整理物品', icon: <LayoutGrid className="h-3.5 w-3.5" /> },
            {
              value: 'cable',
              label: '规划走线',
              icon: <Cable className="h-3.5 w-3.5" />,
              disabled: previewBlocking,
              title: previewBlocking
                ? '空间整理预览进行中：请先接受方案或恢复原布局'
                : '接口管理 / 路径节点 / 平滑曲线 / 障碍检查（规则式演示）',
            },
          ]}
        />

        <Segmented
          size="sm"
          value={viewPreset}
          onChange={(v) => setViewPreset(v as ViewPreset)}
          options={[
            { value: 'persp', label: '等距' },
            { value: 'top', label: '俯视' },
            { value: 'front', label: '正视' },
            { value: 'desk', label: '桌面' },
          ]}
        />

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            title="撤销（Ctrl+Z）"
            disabled={!canUndo}
            onClick={() => undo(project.id)}
          >
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="重做（Ctrl+Shift+Z）"
            disabled={!canRedo}
            onClick={() => redo(project.id)}
          >
            <Redo2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" title="重置视角（F）" onClick={resetView}>
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {mode === 'organize' ? (
            <span className="inline-flex items-center gap-1.5">
              <Button size="sm" onClick={onOpenOrganize} title="打开空间整理面板：分区归位与整理方案">
                <Wand2 className="h-3.5 w-3.5" />
                生成整理方案
              </Button>
              <DataBadge kind="computed" label="规则式演示" />
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <Button
                size="sm"
                disabled={busy !== null || project.cables.length === 0}
                title={
                  project.cables.length === 0
                    ? '暂无线缆：先在走线模式中点击两个接口建立连接'
                    : '规划全部走线：接口 → 路径节点（桌边 / 桌底 / 立柱 / 出线孔）→ 平滑曲线 → 障碍检查（规则式演示）'
                }
                onClick={onPlanCables}
              >
                {busy === 'cable' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Cable className="h-3.5 w-3.5" />
                )}
                规划走线{staleCount > 0 ? `（${staleCount} 条需重算）` : ''}
              </Button>
              <DataBadge kind="computed" label="规则式演示" />
            </span>
          )}
          <Button variant="outline" size="sm" onClick={onSavePlan} title="保存当前方案，供后续对比">
            <Save className="h-3.5 w-3.5" />
            保存方案
          </Button>
          {project.isDemo ? (
            <Button
              variant="outline"
              size="sm"
              title="打开 6 步演示导览（可重置并重播）"
              onClick={() => {
                const tour = useTourStore.getState()
                if (!tour.active) tour.start(project.id)
              }}
            >
              <Sparkles className="h-3.5 w-3.5" />
              演示导览
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            disabled
            title="方案对比将在后续阶段提供（已保存的方案会保留）"
          >
            <GitCompareArrows className="h-3.5 w-3.5" />
            方案对比
          </Button>
        </div>
      </div>
    </header>
  )
}
