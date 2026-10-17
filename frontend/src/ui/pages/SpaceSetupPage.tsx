import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Info,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  XCircle,
} from 'lucide-react'
import { ProjectSteps } from '@/ui/layout/ProjectSteps'
import { SpacePreview3D } from '@/ui/setup/SpacePreview3D'
import { Button } from '@/ui/kit/button'
import { EmptyState } from '@/ui/kit/empty-state'
import { Label, Select } from '@/ui/kit/primitives'
import { MmInput } from '@/ui/kit/mm-input'
import {
  demoSpaceForm,
  formToRoom,
  newOutletForm,
  newPostForm,
  presetPosts,
  roomToForm,
  validateSpace,
  OUTLET_ADVICE_Y_MM,
  OUTLET_DEFAULT_Y_MM,
  OUTLET_WALL_MARGIN_MM,
  clampOutletY,
  type SpaceForm,
} from '@/ui/setup/spaceForm'
import {
  cablesAffectedByOutletMove,
  markCablesStaleByIds,
} from '@/scene/outletImpact'
import { mmToM, mToMm } from '@/lib/units'
import { cn } from '@/lib/utils'
import { useProject, useProjectsStore } from '@/state/projectsStore'

const MAX_POSTS = 6
const MAX_OUTLETS = 4

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
        value={mmToM(valueMm)}
        min={minMm}
        disabled={disabled}
        onChange={(m) => onChangeMm(Math.round(mToMm(m)))}
      />
      {hint ? <p className="text-[11px] text-faint">{hint}</p> : null}
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
    <section className="space-y-3 rounded-lg border border-border bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {extra}
      </div>
      {children}
    </section>
  )
}

