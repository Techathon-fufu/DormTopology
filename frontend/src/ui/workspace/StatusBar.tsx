import { AlertTriangle } from 'lucide-react'
import type { GenerationJob, Project } from '@/types/project'
import { formatMeters } from '@/lib/units'
import type { SceneIssue } from '@/scene/sceneValidation'
import { cableDisplayPoints } from '@/scene/cables'
import { estimateCableLength } from '@/scene/cableRoute'
import { isMockMode } from '@/api'
import { useProjectJobs } from '@/state/jobsStore'
import { useOrganizeStore } from '@/state/organizeStore'
import { useWorkspaceStore } from '@/state/workspaceStore'
import { Button } from '@/ui/kit/button'
import { FastForwardToggle } from '@/ui/kit/fast-forward'
import { ServiceStatusCluster } from '@/ui/service/ServiceStatusCluster'
import { SwitchToDemoButton } from '@/ui/service/SwitchToDemoButton'

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
  // 线缆总长：按「端点到接口贴合后的平滑路径」实时估算（本地计算值）
  const totalCable = project.cables.reduce(
    (sum, c) => sum + estimateCableLength(cableDisplayPoints(c, project.objects, 'suggested')),
    0,
  )
  const staleCableCount = project.cables.filter((c) => c.status === 'stale').length
  const conflictCableCount = project.cables.filter((c) => c.status === 'conflict').length
  const mock = isMockMode

  const modelCounts = { none: 0, generating: 0, placeholder: 0, ready: 0, failed: 0 }
  for (const o of project.objects) modelCounts[o.model.status] += 1

  const issueCount = issuesById.size
  const firstIssueId = issuesById.keys().next().value as string | undefined

  return (
    <footer className="z-30 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border bg-surface px-4 py-1.5 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <span className="font-medium text-foreground">
          {mode === 'organize' ? '整理物品' : '规划走线'}
        </span>
        <span className="hidden xl:inline">
          {mode === 'organize'
            ? '规则式演示 · 本地保存'
            : '规则式演示 · 结果需核查'}
        </span>
      </span>

      {flash ? <span className="font-medium text-primary">{flash}</span> : null}

      <span className="ml-auto inline-flex items-center gap-3">
        <ServiceStatusCluster placement="up" />
        {active.length > 0 ? (
          <span className="inline-flex items-center gap-2">
            <span className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
              {mock ? (
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
            {mock ? <FastForwardToggle compact /> : null}
          </span>
        ) : null}
        {failed.length > 0 ? (
          <span className="inline-flex items-center gap-2">
            <span className="text-danger">{failed.length} 个任务未完成</span>
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[11px]"
              onClick={() => onRetryJob(failed[0])}
            >
              重试
            </Button>
            <SwitchToDemoButton />
          </span>
        ) : null}
      </span>

      <span className="tabular-nums" title="模型状态汇总（完成 / 占位 / 生成中 / 失败 / 未生成）">
        模型 完成 {modelCounts.ready} · 占位 {modelCounts.placeholder}
        {modelCounts.generating > 0 ? ` · 生成中 ${modelCounts.generating}` : ''}
        {modelCounts.failed > 0 ? ` · 失败 ${modelCounts.failed}` : ''}
        {modelCounts.none > 0 ? ` · 未生成 ${modelCounts.none}` : ''}
      </span>

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

      <span className="tabular-nums">物品 {project.objects.length}</span>
      <span
        className="tabular-nums"
        title="线缆总长为按当前路径（端点贴合接口后平滑采样）的实时估算，本地计算值"
      >
        线缆 {project.cables.length} · 约 {formatMeters(totalCable)}
        {staleCableCount > 0 ? (
          <span className="text-warning"> · 需重算 {staleCableCount}</span>
        ) : null}
        {conflictCableCount > 0 ? (
          <span className="text-danger"> · 障碍 {conflictCableCount}</span>
        ) : null}
      </span>
      {lastScore !== null ? (
        <span className="tabular-nums text-primary">整理度 {lastScore}（模拟评估）</span>
      ) : null}
    </footer>
  )
}
