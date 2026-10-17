import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  ImagePlus,
  Info,
  Loader2,
  Pin,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
  XCircle,
} from 'lucide-react'
import type { GenerationJob, PrimitiveShape, SceneObject } from '@/types/project'
import { CATEGORY_LABELS } from '@/types/project'
import type { ObjectCategory } from '@/types/project'
import { createDemoCables, createDemoSceneObjects } from '@/data/demoProject'
import { initialDeskPlacement } from '@/scene/geometry'
import { createSamplePhotos } from '@/data/samplePhotos'
import { cn, uid } from '@/lib/utils'
import { mockSleep } from '@/lib/mockPacing'
import { deleteFile, putFile } from '@/state/storage/idb'
import { isMockMode, services, type RecognizedItem } from '@/api'
import { useProject, useProjectsStore } from '@/state/projectsStore'
import { useJobsStore, useProjectJobs } from '@/state/jobsStore'
import { useTourStore } from '@/state/tourStore'
import { Badge } from '@/ui/kit/badge'
import { Button } from '@/ui/kit/button'
import { DataBadge } from '@/ui/kit/data-badge'
import { EmptyState } from '@/ui/kit/empty-state'
import { FastForwardToggle } from '@/ui/kit/fast-forward'
import { Input, Label, Select } from '@/ui/kit/primitives'
import { MmInput } from '@/ui/kit/mm-input'
import { JobList } from '@/ui/jobs/JobList'

type Step = 1 | 2 | 3
/** 识别状态序列：等待 → 分析中 → 待确认 → 完成 / 失败 */
type RecognizePhase = 'idle' | 'waiting' | 'analyzing' | 'awaitConfirm' | 'done' | 'failed'

interface PhotoEntry {
  id: string
  name: string
  url: string
  sample?: boolean
}

const STEP_LABELS: Array<{ n: Step; label: string }> = [
  { n: 1, label: '上传照片' },
  { n: 2, label: '确认识别物品' },
  { n: 3, label: '生成 3D 资产' },
]

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_SIZE_MB = 10
const MAX_PHOTOS = 9

const RAIL_STEPS: Array<{ key: 'waiting' | 'analyzing' | 'awaitConfirm' | 'done'; label: string }> = [
  { key: 'waiting', label: '等待' },
  { key: 'analyzing', label: '分析中' },
  { key: 'awaitConfirm', label: '待确认' },
  { key: 'done', label: '完成' },
]

function railState(phase: RecognizePhase, i: number): 'done' | 'current' | 'pending' | 'failed' {
  if (phase === 'idle') return 'pending'
  if (phase === 'done') return 'done'
  if (phase === 'failed') return i === 0 ? 'done' : i === 1 ? 'failed' : 'pending'
  const idx = RAIL_STEPS.findIndex((s) => s.key === phase)
  if (idx === -1) return 'pending'
  if (i < idx) return 'done'
  if (i === idx) return 'current'
  return 'pending'
}

/** 识别状态条：等待 / 分析中 / 待确认 / 完成（失败时高亮失败步骤） */
function RecognizeRail({ phase }: { phase: RecognizePhase }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {RAIL_STEPS.map((s, i) => {
        const state = railState(phase, i)
        return (
          <span key={s.key} className="flex items-center gap-1">
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px]',
                state === 'done' && 'text-success',
                state === 'current' && 'bg-primary-soft font-medium text-primary',
                state === 'pending' && 'text-faint',
                state === 'failed' && 'bg-danger/10 font-medium text-danger',
              )}
            >
              {state === 'done' ? <CheckCircle2 className="h-3 w-3" /> : null}
              {state === 'failed' ? <XCircle className="h-3 w-3" /> : null}
              {state === 'current' && (s.key === 'waiting' || s.key === 'analyzing') ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : null}
              {state === 'failed' ? '失败' : s.label}
            </span>
            {i < RAIL_STEPS.length - 1 ? <ChevronRight className="h-3 w-3 text-faint" /> : null}
          </span>
        )
      })}
    </div>
  )
}

