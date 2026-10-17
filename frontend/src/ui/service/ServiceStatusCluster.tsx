import { useEffect, useRef, useState } from 'react'
import { ListChecks, RefreshCw } from 'lucide-react'
import {
  REMOTE_CAPABILITY_LABELS,
  cancelRemoteJob,
  isMockMode,
  refreshRemoteJob,
} from '@/api'
import {
  API_HEALTH_LABELS,
  runHealthCheck,
  useApiHealthStore,
  type ApiHealthStatus,
} from '@/state/apiHealthStore'
import {
  REMOTE_JOB_ACTIVE,
  useRemoteJobsStore,
  type RemoteJobRecord,
  type RemoteJobStatus,
} from '@/state/remoteJobsStore'
import { Button } from '@/ui/kit/button'
import { DataBadge } from '@/ui/kit/data-badge'
import { cn, formatDateTime } from '@/lib/utils'

/**
 * 服务状态集群：后端连接状态与长任务列表（可重查、取消、移除）。
 * 供应商模拟能力单独标记，整理与理线始终使用后端。
 */

const HEALTH_DOT: Record<ApiHealthStatus, string> = {
  unknown: 'bg-muted-foreground/60',
  checking: 'bg-muted-foreground/60 animate-pulse',
  ok: 'bg-success',
  degraded: 'bg-warning',
  down: 'bg-danger',
}

const STATUS_META: Record<RemoteJobStatus, { label: string; className: string }> = {
  queued: { label: '排队中', className: 'border-border bg-muted text-muted-foreground' },
  running: { label: '进行中', className: 'border-info/30 bg-info/10 text-info' },
  succeeded: { label: '已完成', className: 'border-success/30 bg-success/10 text-success' },
  failed: { label: '失败', className: 'border-danger/40 bg-danger/10 text-danger' },
  cancelled: { label: '已取消', className: 'border-border bg-muted text-muted-foreground' },
}

function StatusChip({ record }: { record: RemoteJobRecord }) {
  const meta = STATUS_META[record.status]
  const label =
    record.status === 'running' && record.progress !== undefined
      ? `进行中 ${Math.round(record.progress * 100)}%`
      : meta.label
  return (
    <span className={cn('rounded-full border px-1.5 py-0.5 text-[10px] leading-none', meta.className)}>
      {label}
    </span>
  )
}

function compactSummary(summary: Record<string, unknown>): string {
  return Object.entries(summary)
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ')
}

