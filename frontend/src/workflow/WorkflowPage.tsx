import * as React from 'react'
import {
  AlgorithmScene,
  type CameraView,
  type Layers,
} from '@/algorithm-lab/AlgorithmScene'
import {
  parseBundle,
  type Cable,
  type Item,
  type PackingResult,
  type Scene,
} from '@/algorithm-lab/contract'
import { Button } from '@/ui/kit/button'
import '@/algorithm-lab/algorithm-lab.css'
import {
  ApiError,
  applyPacking,
  buildPackingPreview,
  clearStoredSceneId,
  confirmBaseline,
  createScene,
  fetchGuideMarkdown,
  getScene,
  getStoredSceneId,
  runGuide,
  runPacking,
  runRouting,
  saveScene,
  setStoredSceneId,
  uploadPhoto,
  type SceneDocument,
} from './api'

const LAYERS: Layers = {
  regions: true,
  collisions: true,
  network: true,
  cables: true,
  reserved: false,
  supports: true,
  trayCandidates: false,
}

const STEPS = ['confirm', 'organize', 'connect', 'guide'] as const
type Step = (typeof STEPS)[number]

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function parseError(err: unknown): string {
  if (err instanceof ApiError) return `${err.status} ${err.code}: ${err.message}`
  if (err instanceof Error) return err.message
  return String(err)
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

const MAX_IMPORT_BYTES = 8 * 1024 * 1024
const MAX_PHOTO_BYTES = 10 * 1024 * 1024
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']

function numOr(value: string, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

export function WorkflowPage(): React.ReactElement {
  const [sceneId, setSceneId] = React.useState<string | null>(null)
  const [doc, setDoc] = React.useState<SceneDocument | null>(null)
  const [draft, setDraft] = React.useState<Scene | null>(null)
  const [step, setStep] = React.useState<Step>('confirm')
  const [busy, setBusy] = React.useState(false)
  const [status, setStatus] = React.useState<string>('就绪')
  const [error, setError] = React.useState<string | null>(null)
  const [photoLocalUrl, setPhotoLocalUrl] = React.useState<string | null>(null)
  const [viewScene, setViewScene] = React.useState<'baseline' | 'current' | 'packing'>('current')
  const [camera, setCamera] = React.useState<CameraView>('perspective')
  const [resetToken, setResetToken] = React.useState(0)
  const [selected, setSelected] = React.useState<string | null>(null)
  const [baselineChecked, setBaselineChecked] = React.useState(false)
  const [previewResult, setPreviewResult] = React.useState<PackingResult | null>(null)
  const [previewScene, setPreviewScene] = React.useState<Scene | null>(null)
  const [showPreview, setShowPreview] = React.useState(false)

  const abortRef = React.useRef<AbortController | null>(null)
  const seqRef = React.useRef(0)
  const importRef = React.useRef<HTMLInputElement | null>(null)
  const photoRef = React.useRef<HTMLInputElement | null>(null)

  const withRequest = React.useCallback(
    async (fn: (signal: AbortSignal) => Promise<SceneDocument>, note: string) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      const seq = ++seqRef.current
      setBusy(true)
      setError(null)
      try {
        const next = await fn(controller.signal)
        if (seq !== seqRef.current) return
        applyDoc(next)
        setStatus(note)
      } catch (err) {
        if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) return
        if (seq !== seqRef.current) return
        if (err instanceof ApiError && err.status === 409) {
          const id = getStoredSceneId()
          if (id) {
            const latest = await getScene(id, controller.signal)
            if (seq === seqRef.current) applyDoc(latest)
          }
          setError('场景已更新，已读取最新保存状态。请检查后重新操作。')
        } else setError(parseError(err))
      } finally {
        if (seq === seqRef.current) setBusy(false)
      }
    },
    [],
  )

  const applyDoc = React.useCallback((next: SceneDocument) => {
    setDoc(next)
    setDraft(clone(next.scene))
    setSceneId(next.scene.scene_id)
    setStoredSceneId(next.scene.scene_id)
    setPreviewResult(null)
    setPreviewScene(null)
    setShowPreview(false)
    setViewScene('current')
    setBaselineChecked(false)
  }, [])

  React.useEffect(() => {
    const id = getStoredSceneId()
    if (!id) {
      setStatus('首次使用，可创建示例场景')
    } else {
      setSceneId(id)
      void withRequest((signal) => getScene(id, signal), '已读取已保存场景')
    }
    return () => { abortRef.current?.abort(); seqRef.current++ }
  }, [withRequest])

  React.useEffect(() => {
    return () => {
      if (photoLocalUrl) URL.revokeObjectURL(photoLocalUrl)
    }
  }, [photoLocalUrl])

  const dirty = Boolean(doc && draft && !deepEqual(doc.scene, draft))
  const planningDisabled = busy || dirty || !draft

  const activeScene: Scene | null =
    viewScene === 'baseline'
      ? doc?.baseline ?? null
      : viewScene === 'packing'
        ? previewScene ?? draft
        : draft

  const routingMatches = Boolean(
    !dirty && doc?.routing_result && draft && doc.routing_result.scene_revision === draft.scene_revision,
  )

  const onSelect = React.useCallback((id: string | null) => setSelected(id), [])
  const onMove = React.useCallback(() => {}, [])

  const handleCreate = () =>
    withRequest((signal) => createScene(signal), '已创建示例场景（布局与走线由本机算法计算）')

  const handleReload = () => {
    if (!sceneId) return
    void withRequest((signal) => getScene(sceneId, signal), '已读取已保存场景')
  }

  const handleNew = () => {
    clearStoredSceneId()
    abortRef.current?.abort()
    seqRef.current++
    setDoc(null)
    setDraft(null)
    setSceneId(null)
    setSelected(null)
    setPreviewResult(null)
    setPreviewScene(null)
    setShowPreview(false)
    setStatus('已清空本地会话，输入或创建新的场景')
  }

  const updateItem = (itemId: string, patch: Partial<Item>) => {
    if (busy) return
    setDraft((prev) =>
      prev ? { ...prev, items: prev.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)) } : prev,
    )
  }

  const updateCable = (cableId: string, patch: Partial<Cable>) => {
    if (busy) return
    setDraft((prev) =>
      prev ? { ...prev, cables: prev.cables.map((c) => (c.id === cableId ? { ...c, ...patch } : c)) } : prev,
    )
  }

  const handleSave = () => {
    if (!sceneId || !draft || !doc) return
    void withRequest(
      (signal) => saveScene(sceneId, doc.scene.scene_revision, draft, signal),
      '已保存修改，规划结果已失效',
    )
  }

  const handleDiscard = () => {
    if (!doc) return
    setDraft(clone(doc.scene))
    setBaselineChecked(false)
    setStatus('已放弃未保存修改')
  }

  const handleBaseline = () => {
    if (!sceneId || !doc || !baselineChecked || dirty) return
    void withRequest(
      (signal) => confirmBaseline(sceneId, doc.scene.scene_revision, signal),
      '已建立新基线（尺寸、接口、原始位置已确认）',
    )
  }

  const handlePacking = () => {
    if (!sceneId || !doc || planningDisabled || !doc.baseline) return
    void withRequest((signal) => runPacking(sceneId, doc.scene.scene_revision, signal), '已完成整理预览')
  }

  const handleApply = () => {
    if (!sceneId || !doc || planningDisabled || !showPreview || !previewResult) return
    void withRequest(
      (signal) => applyPacking(sceneId, doc.scene.scene_revision, signal),
      '已接受整理建议',
    )
  }

  const handleRouting = () => {
    if (!sceneId || !doc || planningDisabled || !doc.baseline) return
    void withRequest((signal) => runRouting(sceneId, doc.scene.scene_revision, signal), '已完成走线')
  }

  const handleGuide = () => {
    if (!sceneId || !doc || planningDisabled) return
    void withRequest((signal) => runGuide(sceneId, doc.scene.scene_revision, signal), '已生成指南')
  }

  const handleViewPackingPreview = () => {
    if (!doc || !doc.packing_result) return
    const built = buildPackingPreview(doc)
    if (!built) {
      setError('整理预览结果无法通过校验')
      return
    }
    setPreviewResult(built.packingResult)
    setPreviewScene(built.previewScene)
    setShowPreview(true)
    setViewScene('packing')
  }

  const handleCancelPreview = () => {
    setShowPreview(false)
    setPreviewResult(null)
    setPreviewScene(null)
    setViewScene('current')
  }

  const handleImport = async (file: File) => {
    if (file.size > MAX_IMPORT_BYTES) {
      setError('导入文件超过 8MB 限制')
      return
    }
    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as unknown
      const bundle = parseBundle(parsed)
      if (!sceneId || !draft) {
        setError('请先创建或读取场景后再导入')
        return
      }
      const next: Scene = {
        ...bundle.scene,
        scene_id: draft.scene_id,
        scene_revision: draft.scene_revision,
        baseline_id: draft.baseline_id,
      }
      setDraft(next)
      setStatus('已导入，需点击“保存修改”后生效')
    } catch (err) {
      setError(`导入失败：${parseError(err)}`)
    }
  }

  const handleExport = () => {
    if (!draft) return
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `scene-${draft.scene_id}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handlePhoto = async (file: File) => {
    if (!sceneId || !doc) return
    if (!PHOTO_TYPES.includes(file.type) || file.size > MAX_PHOTO_BYTES) {
      setError('照片仅支持 jpeg/png/webp 且不超过 10MB')
      return
    }
    if (photoLocalUrl) URL.revokeObjectURL(photoLocalUrl)
    setPhotoLocalUrl(URL.createObjectURL(file))
    await withRequest(
      (signal) => uploadPhoto(sceneId, doc.scene.scene_revision, file, signal),
      '照片已保存为参照（非 AI 识别）',
    )
  }

  const handleDownloadGuide = async () => {
    if (!sceneId || !doc) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setBusy(true)
    try {
      const md = await fetchGuideMarkdown(sceneId, doc.scene.scene_revision, controller.signal)
      const blob = new Blob([md], { type: 'text/markdown' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `guide-${doc.scene.scene_id}-r${doc.scene.scene_revision}.md`
      a.click()
      URL.revokeObjectURL(url)
      setStatus('已下载当前版本指南')
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError('指南已过期，请重新生成')
      } else {
        setError(parseError(err))
      }
    } finally {
      setBusy(false)
    }
  }

  const sourceNotice =
    '布局与走线由本机算法计算；照片仅作参照，示例物品需逐项确认；当前使用简化外观。识别与 Rodin 生成尚未接入此流程。'

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex flex-wrap items-center gap-3 border-b border-border bg-surface px-4 py-3">
        <a className="text-primary underline-offset-4 hover:underline" href="/" data-testid="home-link">
          返回首页
        </a>
        <h1 className="text-lg font-semibold">真实整理工作台</h1>
        {draft ? (
          <span className="text-sm text-muted-foreground" data-testid="scene-identity">
            {draft.scene_id.slice(0, 8)} · r{draft.scene_revision}
            {dirty ? ' · 未保存' : ' · 已保存'}
          </span>
        ) : null}
        <nav className="ml-auto flex flex-wrap gap-2" aria-label="流程步骤">
          {STEPS.map((s) => (
            <Button
              key={s}
              size="sm"
              variant={step === s ? 'primary' : 'outline'}
              onClick={() => { setStep(s); document.getElementById(`workflow-${s}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}
              data-testid={`nav-${s}`}
            >
              {{ confirm: '确认', organize: '整理', connect: '连接', guide: '指南' }[s]}
            </Button>
          ))}
        </nav>
      </header>

      <p className="border-b border-border bg-muted px-4 py-2 text-xs text-muted-foreground" data-testid="source-notice">
        {sourceNotice}
      </p>

      {error ? (
        <div className="border-b border-danger/40 bg-danger/10 px-4 py-2 text-sm text-danger" data-testid="workflow-error" role="alert">
          {error}
        </div>
      ) : null}
      <div className="border-b border-border px-4 py-1 text-xs text-muted-foreground" data-testid="workflow-status">
        {busy ? '处理中…' : status}
      </div>

      {!draft ? (
        <main className="mx-auto max-w-md px-4 py-10 text-center" data-testid="workflow-empty">
          <p className="mb-6 text-sm text-muted-foreground">{sourceNotice}</p>
          <Button onClick={handleCreate} disabled={busy} data-testid="create-sample">
            创建示例场景
          </Button>
        </main>
      ) : (
        <main className="grid min-w-0 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          <section className="grid min-w-0 content-start gap-4 lg:sticky lg:top-4 lg:self-start">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={handleReload} disabled={busy} data-testid="read-saved">
                读取已保存场景
              </Button>
              <Button size="sm" variant="outline" onClick={handleNew} disabled={busy} data-testid="new-scene">
                新建场景
              </Button>
              <Button size="sm" variant="outline" onClick={handleExport} data-testid="export-json">
                导出 JSON
              </Button>
              <Button size="sm" variant="outline" onClick={() => importRef.current?.click()} data-testid="import-json">
                导入 JSON
              </Button>
              <input
                ref={importRef}
                type="file"
                accept="application/json"
                className="hidden"
                data-testid="import-input"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void handleImport(f)
                  e.target.value = ''
                }}
              />
            </div>

            <div className="flex flex-wrap gap-2" data-testid="view-toggles">
              {(['baseline', 'current', 'packing'] as const).map((v) => (
                <Button
                  key={v}
                  size="sm"
                  variant={viewScene === v ? 'secondary' : 'ghost'}
                  disabled={v === 'baseline' ? !doc?.baseline : v === 'packing' ? !showPreview : false}
                  onClick={() => setViewScene(v)}
                  data-testid={`view-${v}`}
                >
                  {{ baseline: '基线', current: '当前', packing: '整理建议（尚未应用）' }[v]}
                </Button>
              ))}
              {previewResult ? (
                <span className="self-center text-xs text-muted-foreground" data-testid="packing-status">
                  {previewResult.status}
                </span>
              ) : null}
            </div>

            <div className="h-[320px] w-full overflow-hidden rounded-lg border border-border lg:h-[460px]" data-testid="scene-canvas">
              {activeScene ? (
                <AlgorithmScene
                  scene={activeScene}
                  routing={viewScene === 'current' && routingMatches ? doc?.routing_result ?? undefined : undefined}
                  layers={LAYERS}
                  selected={selected}
                  onSelect={onSelect}
                  view={camera}
                  reset={resetToken}
                  onMove={onMove}
                />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  {viewScene === 'baseline' ? '尚无基线' : '无可用场景'}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {(['perspective', 'top', 'front', 'underside'] as const).map((v) => (
                <Button key={v} size="sm" variant={camera === v ? 'secondary' : 'ghost'} onClick={() => setCamera(v)} data-testid={`camera-${v}`}>
                  {{ perspective: '透视', top: '俯视', front: '正视', underside: '桌底' }[v]}
                </Button>
              ))}
              <Button size="sm" variant="ghost" onClick={() => setResetToken((n) => n + 1)} data-testid="camera-reset">
                重置视角
              </Button>
            </div>
          </section>

          <aside className="flex min-w-0 flex-col gap-4">
            <section id="workflow-confirm" className="rounded-lg border border-border bg-surface p-3" data-testid="step-confirm">
              <h2 className="mb-2 text-sm font-semibold">1. 确认尺寸、接口</h2>
              <p className="mb-2 text-xs text-muted-foreground">编辑尺寸后需重新保存并确认基线。</p>
              <details className="text-sm" data-testid="item-details">
                <summary>物体列表（{draft.items.length}）</summary>
                <ul className="mt-2 grid gap-2">
                  {draft.items.map((item) => (
                    <li key={item.id} className="rounded border border-border p-2" data-testid={`item-${item.id}`}>
                      <button type="button" className="mb-1 w-full text-left font-medium" onClick={() => setSelected(item.id)}>
                        {item.name} {item.fixed ? '（固定）' : ''}
                      </button>
                      <div className="grid grid-cols-2 gap-1 text-xs">
                        <label className="col-span-2">名称<input className="w-full rounded border border-border bg-surface px-1" disabled={busy} value={item.name} onChange={e => updateItem(item.id, { name: e.target.value })} /></label>
                        <label>
                          宽（米）
                          <input
                            type="number"
                            step="0.01"
                            className="w-full rounded border border-border bg-surface px-1"
                            value={item.size_m[0]}
                            data-testid={`item-${item.id}-width`}
                            onChange={(e) =>
                              updateItem(item.id, {
                                size_m: [numOr(e.target.value, item.size_m[0]), item.size_m[1], item.size_m[2]],
                                dimensions_confirmed: false,
                              })
                            }
                          />
                        </label>
                        <label>
                          高（米）
                          <input
                            type="number"
                            step="0.01"
                            className="w-full rounded border border-border bg-surface px-1"
                            value={item.size_m[1]}
                            data-testid={`item-${item.id}-height`}
                            onChange={(e) =>
                              updateItem(item.id, {
                                size_m: [item.size_m[0], numOr(e.target.value, item.size_m[1]), item.size_m[2]],
                                dimensions_confirmed: false,
                              })
                            }
                          />
                        </label>
                        <label>
                          位置 X（米）
                          <input
                            type="number"
                            step="0.01"
                            className="w-full rounded border border-border bg-surface px-1"
                            value={item.position[0]}
                            data-testid={`item-${item.id}-x`}
                            onChange={(e) =>
                              updateItem(item.id, {
                                position: [numOr(e.target.value, item.position[0]), item.position[1], item.position[2]],
                              })
                            }
                          />
                        </label>
                        <label>
                          朝向
                          <input
                            type="number"
                            step="0.01"
                            className="w-full rounded border border-border bg-surface px-1"
                            value={item.rotation_y_rad}
                            data-testid={`item-${item.id}-yaw`}
                            onChange={(e) => updateItem(item.id, { rotation_y_rad: numOr(e.target.value, item.rotation_y_rad) })}
                          />
                        </label>
                      </div>
                      <div className="mt-1 grid grid-cols-2 gap-1 text-xs">
                        <label>深（米）<input className="w-full rounded border border-border bg-surface px-1" type="number" step="0.01" disabled={busy} value={item.size_m[2]} onChange={e => updateItem(item.id, { size_m: [item.size_m[0], item.size_m[1], numOr(e.target.value, item.size_m[2])] })} /></label>
                        {([1, 2] as const).map(axis => <label key={axis}>位置 {axis === 1 ? 'Y' : 'Z'}（米）<input className="w-full rounded border border-border bg-surface px-1" type="number" step="0.01" disabled={busy} value={item.position[axis]} onChange={e => { const position = [...item.position] as Item['position']; position[axis] = numOr(e.target.value, item.position[axis]); updateItem(item.id, { position }) }} /></label>)}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        尺寸来源：{item.dimensions_source} · 已确认：{item.dimensions_confirmed ? '是' : '否'}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">接口：{item.ports.length}</div>
                    </li>
                  ))}
                </ul>
              </details>
            </section>

            <section id="workflow-connect" className="min-w-0 rounded-lg border border-border bg-surface p-3" data-testid="step-connect">
              <h2 className="mb-2 text-sm font-semibold">3. 线缆</h2>
              <div className="grid gap-3">
                {draft.cables.map(cable => <div key={cable.id} className="min-w-0 rounded border border-border p-2" data-testid={`cable-${cable.id}`}>
                  <p className="mb-2 break-all text-xs font-medium">{cable.id}</p>
                  <div className="grid min-w-0 grid-cols-2 gap-2 text-xs">
                    {(['start_port_id', 'end_port_id'] as const).map((key, index) => <label key={key} className="min-w-0">
                      {index === 0 ? '起点' : '终点'}
                      <select className="mt-1 w-full min-w-0 rounded border border-border bg-surface p-1" disabled={busy}
                        value={cable[key]} data-testid={`cable-${cable.id}-${index === 0 ? 'start' : 'end'}`}
                        onChange={e => updateCable(cable.id, { [key]: e.target.value })}>
                        {draft.items.flatMap(item => item.ports.map(port => <option key={port.id} value={port.id}>{item.name} · {port.id}</option>))}
                      </select>
                    </label>)}
                    {([
                      ['length_m', 'length', '实际线长（米，未知可留空）'],
                      ['slack_m', 'slack', '余量（米）'],
                      ['diameter_m', 'diameter', '线径（米）'],
                      ['min_bend_radius_m', 'bend', '最小弯曲半径（米）'],
                    ] as const).map(([key, id, label]) => <label key={key} className="min-w-0">
                      {label}<input type="number" step="0.001" min="0" disabled={busy}
                        className="mt-1 w-full rounded border border-border bg-surface p-1" value={cable[key] ?? ''}
                        data-testid={`cable-${cable.id}-${id}`}
                        onChange={e => updateCable(cable.id, key === 'length_m'
                          ? { length_m: e.target.value === '' ? null : numOr(e.target.value, cable.length_m ?? 0) }
                          : { [key]: numOr(e.target.value, cable[key]) })} />
                    </label>)}
                    <label>策略<select className="mt-1 w-full rounded border border-border bg-surface p-1" disabled={busy}
                      value={cable.mode} data-testid={`cable-${cable.id}-mode`}
                      onChange={e => updateCable(cable.id, { mode: e.target.value as Cable['mode'] })}>
                      <option value="slot">穿线孔</option><option value="backboard">背板后</option>
                    </select></label>
                    <label>线材<select className="mt-1 w-full rounded border border-border bg-surface p-1" disabled={busy}
                      value={cable.thickness} onChange={e => updateCable(cable.id, { thickness: e.target.value as Cable['thickness'] })}>
                      <option value="thin">细线</option><option value="thick">粗线</option>
                    </select></label>
                  </div>
                </div>)}
              </div>
            </section>

            <section className="order-first rounded-lg border border-border bg-surface p-3" data-testid="step-actions">
              <div className="mb-2 flex flex-wrap gap-2">
                <Button size="sm" onClick={handleSave} disabled={busy || !dirty} data-testid="save-changes">
                  保存修改
                </Button>
                <Button size="sm" variant="outline" onClick={handleDiscard} disabled={busy || !dirty} data-testid="discard-changes">
                  放弃修改
                </Button>
              </div>
              {dirty ? <p className="mb-2 text-xs text-danger" data-testid="dirty-warning">存在未保存修改，已禁用规划操作</p> : null}
              <label className="mb-2 flex items-center gap-2 text-xs" data-testid="baseline-check-label">
                <input
                  type="checkbox"
                  checked={baselineChecked}
                  onChange={(e) => setBaselineChecked(e.target.checked)}
                  data-testid="baseline-check"
                />
                已核对物品尺寸、原始位置、接口与线长
              </label>
              <Button
                size="sm"
                variant="secondary"
                onClick={handleBaseline}
                disabled={busy || dirty || !baselineChecked}
                data-testid="confirm-baseline"
              >
                {doc?.baseline ? '重新确认并建立新基线' : '确认尺寸、接口和原始位置'}
              </Button>
              {doc?.baseline ? (
                <p className="mt-2 text-xs text-muted-foreground">重新确认会改变对比参考。</p>
              ) : null}
            </section>

            <section id="workflow-organize" className="rounded-lg border border-border bg-surface p-3" data-testid="step-organize">
              <h2 className="mb-2 text-sm font-semibold">2. 整理</h2>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={handlePacking} disabled={planningDisabled || !doc?.baseline} data-testid="run-packing">
                  生成整理建议
                </Button>
                <Button size="sm" variant="outline" onClick={handleViewPackingPreview} disabled={busy || !doc?.packing_result} data-testid="show-packing-preview">
                  查看整理建议
                </Button>
                <Button size="sm" variant="secondary" onClick={handleApply} disabled={planningDisabled || !showPreview || !previewResult || previewResult.status === 'infeasible'} data-testid="apply-packing">
                  接受整理建议
                </Button>
                <Button size="sm" variant="ghost" onClick={handleCancelPreview} disabled={!showPreview} data-testid="cancel-packing">
                  取消预览
                </Button>
              </div>
            </section>

            <section className="rounded-lg border border-border bg-surface p-3" data-testid="step-routing">
              <h2 className="mb-2 text-sm font-semibold">走线</h2>
              <Button size="sm" onClick={handleRouting} disabled={planningDisabled || !doc?.baseline} data-testid="run-routing">
                运行走线
              </Button>
              {doc?.routing_result ? (
                <table className="mt-2 w-full text-xs" data-testid="route-table">
                  <thead>
                    <tr>
                      <th>线缆</th>
                      <th>状态</th>
                      <th>长度m</th>
                      <th>原因</th>
                    </tr>
                  </thead>
                  <tbody>
                    {doc.routing_result.cables.map((c) => (
                      <tr key={c.id} data-testid={`route-${c.id}`}>
                        <td>{c.id}</td>
                        <td>{c.status}</td>
                        <td>{c.path_length_m?.toFixed(4) ?? '未知'}</td>
                        <td>{c.reason_code ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </section>

            <section id="workflow-guide" className="min-w-0 rounded-lg border border-border bg-surface p-3" data-testid="step-guide">
              <h2 className="mb-2 text-sm font-semibold">4. 指南</h2>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={handleGuide} disabled={planningDisabled || !doc?.baseline} data-testid="run-guide">
                  生成指南
                </Button>
                <Button size="sm" variant="outline" onClick={handleDownloadGuide} disabled={busy || !doc?.guide} data-testid="download-guide">
                  下载 Markdown
                </Button>
                <Button size="sm" variant="ghost" onClick={handleExport} data-testid="download-json">
                  下载 JSON
                </Button>
              </div>
              {doc?.guide && !dirty ? (
                <div>
                <p data-testid="guide-status" className="mt-2 text-sm font-medium">{doc.guide.status === 'complete' ? '当前指南已完成' : '当前指南未完成'}</p>
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-xs" data-testid="guide-text">
                  {doc.guide.markdown}
                </pre>
                </div>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">指南未完成</p>
              )}
            </section>

            {doc?.comparison ? (
              <section className="rounded-lg border border-border bg-surface p-3" data-testid="comparison">
                <h2 className="mb-2 text-sm font-semibold">对比（网格 {doc.comparison.area_grid_cell_m}m）</h2>
                <dl className="grid grid-cols-2 gap-1 text-xs">
                  <dt>基线面积</dt>
                  <dd>{doc.comparison.baseline_free_area_m2 ?? '未知'}</dd>
                  <dt>当前面积</dt>
                  <dd>{doc.comparison.current_free_area_m2}</dd>
                  <dt>基线走线</dt>
                  <dd>{doc.comparison.baseline_exposed_length_m ?? '未知'}</dd>
                  <dt>当前走线</dt>
                  <dd>{doc.comparison.current_exposed_length_m ?? '未知'}</dd>
                  <dt>未解决项</dt>
                  <dd>{doc.comparison.unresolved_issue_count}</dd>
                </dl>
                {doc.comparison.comparison_note ? (
                  <p className="mt-2 text-xs text-muted-foreground">{doc.comparison.comparison_note}</p>
                ) : null}
              </section>
            ) : null}

            <section className="rounded-lg border border-border bg-surface p-3" data-testid="step-photo">
              <h2 className="mb-2 text-sm font-semibold">照片参照</h2>
              <input
                ref={photoRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                data-testid="photo-input"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void handlePhoto(f)
                  e.target.value = ''
                }}
              />
              <Button size="sm" variant="outline" onClick={() => photoRef.current?.click()} disabled={busy} data-testid="upload-photo">
                上传照片
              </Button>
              {photoLocalUrl ? (
                <img src={photoLocalUrl} alt="本地预览" className="mt-2 max-h-40 rounded" data-testid="photo-local-preview" />
              ) : null}
              {doc?.photo_url ? (
                <img src={doc.photo_url} alt="服务器照片" className="mt-2 max-h-40 rounded" data-testid="photo-server-preview" />
              ) : null}
            </section>
          </aside>
        </main>
      )}
    </div>
  )
}

export default WorkflowPage
