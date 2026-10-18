import { AlertTriangle, ChevronUp, Loader2 } from 'lucide-react'
import type { GenerationJob, Project } from '@/types/project'
import { formatMeters } from '@/lib/units'
import type { SceneIssue } from '@/scene/sceneValidation'
import { totalCablePathLength } from '@/scene/cableGeometry'
import { useProjectJobs } from '@/state/jobsStore'
import { useOrganizeStore } from '@/state/organizeStore'
import { useWorkspaceStore } from '@/state/workspaceStore'
import { Button } from '@/ui/kit/button'
import { FastForwardToggle } from '@/ui/kit/fast-forward'
import { ServiceStatusCluster } from '@/ui/service/ServiceStatusCluster'

/**
 * 底部任务状态区：模式提示 / 任务阶段 / 失败重试 / 模型状态汇总 / 位置校验警示 / 物品与线缆计数。
 * 模拟任务只显示阶段（不确定进度条），不伪造百分比。
 */
export function StatusBar({
  project,
  flash,
  issuesById,
  onRetryJob,
}: {
  project: Project
  flash: string | null
  issuesById: Map<string, SceneIssue[]>
  onRetryJob: (job: GenerationJob) => void
}) {
  const preview = useOrganizeStore((s) => s.plan !== null)
  const mode = useWorkspaceStore((s) => s.mode)
  const lastScore = useWorkspaceStore((s) => s.lastScore)
  const select = useWorkspaceStore((s) => s.select)
  const jobs = useProjectJobs(project.id)

  const active = jobs.filter((j) => ['queued', 'waiting', 'running', 'awaiting'].includes(j.status))
  const failed = jobs.filter((j) => j.status === 'failed' || j.status === 'partial')
  const awaitingCount = active.filter((j) => j.status === 'awaiting').length
  // Prefer verified curve lengths; incomplete route totals remain unknown.
  const totalCable = totalCablePathLength(project.cables, project.objects)
  const staleCableCount = project.cables.filter((c) => c.status === 'stale' || (c.planSource === 'demo-rule' && c.status !== 'conflict')).length
  const conflictCableCount = project.cables.filter((c) => c.status === 'conflict').length
  const activeJobIsMock = active[0]?.mock ?? false

  const modelCounts = { none: 0, generating: 0, placeholder: 0, ready: 0, failed: 0 }
  for (const o of project.objects) modelCounts[o.model.status] += 1

  const issueCount = issuesById.size
  const firstIssueId = issuesById.keys().next().value as string | undefined

  return (
    <footer aria-label="工作台状态" className="relative z-30 flex h-10 shrink-0 items-center gap-3 border-t border-border bg-surface px-4 text-xs text-muted-foreground">
      <span className="inline-flex shrink-0 items-center gap-1.5">
        <span className="font-medium text-foreground">
          {mode === 'organize' ? '整理物品' : '规划走线'}
        </span>
        <span className="inline">
          {mode === 'organize'
            ? '真实后端整理 · 本地保存'
            : '真实后端走线'}
        </span>
      </span>

      <span role="status" className="min-w-0 flex-1 truncate font-medium text-primary" title={flash ?? undefined}>{flash ?? (preview ? '预览尚未应用 · 原布局保留' : '布局已保存至本机')}</span>

      {issueCount > 0 ? <button type="button" className="inline-flex shrink-0 items-center gap-1 text-warning" title="定位到第一个有警示的物品" onClick={() => { if (firstIssueId) select(firstIssueId) }}><AlertTriangle className="h-3.5 w-3.5" />{preview ? '原布局' : '警示'} {issueCount} 件</button> : null}
      <span className="shrink-0 tabular-nums">物品 {project.objects.length} · 线缆 {project.cables.length}</span>
      <details className="group shrink-0">
        <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-lg px-2 hover:bg-muted [&::-webkit-details-marker]:hidden">
          {active.length > 0 ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> : null}
          <span className={failed.length > 0 ? 'text-danger' : ''}>{failed.length > 0 ? `${failed.length} 个任务待处理` : active.length > 0 ? `${active.length} 个任务进行中` : '服务与任务'}</span>
          <ChevronUp className="h-3.5 w-3.5 group-open:rotate-180" />
        </summary>
        <div className="absolute bottom-full right-2 mb-2 max-h-[65vh] w-[360px] max-w-[calc(100vw-16px)] space-y-4 overflow-y-auto rounded-xl border border-border bg-surface p-4 shadow-overlay">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <ServiceStatusCluster placement="up" />
        {active.length > 0 ? (
          <span className="inline-flex min-w-0 max-w-full items-center gap-2">
            <span className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-muted">
              {activeJobIsMock ? (
                <span className="block h-full w-1/3 animate-pulse rounded-full bg-primary" />
              ) : (
                <span
                  className="block h-full rounded-full bg-primary transition-all"
                  style={{ width: `${Math.round(active[0].progress * 100)}%` }}
                />
              )}
            </span>
            <span className="truncate">
              {active[0].title}
              {active[0].stageLabel ? ` · ${active[0].stageLabel}` : ''}
              {awaitingCount > 0 ? ` · ${awaitingCount} 待确认` : ''}
              {active.length > 1 ? ` +${active.length - 1}` : ''}
            </span>
            {activeJobIsMock ? <FastForwardToggle compact /> : null}
          </span>
        ) : null}
        {failed.length > 0 ? (
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="whitespace-nowrap text-danger">{failed.length} 个任务未完成</span>
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[11px]"
              onClick={() => onRetryJob(failed[0])}
            >
              重试
            </Button>
          </span>
        ) : null}
      </div>

      <p className="tabular-nums" title="模型状态汇总（完成 / 占位 / 生成中 / 失败 / 未生成）">
        模型 完成 {modelCounts.ready} · 占位 {modelCounts.placeholder}
        {modelCounts.generating > 0 ? ` · 生成中 ${modelCounts.generating}` : ''}
        {modelCounts.failed > 0 ? ` · 失败 ${modelCounts.failed}` : ''}
        {modelCounts.none > 0 ? ` · 未生成 ${modelCounts.none}` : ''}
      </p>

      {issueCount > 0 ? (
        <button
          type="button"
          className="inline-flex items-center gap-1 tabular-nums text-warning hover:underline"
          title="点击定位到第一个有警示的物品；红色线框表示越界或与其它物品相交"
          onClick={() => {
            if (firstIssueId) select(firstIssueId)
          }}
        >
          <AlertTriangle className="h-3 w-3" />
          {preview ? '原布局警示' : '校验警示'} {issueCount} 件
        </button>
      ) : null}

      <p className="tabular-nums">物品 {project.objects.length}</p>
      <p
        className="tabular-nums"
        title="后端路径采用已验证曲线长度；历史或手动路径采用本地采样估算。有失败或待重算路径时总长未知。"
      >
        线缆 {project.cables.length} · {totalCable === null ? '总长未知' : `约 ${formatMeters(totalCable)}`}
        {staleCableCount > 0 ? (
          <span className="text-warning"> · 需重算 {staleCableCount}</span>
        ) : null}
        {conflictCableCount > 0 ? (
          <span className="text-danger"> · 障碍 {conflictCableCount}</span>
        ) : null}
      </p>
      {lastScore !== null ? (
        <span className="tabular-nums text-primary">整理度 {lastScore}（模拟评估）</span>
      ) : null}
        </div>
      </details>
    </footer>
  )
}