export function ServiceStatusCluster({
  placement = 'up',
  className,
}: {
  placement?: 'up' | 'down'
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const records = useRemoteJobsStore((s) => s.records)
  const removeRecord = useRemoteJobsStore((s) => s.remove)
  const clearFinished = useRemoteJobsStore((s) => s.clearFinished)
  const health = useApiHealthStore()

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const active = records.filter((r) => REMOTE_JOB_ACTIVE.includes(r.status))
  const failed = records.filter((r) => r.status === 'failed')

  const handleRefresh = (id: string) => {
    setActionError(null)
    void refreshRemoteJob(id).then((r) => {
      if (r?.lastQueryError) setActionError(`查询失败：${r.lastQueryError}`)
    })
  }

  const handleCancel = (id: string) => {
    setActionError(null)
    cancelRemoteJob(id).catch((err) => {
      setActionError(err instanceof Error ? err.message : String(err))
    })
  }

  return (
    <div ref={rootRef} className={cn('relative flex max-w-full flex-wrap items-center gap-2', className)}>
      <DataBadge kind="real" label="后端整理 / 理线" />
      {isMockMode ? <DataBadge kind="mock" label="识别 / 模型模拟" /> : null}
      <button
        type="button"
        className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground hover:text-foreground"
        title={
          health.detail
            ? `${API_HEALTH_LABELS[health.status]}：${health.detail}`
            : '后端连接状态（点击重新检测）'
        }
        onClick={() => void runHealthCheck()}
      >
        <span className={cn('h-1.5 w-1.5 rounded-full', HEALTH_DOT[health.status])} />
        {API_HEALTH_LABELS[health.status]}
      </button>
      <button
        type="button"
        className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground hover:text-foreground"
        title="后端服务任务（jobId 长任务状态；刷新页面后继续查询）"
        onClick={() => setOpen((v) => !v)}
      >
        <ListChecks className="h-3.5 w-3.5" />
        任务 {records.length}
        {active.length > 0 ? <span className="text-info"> · 进行中 {active.length}</span> : null}
        {failed.length > 0 ? <span className="text-danger"> · 失败 {failed.length}</span> : null}
      </button>

      {open ? (
        <div
          className={cn(
            'absolute right-0 z-50 max-h-96 w-80 overflow-y-auto rounded-lg border border-border bg-surface p-2 text-xs shadow-lg',
            placement === 'up' ? 'bottom-full mb-2' : 'top-full mt-2',
          )}
        >
          <div className="flex items-center justify-between px-1 pb-1.5">
            <span className="font-medium text-foreground">服务状态</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[11px]"
              onClick={() => void runHealthCheck()}
            >
              <RefreshCw className="h-3 w-3" />
              重新检测
            </Button>
          </div>

          <div className="space-y-1 rounded-md border border-border p-2">
            <div className="flex items-center gap-1.5">
              <span className={cn('h-1.5 w-1.5 rounded-full', HEALTH_DOT[health.status])} />
              <span className="font-medium">{API_HEALTH_LABELS[health.status]}</span>
              {health.backendVersion ? (
                <span className="text-faint">版本 {health.backendVersion}</span>
              ) : null}
              {health.checkedAt ? (
                <span className="ml-auto text-faint">{formatDateTime(health.checkedAt)}</span>
              ) : null}
            </div>
            {health.detail ? <p className="text-[11px] text-muted-foreground">{health.detail}</p> : null}
            {health.status === 'down' ? (
              <p className="text-[11px] text-muted-foreground">
                后端不可用，请检查服务部署与连接地址后重试。
              </p>
            ) : null}
          </div>

          {actionError ? (
            <p className="mt-2 rounded-md border border-danger/40 bg-danger/10 p-2 text-[11px] text-danger">
              {actionError}
            </p>
          ) : null}

          <ul className="mt-2 space-y-1.5">
            {records.length === 0 ? (
              <li className="px-1 py-2 text-[11px] text-faint">
                暂无后端任务。
              </li>
            ) : (
              records.map((r) => (
                <li key={r.id} className="space-y-1 rounded-md border border-border p-2">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-medium">{r.label}</span>
                    <StatusChip record={r} />
                    <span className="ml-auto shrink-0 text-[10px] text-faint">
                      {formatDateTime(r.submittedAt)}
                    </span>
                  </div>
                  {r.error ? <p className="text-[11px] text-danger">{r.error}</p> : null}
                  {r.lastQueryError ? (
                    <p className="text-[11px] text-warning">最近查询失败：{r.lastQueryError}（将自动重试）</p>
                  ) : null}
                  {!r.error && (r.stage || r.resultSummary) ? (
                    <p className="text-[11px] text-muted-foreground">
                      {[r.stage, r.resultSummary].filter(Boolean).join(' · ')}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-x-2 text-[10px] text-faint">
                    <span>任务号 {r.id.length > 12 ? `${r.id.slice(0, 12)}…` : r.id}</span>
                    <span>{REMOTE_CAPABILITY_LABELS[r.capability]}</span>
                    <span>算法 {r.algorithmVersion ?? '未提供'}</span>
                  </div>
                  {r.requestSummary && Object.keys(r.requestSummary).length > 0 ? (
                    <p className="truncate text-[10px] text-faint" title={JSON.stringify(r.requestSummary)}>
                      参数 {compactSummary(r.requestSummary)}
                    </p>
                  ) : null}
                  <div className="flex items-center gap-1 pt-0.5">
                    {REMOTE_JOB_ACTIVE.includes(r.status) || r.lastQueryError ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 px-2 text-[11px]"
                        onClick={() => handleRefresh(r.id)}
                      >
                        重查
                      </Button>
                    ) : null}
                    {REMOTE_JOB_ACTIVE.includes(r.status) ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[11px] text-danger"
                        onClick={() => handleCancel(r.id)}
                      >
                        取消
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[11px]"
                      onClick={() => removeRecord(r.id)}
                    >
                      移除
                    </Button>
                  </div>
                </li>
              ))
            )}
          </ul>

          {records.length > 0 ? (
            <div className="mt-2 flex items-center justify-between">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px]"
                onClick={() => clearFinished()}
              >
                清除已结束
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