function guessShape(name: string): PrimitiveShape {
  if (name.includes('笔记本')) return 'laptop'
  if (name.includes('显示器')) return 'monitor'
  if (name.includes('键盘')) return 'keyboard'
  if (name.includes('鼠标')) return 'mouse'
  if (name.includes('台灯') || name.includes('灯')) return 'lamp'
  if (name.includes('书')) return 'books'
  if (name.includes('杯')) return 'cup'
  if (name.includes('收纳') || name.includes('盒')) return 'storageBox'
  if (name.includes('排插') || name.includes('插线板')) return 'powerStrip'
  return 'genericBox'
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const low = confidence < 0.75
  return (
    <Badge variant={low ? 'warning' : 'success'}>
      置信度 {Math.round(confidence * 100)}%{low ? ' · 待确认' : ''}
    </Badge>
  )
}

const QUEUE_STATUS: Record<
  SceneObject['model']['status'],
  { label: string; variant: 'default' | 'outline' | 'primary' | 'success' | 'warning' | 'danger' }
> = {
  none: { label: '等待', variant: 'default' },
  generating: { label: '生成中', variant: 'primary' },
  placeholder: { label: '完成（占位模型）', variant: 'success' },
  ready: { label: '完成', variant: 'success' },
  failed: { label: '失败', variant: 'danger' },
}

