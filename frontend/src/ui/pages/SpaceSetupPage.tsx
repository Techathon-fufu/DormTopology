import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Info,
  RotateCcw,
  XCircle,
} from 'lucide-react'
import { PageIntro } from '@/ui/layout/PageIntro'
import { ProjectSteps } from '@/ui/layout/ProjectSteps'
import { SpacePreview3D } from '@/ui/setup/SpacePreview3D'
import { Button } from '@/ui/kit/button'
import { EmptyState } from '@/ui/kit/empty-state'
import { Label } from '@/ui/kit/primitives'
import { MmInput } from '@/ui/kit/mm-input'
import {
  defaultOutletForm,
  demoSpaceForm,
  formToRoom,
  roomToForm,
  validateSpace,
  OUTLET_EDGE_MARGIN_MM,
  OUTLET_FIXED_Y_MM,
  type SpaceForm,
} from '@/ui/setup/spaceForm'
import {
  cablesAffectedByOutletMove,
  markCablesStaleByIds,
} from '@/scene/outletImpact'
import { mmToM, mToMm } from '@/lib/units'
import { cn } from '@/lib/utils'
import { useProject, useProjectsStore } from '@/state/projectsStore'

/** 毫米输入字段：统一 mm 后缀与提交换算（换算见 @/lib/units） */
function MmField({
  label,
  valueMm,
  onChangeMm,
  minMm,
  hint,
  disabled,
  className,
}: {
  label: string
  valueMm: number
  onChangeMm: (mm: number) => void
  minMm?: number
  hint?: string
  disabled?: boolean
  className?: string
}) {
  return (
    <div className={cn('space-y-1', className)}>
      <Label className={cn(disabled && 'opacity-50')}>{label}</Label>
      <MmInput
        label={label}
        value={mmToM(valueMm)}
        min={minMm}
        disabled={disabled}
        onChange={(m) => onChangeMm(Math.round(mToMm(m)))}
      />
      {hint ? <p className="text-xs text-faint">{hint}</p> : null}
    </div>
  )
}

function SectionCard({
  title,
  extra,
  children,
}: {
  title: string
  extra?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="space-y-4 rounded-xl border border-border bg-surface p-5 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {extra}
      </div>
      {children}
    </section>
  )
}

