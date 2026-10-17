import { useMemo } from 'react'
import {
  Box,
  Cable,
  FileCheck2,
  Layers3,
  Loader2,
  RefreshCw,
  Wand2,
  X,
} from 'lucide-react'
import type { Project } from '@/types/project'
import { hasUsableCableRoute } from '@/scene/cables'
import { useOrganizeStore } from '@/state/organizeStore'
import { useWorkspaceStore } from '@/state/workspaceStore'
import { Button } from '@/ui/kit/button'
import { Badge } from '@/ui/kit/badge'
import { cn } from '@/lib/utils'

const STEPS: { key: string; label: string }[] = [
  { key: 'object', label: '物体' },
  { key: 'organize', label: '整理' },
  { key: 'cable', label: '理线' },
  { key: 'guide', label: '指南' },
]

/**
 * 工作台右侧·引导面板：随工作模式（物体 / 整理 / 理线 / 指南）给出下一步操作。
 * 文案严格跟随已有数据来源：只提示「需重算」走线，不对几何走线做未经验证的断言；
 * 后端规划与历史未验证路径按数据来源区分。
 */
export function WorkspaceGuide({
  project,
  routingConfirmed,
  onConfirmRouting,
  busy,
  onPlanCables,
  onOpenOrganize,
  onGuide,
  onClose,
  className,
}: {
  project: Project
  routingConfirmed: boolean
  onConfirmRouting: (confirmed: boolean) => void
  busy: boolean
  onPlanCables: (ids?: string[]) => void
  onOpenOrganize: () => void
  onGuide: () => void
  onClose?: () => void
  className?: string
}) {
  const mode = useWorkspaceStore((s) => s.mode)
  const setMode = useWorkspaceStore((s) => s.setMode)
  const plan = useOrganizeStore((s) => s.plan)
  const status = useOrganizeStore((s) => s.status)
  // 会话预览 / 规划中会阻塞布局编辑
  const previewBlocking = useOrganizeStore((s) => s.isPreviewBlocking())

  const cables = project.cables
  const visible = project.objects.filter((o) => o.visible).length
  const plannedCount = useMemo(() => cables.filter(hasUsableCableRoute).length, [cables])
  const pendingCount = cables.length - plannedCount

  const staleIds = useMemo(
    () =>
      cables
        .filter((c) => c.status === 'stale' || (c.planSource === 'demo-rule' && c.status !== 'conflict'))
        .map((c) => c.id),
    [cables],
  )
  const conflictCount = cables.filter((c) => c.status === 'conflict').length

  // Selection belongs to the left tools; this panel follows the current task mode.
  const organizing = mode === 'organize'

  const canPlan = routingConfirmed && cables.length > 0 && !busy && !previewBlocking
  const canRecompute = canPlan && staleIds.length > 0

  return (
    <aside aria-label="引导与生成" className={cn('flex min-h-0 flex-col bg-surface', className)}>
      <header className="border-b border-border px-4 pb-3 pt-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">引导与生成</h2>
            <p className="mt-1 text-xs text-muted-foreground">从物体准备，到可执行的整理方案</p>
          </div>
          {onClose ? (
            <Button variant="ghost" size="icon" aria-label="关闭引导面板" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
        <ol className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground">
          {STEPS.map((step, i) => (
            <li key={step.key} className="flex items-center gap-1.5">
              <span className={(organizing ? step.key === 'organize' : step.key === 'cable') ? 'font-medium text-primary' : ''}>{step.label}</span>
              {i < STEPS.length - 1 ? <span aria-hidden className="text-faint">→</span> : null}
            </li>
          ))}
        </ol>
      </header>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        {organizing ? (
          <section className="space-y-3" aria-label="布局整理">
            <div>
              <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                <Layers3 className="h-4 w-4 text-primary" />
                布局整理
              </h3>
              <p className="mt-1 text-xs leading-6 text-muted-foreground">
                预览不会改动已保存布局；确认前可随时回退。先核对尺寸与位置，再开始整理。
              </p>
            </div>
            <Button
              size="sm"
              className="w-full"
              disabled={busy}
              title="确认整理偏好与原始位置"
              onClick={onOpenOrganize}
            >
              <Wand2 className="h-3.5 w-3.5" />
              {status === 'planning' ? '查看生成进度' : plan ? '继续查看方案' : '开始整理'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              disabled={previewBlocking || busy}
              onClick={() => setMode('cable')}
              title={previewBlocking ? '请先接受或取消整理预览' : '进入理线引导，使用左侧工具建立连接'}
            >
              <Cable className="h-3.5 w-3.5" />
              确认连接与走线
            </Button>
            {previewBlocking ? (
              <p className="flex items-center gap-1.5 text-[11px] text-warning">
                <Layers3 className="h-3.5 w-3.5" />
                {plan ? '预览已保留，请接受或取消后继续。' : '方案生成中，请完成或取消本次任务。'}
              </p>
            ) : null}
          </section>
        ) : (
          <section className="space-y-3" aria-label="连接与走线">
            <div>
              <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                <Cable className="h-4 w-4 text-primary" />
                确认连接与走线
              </h3>
              <p className="mt-1 text-xs leading-6 text-muted-foreground">
                使用左侧「设备与接口」建立连接，核对后规划走线。当前 {cables.length} 条线缆，{pendingCount} 条未规划或需复查。
              </p>
            </div>

            <label className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                className="mt-0.5 accent-[#0F9D8A]"
                checked={routingConfirmed}
                disabled={busy || previewBlocking}
                onChange={(event) => onConfirmRouting(event.target.checked)}
              />
              已核对尺寸、位置与接口
            </label>

            <Button
              size="sm"
              className="w-full"
              disabled={!canPlan}
              onClick={() => onPlanCables()}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
              {busy ? '规划走线中…' : '规划全部走线（真实后端）'}
            </Button>

            {staleIds.length > 0 ? (
              <Button
                size="sm"
                variant="outline"
                className="w-full border-warning/50 text-warning"
                disabled={!canRecompute}
                onClick={() => onPlanCables(staleIds)}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                更新 {staleIds.length} 条需重算走线
              </Button>
            ) : null}

            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              <Badge variant={plannedCount > 0 ? 'primary' : 'default'}>
                已规划走线 {plannedCount} 条
              </Badge>
              {conflictCount > 0 ? <Badge variant="warning">{conflictCount} 条未通过检查</Badge> : null}
              {staleIds.length > 0 ? <Badge variant="warning">{staleIds.length} 条需重算</Badge> : null}
            </div>

            <p className="text-[11px] leading-relaxed text-faint">
              未通过检查、需重算或历史未验证的路径会单独标注，失败路径不会作为有效连接。
            </p>
          </section>
        )}

        <section className="space-y-2 border-t border-border pt-4" aria-label="查看执行指南">
          <h3 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <FileCheck2 className="h-4 w-4" />
            执行指南
          </h3>
          <p className="text-xs leading-6 text-muted-foreground">
            基于已保存场景生成，不包含预览中的改动。
          </p>
          <Button size="sm" variant="outline" className="w-full" disabled={previewBlocking} onClick={onGuide}>
            <FileCheck2 className="h-3.5 w-3.5" />
            查看执行指南
          </Button>
        </section>
      </div>

      <footer className="space-y-1 border-t border-border px-4 py-3 text-[11px] leading-relaxed text-faint">
        <p className="flex items-center gap-1.5">
          <Box className="h-3.5 w-3.5" />
          已保存 {visible} 件可见物品 · {cables.length} 条线缆
        </p>
        <p>后端规划结果与历史路径来源会分别标注，请以下方状态为准。</p>
      </footer>
    </aside>
  )
}
