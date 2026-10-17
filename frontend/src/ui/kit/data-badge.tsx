import { cn } from '@/lib/utils'

export type DataKind = 'demo' | 'mock' | 'computed' | 'unavailable' | 'real'

const META: Record<DataKind, { label: string; className: string; title: string }> = {
  demo: {
    label: '演示数据',
    className: 'border-warning/40 bg-warning/10 text-warning',
    title: '该内容来自内置示例项目，非真实数据',
  },
  mock: {
    label: '模拟',
    className: 'border-border bg-muted text-muted-foreground',
    title: '该结果由本地模拟服务生成（VITE_API_MODE=mock）',
  },
  computed: {
    label: '计算值',
    className: 'border-info/30 bg-info/10 text-info',
    title: '由本地算法真实计算得出（如长度估算、整理度评分）',
  },
  unavailable: {
    label: '未接入',
    className: 'border-dashed border-faint/70 bg-transparent text-faint',
    title: '该能力尚未接入后端服务，当前不可用',
  },
  real: {
    label: '真实服务',
    className: 'border-success/30 bg-success/10 text-success',
    title: '数据来自应用后端（VITE_API_MODE=real），已通过前端本地校验',
  },
}

/**
 * 数据来源徽标：强制区分 演示数据 / 模拟结果 / 本地计算值 / 未接入能力。
 * 任何来自 mock 或示例数据的内容都应在界面上就地标注。
 */
export function DataBadge({
  kind,
  label,
  className,
}: {
  kind: DataKind
  label?: string
  className?: string
}) {
  const meta = META[kind]
  return (
    <span
      title={meta.title}
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium leading-none',
        meta.className,
        className,
      )}
    >
      {label ?? meta.label}
    </span>
  )
}