/** 空间配置页：床桌 / 房间 / 立柱 / 书架为固定模型；仅后墙插座左右位置可调节，实时同步三维预览 */
export function SpaceSetupPage() {
  const { id } = useParams<{ id: string }>()
  const project = useProject(id)
  const navigate = useNavigate()
  const update = useProjectsStore((s) => s.update)

  const [form, setForm] = useState<SpaceForm>(() =>
    project ? roomToForm(project.room) : demoSpaceForm(),
  )

  // 切换项目（或示例项目首次写入完成）时，用已保存的空间重置表单
  const projectId = project?.id
  useEffect(() => {
    if (projectId) {
      const p = useProjectsStore.getState().projects[projectId]
      if (p) setForm(roomToForm(p.room))
    }
  }, [projectId])

  const previewRoom = useMemo(() => formToRoom(form), [form])
  const issues = useMemo(() => validateSpace(form), [form])
  const errors = issues.filter((i) => i.level === 'error')
  const warnings = issues.filter((i) => i.level === 'warning')

  const dirty = useMemo(() => {
    if (!project) return false
    return JSON.stringify(form) !== JSON.stringify(roomToForm(project.room))
  }, [form, project])

  const savedOutlets = useMemo(
    () => (project ? roomToForm(project.room).outlets : []),
    [project],
  )

  /** 插座左右位置调整的影响：保存后这些线缆会标记「需要重新规划」（不删除路径） */
  const outletImpact = useMemo(() => {
    if (!project) return { movedCount: 0, cableIds: [] as string[] }
    const saved = new Map(savedOutlets.map((o) => [o.id, o]))
    const affected = new Set<string>()
    let movedCount = 0
    for (const o of form.outlets) {
      const before = saved.get(o.id)
      if (!before || (before.x === o.x && before.y === o.y)) continue
      movedCount += 1
      // 插座世界坐标：z 固定为 0.01（后墙贴面，与 formToRoom 一致）
      for (const id of cablesAffectedByOutletMove(project.cables, project.objects, o.id, [
        mmToM(before.x),
        mmToM(before.y),
        0.01,
      ])) {
        affected.add(id)
      }
    }
    return { movedCount, cableIds: [...affected] }
  }, [form.outlets, project, savedOutlets])

  if (!project) {
    return (
      <EmptyState
        title="项目不存在或已被删除"
        description="请返回项目列表，或打开内置示例项目继续体验。"
        action={<Button onClick={() => navigate('/')}>返回项目列表</Button>}
      />
    )
  }

  /** 固定模型：墙面仅一块「双插孔 ×2」面板，仅左右位置（X）可调 */
  const updateOutletX = (x: number) =>
    setForm((f) => ({ ...f, outlets: [{ ...(f.outlets[0] ?? defaultOutletForm()), x }] }))

  const revert = () => setForm(roomToForm(project.room))

  const save = () => {
    if (errors.length > 0) return
    const room = formToRoom(form)
    update(project.id, (p) => ({
      ...p,
      room,
      // 插座位置调整后：相关走线标记「需要重新规划」（保留路径，可在工作台一键重算）
      cables:
        outletImpact.cableIds.length > 0
          ? markCablesStaleByIds(p.cables, outletImpact.cableIds)
          : p.cables,
      // 已有物品的项目保持原进度，避免覆盖工作台阶段
      stage: p.objects.length > 0 ? p.stage : 'photos',
    }))
    navigate(`/projects/${project.id}/import`)
  }

  return (
    <div className="space-y-5">
      <PageIntro
        step="创建项目 · 1/2"
        title="为你的书桌，建立空间"
        description="空间配置"
      >
        <ProjectSteps projectId={project.id} current="setup" className="flex-wrap" />
      </PageIntro>

      {project.isDemo ? (
        <div className="flex items-start gap-2 rounded-lg border border-primary/25 bg-primary-soft/60 px-3 py-2 text-[13px] leading-relaxed">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p>
            当前是示例项目：保存会覆盖其空间配置，可在此调节后墙插座的左右位置。
          </p>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* ── 表单 ─────────────────────────────────────────────── */}
        <div className="space-y-4">
          <SectionCard title="后墙插座">
            <div className="space-y-2">
              <p className="text-[13px] text-muted-foreground">
                后墙插座为固定模型：一块面板 · 两个双插孔插座，仅可左右移动（x 以房间中心为 0），高度固定不可调；调整后保存会提示受影响的走线。
              </p>
              {form.outlets.slice(0, 1).map((o) => {
                const xMax = Math.max(0, Math.round(form.roomL / 2 - OUTLET_EDGE_MARGIN_MM))
                const sliderX = Math.min(Math.max(o.x, -xMax), xMax)
                return (
                  <div key={o.id} className="space-y-2 rounded-md border border-border/70 bg-muted/30 px-2 py-2">
                    <div className="flex flex-wrap items-end gap-2">
                      <span className="w-14 shrink-0 pb-2 text-[13px] text-muted-foreground">插座</span>
                      <MmField className="w-28" label="X（左右）" valueMm={o.x} onChangeMm={(v) => updateOutletX(v)} />
                      <span className="pb-2 text-[11px] text-faint">高度固定 {OUTLET_FIXED_Y_MM} mm（不可竖直移动）</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="shrink-0 text-xs text-faint">左右滑块</span>
                      <input
                        type="range"
                        min={-xMax}
                        max={xMax}
                        step={10}
                        value={sliderX}
                        aria-label={`插座左右位置（${-xMax}–${xMax} mm）`}
                        className="h-1.5 min-w-36 flex-1 cursor-pointer accent-[#0F9D8A]"
                        onChange={(e) => updateOutletX(Number(e.target.value))}
                      />
                      <span className="w-40 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                        当前位置：{o.x} mm（{o.x === 0 ? '居中' : o.x > 0 ? '中心右侧' : '中心左侧'}）
                      </span>
                    </div>
                    <p className="text-xs leading-relaxed text-faint">
                      仅可沿后墙左右移动（距墙面左右边缘 ≥ {OUTLET_EDGE_MARGIN_MM} mm）；高度固定 {OUTLET_FIXED_Y_MM} mm
                      （插座为一块「两个双插孔」面板）。
                    </p>
                  </div>
                )
              })}
              {outletImpact.movedCount > 0 ? (
                <p className="flex items-start gap-1.5 rounded-md bg-warning/10 px-2 py-1.5 text-[12px] leading-relaxed text-warning">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    插座位置已调整 {outletImpact.movedCount} 处：
                    {outletImpact.cableIds.length > 0
                      ? ` 保存后 ${outletImpact.cableIds.length} 条相关走线会标记「需要重新规划」（保留原路径，可在工作台一键重算）。`
                      : ' 当前没有线缆经过这些插座，保存后无需重算走线。'}
                  </span>
                </p>
              ) : null}
            </div>
          </SectionCard>
        </div>

        {/* ── 预览 / 校验 / 操作 ───────────────────────────────── */}
        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-xl border border-border bg-surface p-4 shadow-xs">
            <h2 className="mb-2 text-sm font-semibold">三维预览</h2>
            <SpacePreview3D room={previewRoom} />
            <p className="mt-2 text-xs leading-relaxed text-faint">
              固定 L 形床桌；线缆经后沿长槽进入桌下，不翻越背板顶沿。
            </p>
          </div>


          <div
            className={cn(
              'rounded-lg border p-4 shadow-sm',
              errors.length > 0
                ? 'border-danger/40 bg-danger/5'
                : warnings.length > 0
                  ? 'border-warning/40 bg-warning/5'
                  : 'border-border bg-surface',
            )}
          >
            <h2 className="mb-2 text-sm font-semibold">校验结果（范围与结构冲突）</h2>
            {issues.length === 0 ? (
              <p className="flex items-center gap-2 text-[13px] text-success">
                <CheckCircle2 className="h-4 w-4" />
                未发现数值越界或明显结构冲突
              </p>
            ) : (
              <ul className="space-y-1.5">
                {issues.map((issue) => (
                  <li
                    key={issue.id}
                    className={cn(
                      'flex items-start gap-2 text-[13px] leading-relaxed',
                      issue.level === 'error' ? 'text-danger' : 'text-warning',
                    )}
                  >
                    {issue.level === 'error' ? (
                      <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    )}
                    <span>{issue.message}</span>
                  </li>
                ))}
              </ul>
            )}
            {errors.length > 0 ? (
              <p className="mt-2 text-xs text-danger">存在 {errors.length} 项冲突，修正后才能保存。</p>
            ) : null}
          </div>

          {project.objects.length > 0 ? (
            <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning">
              该项目已有 {project.objects.length} 件物品：修改空间后物品位置可能不再合适，可在工作台打开「生成整理方案」重新摆放。
            </p>
          ) : null}

          <div className="flex flex-col gap-2">
            <Button size="lg" onClick={save} disabled={errors.length > 0}>
              {dirty ? '保存空间并前往照片导入' : '前往照片导入'}
              <ArrowRight className="h-4 w-4" />
            </Button>
            <Button variant="ghost" onClick={revert} disabled={!dirty}>
              <RotateCcw className="h-4 w-4" />
              撤销未保存改动
            </Button>
          </div>
        </aside>
      </div>
    </div>
  )
}
