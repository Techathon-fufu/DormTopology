import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Clock3,
  Loader2,
  RotateCcw,
  XCircle,
} from 'lucide-react'
import type { GenerationJob, JobStatus } from '@/types/project'
import { Badge } from '@/ui/kit/badge'
import { Button } from '@/ui/kit/button'
import { Progress } from '@/ui/kit/primitives'
import { DataBadge } from '@/ui/kit/data-badge'
import { cn, formatDateTime } from '@/lib/utils'

const STATUS_META: Record<
  JobStatus,
  { label: string; variant: 'default' | 'outline' | 'success' | 'warning' | 'danger' | 'primary' }
> = {
  queued: { label: '排队中', variant: 'outline' },
  waiting: { label: '等待中', variant: 'outline' },
  running: { label: '进行中', variant: 'primary' },
  awaiting: { label: '待确认', variant: 'warning' },
  success: { label: '成功', variant: 'success' },
  failed: { label: '失败', variant: 'danger' },
  partial: { label: '部分成功', variant: 'warning' },
  canceled: { label: '已取消', variant: 'default' },
}

export function JobStatusIcon({ status, className }: { status: JobStatus; className?: string }) {
  const cls = cn('h-3.5 w-3.5', className)
  switch (status) {
    case 'running':
      return <Loader2 className={cn(cls, 'animate-spin')} />
    case 'awaiting':
      return <Clock3 className={cls} />
    case 'success':
      return <CheckCircle2 className={cls} />
    case 'failed':
      return <XCircle className={cls} />
    case 'partial':
      return <AlertTriangle className={cls} />
    default:
      return <CircleDashed className={cls} />
  }
}

export function JobStatusBadge({ status }: { status: JobStatus }) {
  const meta = STATUS_META[status]
  return (
    <Badge variant={meta.variant}>
      <JobStatusIcon status={status} />
      {meta.label}
    </Badge>
  )
}

const ACTIVE_STATUSES: JobStatus[] = ['queued', 'waiting', 'running']

/** 长耗时任务列表：等待 / 进行中 / 待确认 / 失败重试 / 部分成功 */
export function JobList({
  jobs,
  onRetry,
  className,
  compact,
}: {
  jobs: GenerationJob[]
  onRetry?: (job: GenerationJob) => void
  className?: string
  compact?: boolean
}) {
  if (jobs.length === 0) {
    return (
      <p className={cn('text-[13px] text-faint', className)}>暂无任务。识别、生成与规划任务会显示在这里。</p>
    )
  }

  return (
    <ul className={cn('flex flex-col gap-2', className)}>
      {jobs.map((job) => {
        const active = ACTIVE_STATUSES.includes(job.status)
        return (
          <li key={job.id} className="rounded-md border border-border bg-surface px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{job.title}</span>
              {job.mock ? <DataBadge kind="mock" /> : null}
              <JobStatusBadge status={job.status} />
              {job.status === 'failed' && onRetry ? (
                <Button variant="outline" size="sm" onClick={() => onRetry(job)}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  重试
                </Button>
              ) : null}
            </div>

            {active ? (
              <div className="mt-2 flex items-center gap-2">
                {job.mock ? (
                  // 模拟任务没有真实进度：只显示阶段状态，不编造精确百分比
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full w-1/3 animate-pulse rounded-full bg-primary/70" />
                  </div>
                ) : (
                  <>
                    <Progress value={job.progress} className="flex-1" />
                    <span className="text-xs tabular-nums text-faint">
                      {Math.round(job.progress * 100)}%
                    </span>
                  </>
                )}
              </div>
            ) : null}

            {!compact && job.stageLabel && (active || job.status === 'awaiting') ? (
              <p className="mt-1 text-xs text-muted-foreground">阶段：{job.stageLabel}</p>
            ) : null}
            {job.status === 'awaiting' ? (
              <p className="mt-1 text-xs text-warning">等待你确认结果后才会继续。</p>
            ) : null}
            {job.error ? <p className="mt-1 text-xs text-danger">{job.error}</p> : null}
            {job.resultNote ? (
              <p className="mt-1 text-xs text-muted-foreground">{job.resultNote}</p>
            ) : null}
            <p className="mt-1 text-[11px] text-faint">{formatDateTime(job.updatedAt)}</p>
          </li>
        )
      })}
    </ul>
  )
}