/** 空间配置页：编辑桌面 / 房间 / 书架 / 立柱 / 出线孔 / 电源，实时同步简化三维预览 */
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

  /** 插座位置（X / 高度）调整的影响：保存后这些线缆会标记「需要重新规划」（不删除路径） */
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

  const patch = (p: Partial<SpaceForm>) => setForm((f) => ({ ...f, ...p }))

  const updatePost = (pid: string, p: Partial<SpaceForm['posts'][number]>) =>
    setForm((f) => ({ ...f, posts: f.posts.map((x) => (x.id === pid ? { ...x, ...p } : x)) }))
  const removePost = (pid: string) =>
    setForm((f) => ({ ...f, posts: f.posts.filter((x) => x.id !== pid) }))
  const addPost = () =>
    setForm((f) =>
      f.posts.length >= MAX_POSTS
        ? f
        : { ...f, posts: [...f.posts, newPostForm(f.deskW / 2 + 120, 70, f.posts[0]?.section ?? 40)] },
    )

  const updateOutlet = (oid: string, p: Partial<SpaceForm['outlets'][number]>) =>
    setForm((f) => ({ ...f, outlets: f.outlets.map((x) => (x.id === oid ? { ...x, ...p } : x)) }))
  const removeOutlet = (oid: string) =>
    setForm((f) => ({ ...f, outlets: f.outlets.filter((x) => x.id !== oid) }))
  const addOutlet = () =>
    setForm((f) => (f.outlets.length >= MAX_OUTLETS ? f : { ...f, outlets: [...f.outlets, newOutletForm()] }))

  const useDemoSpace = () => setForm(demoSpaceForm())
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">空间配置</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            填写宿舍与书桌尺寸，实时预览 → 保存后进入照片导入。表单单位：毫米（mm）；三维场景内部使用米。
          </p>
        </div>
        <ProjectSteps projectId={project.id} current="setup" className="hidden md:flex" />
      </div>

      {project.isDemo ? (
        <div className="flex items-start gap-2 rounded-lg border border-primary/25 bg-primary-soft/60 px-3 py-2 text-[13px] leading-relaxed">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p>
            当前是示例项目：保存会覆盖其空间配置，可随时点击「使用示例空间」恢复默认示例（桌面 1200 × 600 ×
            750 mm 等，均为可修改的示例值）。
          </p>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* ── 表单 ─────────────────────────────────────────────── */}
        <div className="space-y-4">
          <SectionCard
            title="① 桌面尺寸"
            extra={<span className="text-xs text-faint">单位 mm · 范围为常见尺寸，超出将被拦截</span>}
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <MmField label="桌面长度" minMm={0} valueMm={form.deskW} onChangeMm={(v) => patch({ deskW: v })} />
              <MmField label="桌面进深" minMm={0} valueMm={form.deskD} onChangeMm={(v) => patch({ deskD: v })} />
              <MmField label="桌面高度" minMm={0} valueMm={form.deskH} onChangeMm={(v) => patch({ deskH: v })} />
              <MmField label="桌板厚度" minMm={0} valueMm={form.deskT} onChangeMm={(v) => patch({ deskT: v })} />
            </div>
          </SectionCard>

          <SectionCard title="② 房间尺寸">
            <div className="grid gap-3 sm:grid-cols-3">
              <MmField label="房间长度（x 向）" minMm={0} valueMm={form.roomL} onChangeMm={(v) => patch({ roomL: v })} />
              <MmField label="房间进深（z 向）" minMm={0} valueMm={form.roomW} onChangeMm={(v) => patch({ roomW: v })} />
              <MmField label="层高" minMm={0} valueMm={form.roomH} onChangeMm={(v) => patch({ roomH: v })} />
            </div>
          </SectionCard>

          <SectionCard
            title="③ 书架分层"
            extra={
              <label className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  className="accent-[#0F9D8A]"
                  checked={form.shelfEnabled}
                  onChange={(e) => patch({ shelfEnabled: e.target.checked })}
                />
                配置书架（床板下搁板）
              </label>
            }
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label className={cn(!form.shelfEnabled && 'opacity-50')}>层数</Label>
                <Select
                  value={String(form.shelfLevels)}
                  disabled={!form.shelfEnabled}
                  onChange={(e) => patch({ shelfLevels: Number(e.target.value) })}
                >
                  <option value="1">1 层</option>
                  <option value="2">2 层</option>
                  <option value="3">3 层</option>
                </Select>
              </div>
              <MmField
                label="离桌高度（最下层）"
                minMm={0}
                disabled={!form.shelfEnabled}
                valueMm={form.shelfAbove}
                onChangeMm={(v) => patch({ shelfAbove: v })}
              />
              <MmField
                label="搁板深度"
                minMm={0}
                disabled={!form.shelfEnabled}
                valueMm={form.shelfDepth}
                onChangeMm={(v) => patch({ shelfDepth: v })}
              />
            </div>
            <p className="text-[11px] text-faint">
              校验参考示例床架下沿约 1580 mm：桌面高度 + 离桌高度 + 250 mm 取物空间不可超过该值。
            </p>
          </SectionCard>

          <SectionCard
            title="④ 立柱位置"
            extra={
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => patch({ posts: presetPosts('corners', form) })}>
                  四角布置（4 根）
                </Button>
                <Button variant="outline" size="sm" onClick={() => patch({ posts: presetPosts('wall', form) })}>
                  靠墙两根
                </Button>
              </div>
            }
          >
            <p className="text-[13px] text-muted-foreground">
              立柱中心坐标：x 以房间中心为 0（左负右正），z 为距后墙距离。立柱即床架支点，床架跨度会随之下开。
            </p>
            <div className="space-y-2">
              {form.posts.map((p, i) => (
                <div key={p.id} className="flex flex-wrap items-end gap-2 rounded-md border border-border/70 bg-muted/30 px-2 py-2">
                  <span className="w-14 shrink-0 pb-2 text-[13px] text-muted-foreground">立柱 {i + 1}</span>
                  <MmField className="w-28" label="X（左右）" valueMm={p.x} onChangeMm={(v) => updatePost(p.id, { x: v })} />
                  <MmField className="w-28" label="Z（距后墙）" minMm={0} valueMm={p.z} onChangeMm={(v) => updatePost(p.id, { z: v })} />
                  <MmField className="w-24" label="截面" minMm={0} valueMm={p.section} onChangeMm={(v) => updatePost(p.id, { section: v })} />
                  <Button
                    variant="ghost"
                    size="icon"
                    title="删除该立柱"
                    disabled={form.posts.length <= 1}
                    onClick={() => removePost(p.id)}
                  >
                    <Trash2 className="h-4 w-4 text-danger" />
                  </Button>
                </div>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={addPost} disabled={form.posts.length >= MAX_POSTS}>
              <Plus className="h-3.5 w-3.5" />
              添加立柱（{form.posts.length}/{MAX_POSTS}）
            </Button>
          </SectionCard>

          <SectionCard title="⑤ 出线孔与电源">
            <div className="space-y-2">
              <p className="text-[13px] text-muted-foreground">
                出线孔位于桌面（x 以桌面中心为 0，z 为距后墙距离，孔需距桌边 ≥ 40 mm）。
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <MmField className="w-28" label="孔 X（左右）" valueMm={form.hole.x} onChangeMm={(v) => patch({ hole: { ...form.hole, x: v } })} />
                <MmField className="w-28" label="孔 Z（距后墙）" minMm={0} valueMm={form.hole.z} onChangeMm={(v) => patch({ hole: { ...form.hole, z: v } })} />
                <MmField className="w-24" label="孔直径" minMm={0} valueMm={form.hole.diameter} onChangeMm={(v) => patch({ hole: { ...form.hole, diameter: v } })} />
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-[13px] text-muted-foreground">
                后墙插座（x 以房间中心为 0，高度为距地高度）：可直接拖滑块调整高度，调整后保存会提示受影响的走线。
              </p>
              {form.outlets.map((o, i) => {
                const yMin = OUTLET_WALL_MARGIN_MM
                const yMax = Math.max(yMin, form.roomH - OUTLET_WALL_MARGIN_MM)
                const sliderY = Math.min(Math.max(o.y, yMin), yMax)
                return (
                  <div key={o.id} className="space-y-2 rounded-md border border-border/70 bg-muted/30 px-2 py-2">
                    <div className="flex flex-wrap items-end gap-2">
                      <span className="w-14 shrink-0 pb-2 text-[13px] text-muted-foreground">插座 {i + 1}</span>
                      <MmField className="w-28" label="X（左右）" valueMm={o.x} onChangeMm={(v) => updateOutlet(o.id, { x: v })} />
                      <MmField
                        className="w-28"
                        label="距地高度"
                        minMm={yMin}
                        valueMm={o.y}
                        onChangeMm={(v) => updateOutlet(o.id, { y: clampOutletY(v, form.roomH) })}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        title="删除该插座"
                        disabled={form.outlets.length <= 1}
                        onClick={() => removeOutlet(o.id)}
                      >
                        <Trash2 className="h-4 w-4 text-danger" />
                      </Button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="shrink-0 text-[11px] text-faint">高度滑块</span>
                      <input
                        type="range"
                        min={yMin}
                        max={yMax}
                        step={10}
                        value={sliderY}
                        aria-label={`插座 ${i + 1} 距地高度（${yMin}–${yMax} mm）`}
                        className="h-1.5 min-w-36 flex-1 cursor-pointer accent-[#0F9D8A]"
                        onChange={(e) => updateOutlet(o.id, { y: clampOutletY(Number(e.target.value), form.roomH) })}
                      />
                      <span className="w-28 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                        当前位置：{o.y} mm
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-[11px]"
                        disabled={o.y === OUTLET_DEFAULT_Y_MM}
                        title={`恢复默认高度 ${OUTLET_DEFAULT_Y_MM} mm`}
                        onClick={() => updateOutlet(o.id, { y: OUTLET_DEFAULT_Y_MM })}
                      >
                        <RotateCcw className="h-3 w-3" />
                        恢复默认
                      </Button>
                    </div>
                    <p className="text-[11px] leading-relaxed text-faint">
                      可调范围 {yMin}–{yMax} mm（距地 / 距顶至少 {OUTLET_WALL_MARGIN_MM} mm，不会移出墙体）；
                      建议 {OUTLET_ADVICE_Y_MM.min}–{OUTLET_ADVICE_Y_MM.max} mm（常见床头 / 桌面附近插座高度）。
                    </p>
                  </div>
                )
              })}
              <Button variant="outline" size="sm" onClick={addOutlet} disabled={form.outlets.length >= MAX_OUTLETS}>
                <Plus className="h-3.5 w-3.5" />
                添加插座（{form.outlets.length}/{MAX_OUTLETS}）
              </Button>
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
        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <div className="rounded-lg border border-border bg-surface p-3 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold">简化三维预览</h2>
            <SpacePreview3D room={previewRoom} />
            <p className="mt-2 text-[11px] leading-relaxed text-faint">
              预览为简化示意：房间 / 桌面 / 书架 / 立柱 / 出线孔 / 插座均由当前表单实时生成；床架为示例规格，随立柱自动展开。
            </p>
          </div>

          <div className="rounded-lg border border-border bg-surface p-4 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold">当前空间摘要</h2>
            <dl className="space-y-1 text-[13px] text-muted-foreground">
              <div className="flex justify-between gap-3">
                <dt>桌面（长 × 深 × 高）</dt>
                <dd className="tabular-nums">
                  {form.deskW} × {form.deskD} × {form.deskH} mm
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>房间（长 × 深 × 高）</dt>
                <dd className="tabular-nums">
                  {form.roomL} × {form.roomW} × {form.roomH} mm
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>书架</dt>
                <dd className="tabular-nums">
                  {form.shelfEnabled ? `${form.shelfLevels} 层 · 离桌 ${form.shelfAbove} mm` : '未配置'}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>立柱</dt>
                <dd className="tabular-nums">{form.posts.length} 根</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>出线孔</dt>
                <dd className="tabular-nums">Ø {form.hole.diameter} mm</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>插座</dt>
                <dd className="tabular-nums">{form.outlets.length} 个</dd>
              </div>
            </dl>
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
            <Button variant="outline" onClick={useDemoSpace}>
              <Sparkles className="h-4 w-4" />
              使用示例空间（1200 × 600 × 750 mm）
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