export function ImportPage() {
  const { id } = useParams<{ id: string }>()
  const project = useProject(id)
  const navigate = useNavigate()

  const createJob = useJobsStore((s) => s.create)
  const updateJob = useJobsStore((s) => s.update)
  const jobs = useProjectJobs(project?.id)

  const [step, setStep] = useState<Step>(1)
  const [photos, setPhotos] = useState<PhotoEntry[]>([])
  const [uploadIssues, setUploadIssues] = useState<string[]>([])
  const [dragging, setDragging] = useState(false)
  const [phase, setPhase] = useState<RecognizePhase>('idle')
  const [forceFail, setForceFail] = useState(false)
  const [recogJobId, setRecogJobId] = useState<string | null>(null)
  const [recognized, setRecognized] = useState<RecognizedItem[] | null>(null)
  const [recogNote, setRecogNote] = useState<string | null>(null)
  const [recogLow, setRecogLow] = useState(0)
  const [generating, setGenerating] = useState(false)
  const [lastBatch, setLastBatch] = useState<{ ok: number; failed: number; total: number } | null>(null)

  // 演示导览信号：进入「③ 生成 3D 资产」即视为完成「确认识别物品」步骤
  const tourProjectId = project?.id
  useEffect(() => {
    if (step !== 3 || !tourProjectId) return
    useTourStore.getState().signal(tourProjectId, 'confirm-items')
  }, [step, tourProjectId])

  if (!project) {
    return (
      <EmptyState
        title="项目不存在或已被删除"
        description="请返回项目列表，或打开内置示例项目继续体验。"
        action={<Button onClick={() => navigate('/')}>返回项目列表</Button>}
      />
    )
  }

  const projectId = project.id
  const busy = phase === 'waiting' || phase === 'analyzing'

  // ── 照片（原图存 IndexedDB，不写入 localStorage） ──────────────────

  const handleFiles = async (files: FileList | File[] | null) => {
    if (!files) return
    const list = Array.from(files)
    if (list.length === 0) return
    const issues: string[] = []
    const accepted: File[] = []
    const remaining = MAX_PHOTOS - photos.length

    for (const file of list) {
      if (!ACCEPTED_TYPES.includes(file.type)) {
        issues.push(`${file.name}：不支持的文件格式（仅支持 JPG / PNG / WebP）`)
        continue
      }
      if (file.size > MAX_SIZE_MB * 1024 * 1024) {
        issues.push(
          `${file.name}：超过 ${MAX_SIZE_MB} MB 大小限制（当前 ${(file.size / 1024 / 1024).toFixed(1)} MB）`,
        )
        continue
      }
      if (accepted.length >= remaining) {
        issues.push(`${file.name}：超过数量上限（最多 ${MAX_PHOTOS} 张）`)
        continue
      }
      accepted.push(file)
    }

    const next: PhotoEntry[] = []
    for (const file of accepted) {
      const photoId = uid('photo')
      try {
        await putFile('photos', photoId, file)
      } catch {
        // IndexedDB 写入失败（隐私模式 / 存储不可用）：给出可重试的明确提示
        issues.push(`${file.name}：保存到本地失败（浏览器存储不可用），请重新选择该照片再试`)
        continue
      }
      next.push({ id: photoId, name: file.name, url: URL.createObjectURL(file) })
    }
    if (next.length > 0) setPhotos((prev) => [...prev, ...next])
    if (issues.length > 0) setUploadIssues(issues)
  }

  const addSamplePhotos = async () => {
    const remaining = MAX_PHOTOS - photos.length
    if (remaining <= 0) {
      setUploadIssues([`已达数量上限（最多 ${MAX_PHOTOS} 张）`])
      return
    }
    const samples = await createSamplePhotos(Math.min(2, remaining))
    setPhotos((prev) => [...prev, ...samples])
  }

  const removePhoto = async (photo: PhotoEntry) => {
    URL.revokeObjectURL(photo.url)
    setPhotos((prev) => prev.filter((p) => p.id !== photo.id))
    await deleteFile('photos', photo.id)
  }

  // ── 识别（模拟服务：等待 → 分析中 → 待确认 → 完成 / 失败） ─────────

  const runRecognition = async () => {
    const job = createJob({ projectId, type: 'recognition', title: '照片识别（模拟）' })
    setRecogJobId(job.id)
    setPhase('waiting')
    updateJob(job.id, { status: 'waiting', stageLabel: '已加入队列，等待处理' })
    await mockSleep(600)
    setPhase('analyzing')
    updateJob(job.id, { status: 'running', stageLabel: '正在分析照片' })
    try {
      const result = await services.recognition.recognize({
        projectId,
        photoIds: photos.map((p) => p.id),
        simulateFailure: isMockMode ? forceFail : undefined,
        onProgress: (_p, stageLabel) => updateJob(job.id, { status: 'running', stageLabel }),
      })
      setRecognized(result.items)
      setRecogLow(result.lowConfidence)
      setRecogNote(result.note ?? null)
      setPhase('awaitConfirm')
      updateJob(job.id, {
        status: 'awaiting',
        stageLabel: undefined,
        resultNote: `识别出 ${result.items.length} 项物品，等待你确认清单`,
      })
      setStep(2)
    } catch (err) {
      setPhase('failed')
      updateJob(job.id, {
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const patchItem = (tempId: string, patch: Partial<RecognizedItem>) => {
    setRecognized((prev) =>
      prev ? prev.map((it) => (it.tempId === tempId ? { ...it, ...patch } : it)) : prev,
    )
  }

  /** 编辑尺寸即视为用户确认值 */
  const patchDims = (item: RecognizedItem, d: Partial<RecognizedItem['dimensions']>) =>
    patchItem(item.tempId, {
      dimensions: { ...item.dimensions, ...d },
      dimensionSource: 'user',
    })

  const addRecognizedItem = () => {
    setRecognized((prev) => [
      ...(prev ?? []),
      {
        tempId: uid('r'),
        name: '自定义物品',
        category: 'nonElectrical',
        dimensions: { width: 0.15, height: 0.1, depth: 0.1 },
        quantity: 1,
        needsPower: false,
        fixed: false,
        dimensionSource: 'user',
        ports: [],
        confidence: 1,
      },
    ])
  }

  const estimatedCount = recognized?.filter((it) => it.dimensionSource === 'estimated').length ?? 0
  const keyEstimated =
    recognized
      ?.filter((it) => it.dimensionSource === 'estimated' && it.category === 'electrical')
      .slice(0, 3)
      .map((it) => it.name) ?? []

  const confirmAllDims = () =>
    setRecognized((prev) =>
      prev ? prev.map((it) => ({ ...it, dimensionSource: 'user' as const })) : prev,
    )

  // ── 确认清单 → 写入场景配置 ───────────────────────────────────────

  const confirmItems = () => {
    if (!recognized || recognized.length === 0) return
    const objects: SceneObject[] = recognized.map((item, index) => ({
      id: uid('obj'),
      projectId,
      name: item.name,
      category: item.category,
      dimensions: { ...item.dimensions },
      transform: { position: initialDeskPlacement(index, project.room), rotationY: 0 },
      model: {
        status: 'none',
        source: 'demo',
        format: 'placeholder-box',
        shape: guessShape(item.name),
      },
      ports: item.ports,
      quantity: item.quantity,
      needsPower: item.needsPower,
      fixed: item.fixed,
      locked: false,
      frequent: false,
      visible: true,
      source: 'recognized',
      recognition: {
        confidence: item.confidence,
        source: 'mock',
        dimensionSource: item.dimensionSource,
      },
    }))
    useProjectsStore.getState().update(projectId, (p) => ({
      ...p,
      objects,
      cables: [],
      stage: 'assets',
    }))
    if (recogJobId) {
      updateJob(recogJobId, {
        status: 'success',
        resultNote: `已确认 ${recognized.length} 项物品并写入场景配置`,
      })
    }
    setPhase('done')
    setLastBatch(null)
    setStep(3)
  }

  const skipWithDemoObjects = () => {
    const objects = createDemoSceneObjects(projectId)
    useProjectsStore.getState().update(projectId, (p) => ({
      ...p,
      objects,
      cables: createDemoCables(objects, projectId),
      stage: 'assets',
    }))
    setPhase('done')
    setLastBatch(null)
    setStep(3)
  }

  // ── 模型生成队列（等待 / 生成中 / 完成 / 失败，可重试） ────────────

  const setModel = (objectId: string, patch: Partial<SceneObject['model']>) => {
    useProjectsStore.getState().update(projectId, (prev) => ({
      ...prev,
      objects: prev.objects.map((o) =>
        o.id === objectId ? { ...o, model: { ...o.model, ...patch } } : o,
      ),
    }))
  }

  const generateBatch = async (targets: SceneObject[]) => {
    if (targets.length === 0) return
    const job = createJob({
      projectId,
      type: 'model',
      title: `生成 3D 资产（${targets.length} 件，模拟）`,
      itemIds: targets.map((o) => o.id),
    })
    setGenerating(true)
    setLastBatch(null)
    updateJob(job.id, { status: 'running', stageLabel: '准备任务队列' })

    let ok = 0
    let failed = 0
    for (let i = 0; i < targets.length; i += 1) {
      const object = targets[i]
      const attempt = object.model.status === 'failed' ? 1 : 0
      updateJob(job.id, {
        status: 'running',
        stageLabel: `生成中：${object.name}（${i + 1}/${targets.length}）`,
      })
      setModel(object.id, { status: 'generating', stage: '准备参考照片' })
      try {
        const res = await services.modelGeneration.generateObject({
          projectId,
          object,
          attempt,
          // 模拟任务没有真实百分比：仅更新阶段文字，界面不显示精确进度
          onProgress: (_p, stageLabel) => setModel(object.id, { stage: stageLabel }),
        })
        setModel(object.id, {
          status: 'placeholder',
          source: 'generated',
          format: 'placeholder-box',
          shape: object.model.shape ?? 'genericBox',
          stage: undefined,
          note: res.note,
        })
        ok += 1
      } catch (err) {
        failed += 1
        setModel(object.id, {
          status: 'failed',
          stage: undefined,
          note: err instanceof Error ? err.message : String(err),
        })
      }
    }

    updateJob(job.id, {
      status: failed > 0 ? 'partial' : 'success',
      stageLabel: undefined,
      progress: 1,
      resultNote:
        failed > 0
          ? `${ok} 件成功，${failed} 件失败（可重试失败项，或使用占位盒后继续）`
          : `全部 ${ok} 件生成完成（模拟占位模型）`,
    })
    setLastBatch({ ok, failed, total: targets.length })
    setGenerating(false)
  }

  const usePlaceholder = (objectId: string) =>
    setModel(objectId, {
      status: 'placeholder',
      source: 'generated',
      format: 'placeholder-box',
      stage: undefined,
      note: '手动选择：使用匹配尺寸的几何占位物（未生成真实模型）',
    })

  const handleRetryJob = (job: GenerationJob) => {
    if (job.type === 'recognition') {
      void runRecognition()
      return
    }
    if (job.type === 'model' && job.itemIds && job.itemIds.length > 0) {
      const p = useProjectsStore.getState().projects[projectId]
      const targets = job.itemIds
        .map((oid) => p?.objects.find((o) => o.id === oid))
        .filter((o): o is SceneObject => Boolean(o && o.model.status === 'failed'))
      if (targets.length > 0) void generateBatch(targets)
    }
  }

  const pendingObjects = project.objects.filter((o) => o.model.status === 'none')
  const failedObjects = project.objects.filter((o) => o.model.status === 'failed')
  const queueRemaining = pendingObjects.length + failedObjects.length

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">照片导入与物品确认</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            上传照片 → 确认识别物品（可修改）→ 生成 3D 资产 → 带入三维工作台。
          </p>
        </div>
        <div className="flex items-center gap-1">
          {STEP_LABELS.map((s, i) => (
            <span key={s.n} className="flex items-center gap-1">
              <button
                type="button"
                disabled={s.n >= step}
                onClick={() => setStep(s.n)}
                className={
                  s.n === step
                    ? 'rounded-full bg-primary-soft px-3 py-1 text-[13px] font-medium text-primary'
                    : s.n < step
                      ? 'rounded-full px-3 py-1 text-[13px] text-muted-foreground hover:bg-muted'
                      : 'rounded-full px-3 py-1 text-[13px] text-faint'
                }
              >
                {s.n} · {s.label}
              </button>
              {i < STEP_LABELS.length - 1 ? (
                <ChevronRight className="h-3.5 w-3.5 text-faint" />
              ) : null}
            </span>
          ))}
        </div>
      </div>

      {phase !== 'idle' ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2 shadow-sm">
          <RecognizeRail phase={phase} />
          <div className="flex items-center gap-2 text-xs text-faint">
            识别状态
            {isMockMode ? <DataBadge kind="mock" /> : null}
          </div>
        </div>
      ) : null}

      {step === 1 ? (
        <section className="space-y-3 rounded-lg border border-border bg-surface p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">① 上传桌面照片</h2>
            {isMockMode ? <DataBadge kind="mock" label="识别为模拟结果" /> : null}
          </div>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            照片原图保存在浏览器 IndexedDB（大文件不进入 localStorage）。演示模式下识别使用模拟数据，
            可选择真实照片，也可直接使用示例照片或开始识别。
          </p>

          {project.isDemo ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[13px] leading-relaxed text-warning">
              <Info className="h-4 w-4 shrink-0" />
              <span className="flex-1">
                示例项目已内置 9 件已确认物品（演示数据）：可运行一次模拟识别体验流程（含失败 / 重试），或直接查看「③ 生成 3D 资产」。
              </span>
              <Button
                variant="outline"
                size="sm"
                className="border-warning/50 text-warning"
                onClick={() => {
                  setLastBatch(null)
                  setStep(3)
                }}
              >
                直接查看 3D 资产
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : null}

          <label
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-8 text-center transition-colors',
              dragging
                ? 'border-primary bg-primary-soft/60'
                : 'border-border hover:border-primary/50 hover:bg-primary-soft/40',
            )}
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              void handleFiles(e.dataTransfer.files)
            }}
          >
            <ImagePlus className="h-7 w-7 text-faint" />
            <span className="text-sm font-medium">点击选择照片，或拖拽到此处</span>
            <span className="text-xs text-faint">
              支持 JPG / PNG / WebP · 单个 ≤ {MAX_SIZE_MB} MB · 最多 {MAX_PHOTOS} 张（已选 {photos.length}/
              {MAX_PHOTOS}）
            </span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              onChange={(e) => {
                void handleFiles(e.target.files)
                e.target.value = ''
              }}
            />
          </label>

          {uploadIssues.length > 0 ? (
            <div className="rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-[13px] text-danger">
              <div className="flex items-start justify-between gap-2">
                <ul className="space-y-0.5">
                  {uploadIssues.map((m) => (
                    <li key={m} className="flex items-start gap-1.5">
                      <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      {m}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  title="清除提示"
                  className="text-danger/70 transition-colors hover:text-danger"
                  onClick={() => setUploadIssues([])}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          ) : null}

          {photos.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {photos.map((p) => (
                <div
                  key={p.id}
                  className="group relative h-24 w-32 overflow-hidden rounded-md border border-border"
                >
                  <img src={p.url} alt={p.name} className="h-full w-full object-cover" />
                  {p.sample ? (
                    <Badge variant="outline" className="absolute left-1 top-1 bg-surface/90">
                      示例
                    </Badge>
                  ) : null}
                  <span className="absolute inset-x-0 bottom-0 truncate bg-foreground/60 px-1.5 py-0.5 text-[10px] text-white">
                    {p.name}
                  </span>
                  <button
                    type="button"
                    title="移除照片"
                    onClick={() => void removePhoto(p)}
                    className="absolute right-1 top-1 rounded-full bg-surface/90 p-1 opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-danger" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-faint">尚未选择照片。演示模式可直接开始识别（使用模拟结果）。</p>
          )}

          {phase === 'failed' ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[13px] text-danger">
              <XCircle className="h-4 w-4 shrink-0" />
              <span className="flex-1">
                识别失败（演示异常流程）。可重试；取消勾选「强制失败」后重试即可成功。
              </span>
              <Button variant="outline" size="sm" onClick={() => void runRecognition()}>
                <RefreshCw className="h-3.5 w-3.5" />
                重试识别
              </Button>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void runRecognition()} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {busy
                ? phase === 'waiting'
                  ? '等待处理…'
                  : '识别中…'
                : `开始识别${photos.length > 0 ? `（${photos.length} 张照片）` : '（模拟）'}`}
            </Button>
            <Button variant="outline" onClick={() => void addSamplePhotos()} disabled={busy}>
              <ImagePlus className="h-4 w-4" />
              使用示例照片（演示）
            </Button>
            <Button variant="ghost" onClick={skipWithDemoObjects} disabled={busy}>
              跳过识别，使用示例物品库
            </Button>
            {isMockMode ? (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  className="accent-[#0F9D8A]"
                  checked={forceFail}
                  onChange={(e) => setForceFail(e.target.checked)}
                />
                强制模拟识别失败（演示失败 / 重试流程）
              </label>
            ) : null}
            <FastForwardToggle />
          </div>
        </section>
      ) : null}

      {step === 2 && recognized ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-3 text-[13px] shadow-sm">
            <Badge variant="primary">共 {recognized.length} 项</Badge>
            <Badge variant="success">高置信 {recognized.length - recogLow} 项</Badge>
            {recogLow > 0 ? (
              <Badge variant="warning">
                <AlertTriangle className="h-3 w-3" />
                待确认 {recogLow} 项
              </Badge>
            ) : null}
            <span className="text-muted-foreground">{recogNote}</span>
            {isMockMode ? <DataBadge kind="mock" /> : null}
          </div>

          <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[13px] leading-relaxed text-warning">
            <div className="flex flex-wrap items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {estimatedCount > 0 ? (
                <>
                  <span className="flex-1">
                    {estimatedCount} 项尺寸仍为 AI 估计值
                    {keyEstimated.length > 0
                      ? `（关键物品：${keyEstimated.join('、')}${estimatedCount > keyEstimated.length ? ' 等' : ''}，建议实测后修改）`
                      : '，建议实测后修改'}
                    。
                  </span>
                  <Button variant="outline" size="sm" onClick={confirmAllDims}>
                    全部确认为当前值
                  </Button>
                </>
              ) : (
                <span className="flex items-center gap-2 text-success">
                  <CheckCircle2 className="h-4 w-4" />
                  全部物品尺寸已确认（可继续修改，修改后仍视为确认值）
                </span>
              )}
            </div>
          </div>

          <p className="text-xs text-faint">
            所有字段均可修改：名称、分类、数量、宽 / 高 / 深、是否带电、是否固定摆放；可删除误识别项或手动补充。
            {project.isDemo ? '（示例项目的场景会被本次结果替换，之后可在工作台重新载入示例物品库）' : ''}
          </p>

          <div className="space-y-2">
            {recognized.map((item) => (
              <div
                key={item.tempId}
                className="space-y-2 rounded-lg border border-border bg-surface p-3 shadow-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    className="min-w-[160px] flex-1"
                    value={item.name}
                    onChange={(e) => patchItem(item.tempId, { name: e.target.value })}
                    placeholder="物品名称"
                  />
                  <ConfidenceBadge confidence={item.confidence} />
                  {item.dimensionSource === 'estimated' ? (
                    <Badge variant="warning">尺寸：估计值</Badge>
                  ) : (
                    <Badge variant="success">尺寸：已确认</Badge>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    title="删除该物品"
                    onClick={() =>
                      setRecognized((prev) => (prev ?? []).filter((x) => x.tempId !== item.tempId))
                    }
                  >
                    <Trash2 className="h-4 w-4 text-danger" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                  <div className="space-y-1">
                    <Label>分类</Label>
                    <Select
                      value={item.category}
                      onChange={(e) =>
                        patchItem(item.tempId, { category: e.target.value as ObjectCategory })
                      }
                    >
                      {(Object.keys(CATEGORY_LABELS) as ObjectCategory[]).map((k) => (
                        <option key={k} value={k}>
                          {CATEGORY_LABELS[k]}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>数量</Label>
                    <Input
                      type="number"
                      min={1}
                      max={99}
                      className="tabular-nums"
                      value={item.quantity}
                      onChange={(e) =>
                        patchItem(item.tempId, { quantity: Math.max(1, Number(e.target.value) || 1) })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>尺寸 宽 / 高 / 深（mm）</Label>
                    <div className="grid grid-cols-3 gap-1.5">
                      <MmInput
                        value={item.dimensions.width}
                        min={10}
                        onChange={(v) => patchDims(item, { width: v })}
                      />
                      <MmInput
                        value={item.dimensions.height}
                        min={5}
                        onChange={(v) => patchDims(item, { height: v })}
                      />
                      <MmInput
                        value={item.dimensions.depth}
                        min={10}
                        onChange={(v) => patchDims(item, { depth: v })}
                      />
                    </div>
                    {item.dimensionSource === 'estimated' ? (
                      <button
                        type="button"
                        className="text-[11px] text-primary hover:underline"
                        onClick={() => patchItem(item.tempId, { dimensionSource: 'user' })}
                      >
                        按实测确认当前尺寸
                      </button>
                    ) : null}
                  </div>
                  <div className="space-y-1">
                    <Label>属性</Label>
                    <div className="flex flex-col gap-1 pt-1 text-[13px]">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          className="accent-[#0F9D8A]"
                          checked={item.needsPower}
                          onChange={(e) => patchItem(item.tempId, { needsPower: e.target.checked })}
                        />
                        是否带电（需供电）
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          className="accent-[#0F9D8A]"
                          checked={item.fixed}
                          onChange={(e) => patchItem(item.tempId, { fixed: e.target.checked })}
                        />
                        <Pin className="h-3.5 w-3.5 text-faint" />
                        是否固定摆放
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={confirmItems} disabled={recognized.length === 0}>
              确认并写入项目（{recognized.length} 项）
            </Button>
            <Button variant="outline" onClick={addRecognizedItem}>
              <Plus className="h-4 w-4" />
              手动补充物品
            </Button>
            <Button variant="ghost" onClick={() => setStep(1)}>
              返回照片
            </Button>
          </div>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-3 shadow-sm">
            <span className="text-[13px]">
              待生成 <span className="font-semibold tabular-nums">{queueRemaining}</span> 件 · 已完成{' '}
              <span className="font-semibold tabular-nums">
                {project.objects.length - queueRemaining}
              </span>{' '}
              件
            </span>
            {failedObjects.length > 0 ? (
              <Badge variant="danger">失败 {failedObjects.length} 件</Badge>
            ) : null}
            {isMockMode ? <DataBadge kind="mock" label="生成为模拟" /> : null}
            <FastForwardToggle compact />
            <span className="text-xs text-faint">
              演示：台灯首次生成会失败，重试后成功（用于演示失败 / 重试 / 部分成功）
            </span>
          </div>

          <p className="text-xs text-faint">
            模型生成按件排队，状态为 等待 / 生成中 / 完成 / 失败；模拟任务无法提供真实进度，只显示阶段文字。
            模型未完成时，工作台会以匹配尺寸的几何占位物显示该物品。
          </p>

          {lastBatch ? (
            <div
              className={cn(
                'flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px]',
                lastBatch.failed > 0
                  ? 'border-warning/40 bg-warning/10 text-warning'
                  : 'border-success/40 bg-success/10 text-success',
              )}
            >
              {lastBatch.failed > 0 ? (
                <AlertTriangle className="h-4 w-4 shrink-0" />
              ) : (
                <CheckCircle2 className="h-4 w-4 shrink-0" />
              )}
              {lastBatch.failed > 0
                ? `部分成功：成功 ${lastBatch.ok} 件，失败 ${lastBatch.failed} 件。可重试失败项或使用占位盒，不影响继续进入工作台。`
                : `全部 ${lastBatch.total} 件生成完成（模拟占位模型）。`}
            </div>
          ) : null}

          <div className="space-y-2">
            {project.objects.map((o) => {
              const meta = QUEUE_STATUS[o.model.status]
              return (
                <div
                  key={o.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 shadow-sm"
                >
                  <span className="min-w-[140px] flex-1 truncate text-[13px] font-medium">{o.name}</span>
                  <Badge variant="outline">{CATEGORY_LABELS[o.category]}</Badge>
                  {o.fixed ? (
                    <Badge variant="outline">
                      <Pin className="h-3 w-3" />
                      固定摆放
                    </Badge>
                  ) : null}
                  <Badge variant={meta.variant}>
                    {o.model.status === 'generating' ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : null}
                    {meta.label}
                  </Badge>
                  {o.model.status === 'generating' && o.model.stage ? (
                    <span className="text-xs text-muted-foreground">阶段：{o.model.stage}</span>
                  ) : null}
                  {o.model.status === 'failed' && o.model.note ? (
                    <span className="max-w-[280px] truncate text-xs text-danger" title={o.model.note}>
                      {o.model.note}
                    </span>
                  ) : null}
                  <span className="flex items-center gap-2">
                    {o.model.status === 'none' || o.model.status === 'failed' ? (
                      <Button
                        variant={o.model.status === 'failed' ? 'primary' : 'outline'}
                        size="sm"
                        disabled={generating}
                        onClick={() => void generateBatch([o])}
                      >
                        {o.model.status === 'failed' ? (
                          <RefreshCw className="h-3.5 w-3.5" />
                        ) : (
                          <Sparkles className="h-3.5 w-3.5" />
                        )}
                        {o.model.status === 'failed' ? '重试' : '生成'}
                      </Button>
                    ) : null}
                    {o.model.status === 'failed' ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={generating}
                        onClick={() => usePlaceholder(o.id)}
                      >
                        使用占位盒
                      </Button>
                    ) : null}
                  </span>
                </div>
              )
            })}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => void generateBatch([...pendingObjects, ...failedObjects])}
              disabled={generating || queueRemaining === 0}
            >
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {generating ? '生成中…' : `全部生成（${queueRemaining} 件）`}
            </Button>
            {failedObjects.length > 0 ? (
              <Button
                variant="outline"
                disabled={generating}
                onClick={() => void generateBatch(failedObjects)}
              >
                <RefreshCw className="h-4 w-4" />
                重试失败项（{failedObjects.length}）
              </Button>
            ) : null}
            <Button
              variant="outline"
              disabled={generating || queueRemaining === 0}
              onClick={() => [...pendingObjects, ...failedObjects].forEach((o) => usePlaceholder(o.id))}
            >
              全部使用占位盒
            </Button>
            <Button size="lg" onClick={() => navigate(`/projects/${projectId}/workspace`)}>
              进入三维工作台
              <ArrowRight className="h-4 w-4" />
            </Button>
            <Button variant="ghost" onClick={() => setStep(2)} disabled={!recognized}>
              返回物品清单
            </Button>
          </div>
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">任务记录（等待 / 待确认 / 失败可重试）</h2>
        <JobList jobs={jobs} onRetry={handleRetryJob} />
      </section>
    </div>
  )
}
