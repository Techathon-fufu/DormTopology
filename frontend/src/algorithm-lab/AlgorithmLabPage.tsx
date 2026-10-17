import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Download, Upload, RotateCcw, Box, Scan, PanelTop, PanelBottom, AlertTriangle, ChevronRight } from 'lucide-react'
import { Button } from '@/ui/kit/button'
import { AlgorithmScene, cableColor, itemColors, supportColors, supportLabels, type Layers, type CameraView } from './AlgorithmScene'
import { parseBundle, parseManifest, type Bundle, type FixtureCase, type Issue, type Manifest, type PlanStatus, type Scene, type UndersideTrayOptimization } from './contract'
import './algorithm-lab.css'

const labels: Record<string, string> = {
  'packing-success': '整理 · 全部完成', 'packing-partial': '整理 · 部分完成',
  'packing-infeasible': '整理 · 不可行', 'packing-revision-2': '整理 · 版本 2',
  'routing-slot': '走线 · 穿线孔', 'routing-backboard': '走线 · 背板后',
  'routing-length-exceeded': '走线 · 线长不足', 'routing-endpoint-blocked': '走线 · 接口遮挡',
  'routing-supported-edge': '走线 · 桌面与孔边固定', 'routing-underdesk-ties': '走线 · 桌下扎带',
  'routing-underdesk-tray': '走线 · 桌下集线槽', 'routing-unsupported-span': '走线 · 悬空段过长',
  'routing-underdesk-composite': '走线 · 多线合流优化',
}
const statusLabels = { success: '全部完成', partial: '部分完成', infeasible: '不可行' }
const placementLabels = { placed: '已归位', unchanged: '保持原位', unplaced: '未收纳' }
const layerLabels: Record<keyof Layers, string> = { regions: '收纳区域', collisions: '碰撞体', network: '走线网络', cables: '线缆', reserved: '保留区域', supports: '固定与支撑', trayCandidates: '集线槽建议' }
const faceLabels = { x_min: '左侧面', x_max: '右侧面', y_min: '底面', y_max: '顶面', z_min: '后侧面', z_max: '前侧面' }
const trayStatusLabels = { recommended: '建议安装', verified: '已安装', not_used: '未采用' }
const trayReasonLabels = { no_compatible_routes: '没有可合并的走线', insufficient_width: '集线槽宽度不足', not_evaluated: '尚未评估' }
const format = (n: number | null | undefined, unit: string) => n == null ? '未知' : `${n.toFixed(4)} ${unit}`
const position = (p: number[]) => p.map(n => n.toFixed(3)).join(', ')

async function readJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return response.json()
}

function Status({ status, testId }: { status?: PlanStatus; testId: string }) {
  return <span data-testid={testId} className={`lab-status ${status ?? 'empty'}`}>
    {status ? <>{statusLabels[status]} <small>{status}</small></> : '未提供'}
  </span>
}

function saveJson(filename: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = filename; anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function AlgorithmLabPage() {
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [bundle, setBundle] = useState<Bundle | null>(null)
  const [caseId, setCaseId] = useState('packing-success')
  const [fixture, setFixture] = useState<FixtureCase | null>(null)
  const [phase, setPhase] = useState<'before' | 'after'>('after')
  const [layers, setLayers] = useState<Layers>({ regions: true, collisions: true, network: true, cables: true, reserved: true, supports: true, trayCandidates: true })
  const [selected, setSelected] = useState<string | null>(null)
  const [view, setView] = useState<CameraView>('perspective')
  const [reset, setReset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const pending = useRef<AbortController | null>(null)
  const lastFixture = useRef<FixtureCase | null>(null)
  const requestId = useRef(0)
  const onMove = useCallback((value: string) => { viewport.current?.setAttribute('data-camera-position', value) }, [])

  const loadFixture = useCallback(async (entry: FixtureCase) => {
    lastFixture.current = entry
    pending.current?.abort()
    const controller = new AbortController()
    pending.current = controller
    const id = ++requestId.current
    setLoading(true); setError(null)
    try {
      const [scene, packing, routing, applied] = await Promise.all([
        readJson(entry.scene_url, controller.signal),
        entry.packing_result_url ? readJson(entry.packing_result_url, controller.signal) : undefined,
        entry.routing_result_url ? readJson(entry.routing_result_url, controller.signal) : undefined,
        entry.applied_scene_url ? readJson(entry.applied_scene_url, controller.signal) : undefined,
      ])
      const next = parseBundle(scene, packing, routing, applied)
      if (requestId.current !== id) return
      setBundle(next); setCaseId(entry.id); setFixture(entry); setPhase('after'); setSelected(null)
    } catch (cause) {
      if (requestId.current === id && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (requestId.current === id) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    readJson('/algorithm-fixtures/manifest.json', controller.signal).then(parseManifest).then(next => {
      if (controller.signal.aborted) return
      setManifest(next)
      void loadFixture(next.cases[0])
    }).catch(cause => {
      if (!controller.signal.aborted) { setError(String(cause)); setLoading(false) }
    })
    return () => { controller.abort(); pending.current?.abort(); requestId.current++ }
  }, [loadFixture])

  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return
    pending.current?.abort()
    lastFixture.current = null
    const id = ++requestId.current
    setLoading(true); setError(null)
    try {
      const names = ['scene.json', 'packing_result.json', 'cable_routing.json', 'applied_scene.json']
      const payloads = new Map<string, unknown>()
      if (files.length > 4) throw new Error('最多导入 4 个 JSON 文件')
      for (const file of Array.from(files)) {
        if (!names.includes(file.name) || payloads.has(file.name)) throw new Error(`不支持或重复的文件名：${file.name}`)
        if (file.size > 8 * 1024 * 1024) throw new Error(`${file.name} 超过 8 MB`)
        payloads.set(file.name, JSON.parse(await file.text()))
      }
      if (!payloads.has('scene.json')) throw new Error('缺少 scene.json')
      const next = parseBundle(payloads.get('scene.json'), payloads.get('packing_result.json'), payloads.get('cable_routing.json'), payloads.get('applied_scene.json'))
      if (requestId.current !== id) return
      setBundle(next); setFixture(null); setCaseId('imported'); setPhase('after'); setSelected(null)
    } catch (cause) {
      if (requestId.current === id) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (requestId.current === id) setLoading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const after = useMemo<Scene | null>(() => {
    if (!bundle) return null
    if (bundle.routingScene) return bundle.routingScene
    if (!bundle.packingResult || bundle.packingResult.status === 'infeasible') return bundle.scene
    const targets = new Map(bundle.packingResult.items.map(item => [item.item_id, item]))
    return { ...bundle.scene, items: bundle.scene.items.map(item => ({ ...item,
      position: targets.get(item.id)!.target_pos, rotation_y_rad: targets.get(item.id)!.target_rotation_y_rad,
    })) }
  }, [bundle])
  const shown = phase === 'before' ? bundle?.scene : after
  const isUnappliedPreview = phase === 'after' && bundle?.packingResult
    && bundle.packingResult.status !== 'infeasible' && !bundle.routingScene
  const routeVisible = !isUnappliedPreview && bundle?.routingResult?.scene_revision === shown?.scene_revision
    ? bundle?.routingResult : undefined
  const item = shown?.items.find(current => current.id === selected)
  const support = shown?.routing_graph.supports?.find(current => current.id === selected)
  const trayCandidate = shown?.routing_graph.tray_candidates?.find(current => current.id === selected)
  const supports = shown?.routing_graph.supports ?? []
  const supportPolicy = shown?.routing_graph.support_policy
  const resultItem = bundle?.packingResult?.items.find(current => current.item_id === selected)
  const issues: Issue[] = [...(bundle?.packingResult?.issues ?? []), ...(bundle?.routingResult?.issues ?? [])]
  const packing = bundle?.packingResult
  const routing = bundle?.routingResult
  const trayOptimizations: UndersideTrayOptimization[] = routing?.underside_tray_optimizations ?? []

  return <main className="algorithm-lab">
    <header className="lab-header">
      <Link to="/" className="lab-back" title="返回项目" aria-label="返回项目"><ArrowLeft size={18} /></Link>
      <div className="lab-title"><h1>DormTopology <span>算法验证</span></h1><p>{bundle?.scene.scene_id ?? '加载场景'} <span>· 领域算法 JSON</span></p></div>
      <div className="lab-header-actions">
        <input ref={fileInput} type="file" accept=".json,application/json" multiple hidden onChange={event => void importFiles(event.target.files)} />
        <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}><Upload size={14} />导入 JSON</Button>
        <Button variant="outline" size="sm" disabled={!bundle} onClick={() => saveJson('scene.json', bundle!.scene)}><Download size={14} />导出场景</Button>
      </div>
    </header>
    <div className="lab-controls">
      <label className="lab-case-label">测试场景<select aria-label="测试场景" value={caseId} disabled={!manifest || loading}
        onChange={event => { const entry = manifest?.cases.find(current => current.id === event.target.value); if (entry) void loadFixture(entry) }}>
        {manifest?.cases.map(entry => <option key={entry.id} value={entry.id}>{labels[entry.id] ?? entry.label}</option>)}
        {caseId === 'imported' && <option value="imported">本地导入</option>}
      </select></label>
      <div className="lab-segment" aria-label="布局阶段">
        <button aria-pressed={phase === 'before'} onClick={() => setPhase('before')} disabled={!packing}>整理前</button>
        <button aria-pressed={phase === 'after'} onClick={() => setPhase('after')} disabled={!packing}>整理后</button>
      </div>
      <span className="lab-revision">输入 v{bundle?.scene.scene_revision ?? '—'}<ChevronRight size={13} />{bundle?.routingScene ? '模拟应用' : packing ? '建议预览' : '走线场景'} v{shown?.scene_revision ?? '—'}</span>
      {loading && <span role="status" className="lab-loading">加载中…</span>}
    </div>
    {error && <div role="alert" className="lab-error"><AlertTriangle size={16} /><span>{error}</span><button onClick={() => {
      if (lastFixture.current) void loadFixture(lastFixture.current)
      else if (!manifest) window.location.reload()
      else fileInput.current?.click()
    }}>重试</button></div>}
    <div className="lab-body">
      <section className="lab-visual">
        <div className="lab-layer-bar">{(Object.keys(layerLabels) as (keyof Layers)[]).map(key => <label key={key}>
          <input type="checkbox" checked={layers[key]} onChange={event => setLayers(current => ({ ...current, [key]: event.target.checked }))} />{layerLabels[key]}
        </label>)}</div>
        <div ref={viewport} className="lab-viewport" data-testid="algorithm-viewport" data-case-id={caseId} data-phase={phase} data-scene-revision={shown?.scene_revision}
          data-camera-view={view}
          data-rendered-cables={layers.cables ? routeVisible?.cables.filter(cable => cable.status === 'valid').length ?? 0 : 0}
          data-rendered-supports={layers.supports ? supports.length : 0}
          data-rendered-tray-candidates={layers.trayCandidates ? shown?.routing_graph.tray_candidates?.length ?? 0 : 0} aria-label="算法三维场景">
          {shown && <AlgorithmScene scene={shown} routing={routeVisible} layers={layers} selected={selected} onSelect={setSelected} view={view} reset={reset} onMove={onMove} />}
          <div className="lab-camera-tools">
            {([{ id: 'perspective', label: '透视图', Icon: Box }, { id: 'top', label: '俯视图', Icon: Scan }, { id: 'front', label: '正视图', Icon: PanelTop }, { id: 'underside', label: '桌底视图', Icon: PanelBottom }] as const).map(({ id, label, Icon }) =>
              <button key={id} title={label} aria-label={label} aria-pressed={view === id} onClick={() => setView(id)}><Icon size={17} /></button>)}
            <button title="重置视角" aria-label="重置视角" onClick={() => setReset(n => n + 1)}><RotateCcw size={17} /></button>
          </div>
          <div className="lab-viewport-caption"><span>{labels[caseId] ?? '本地导入'} · {phase === 'before' ? '输入场景' : packing?.status === 'infeasible' ? '保持原位' : '结果场景'}</span><span>m · Y ↑</span></div>
        </div>
        <div className="lab-metrics">
          <div><span>连续可用面积 · 前</span><strong>{format(fixture?.metrics?.before_free_area_m2, 'm²')}</strong></div>
          <div><span>连续可用面积 · 后</span><strong>{format(fixture?.metrics?.after_free_area_m2, 'm²')}</strong></div>
          <div><span>有效路径暴露线长</span><strong>{format(routing?.metrics.exposed_length_m, 'm')}</strong></div>
          <div><span>原始暴露线长</span><strong>{format(routing?.metrics.baseline_exposed_length_m, 'm')}</strong></div>
        </div>
      </section>
      <aside className="lab-sidebar">
        <section className="lab-section">
          <div className="lab-section-title"><h2>算法结果</h2><span>{shown?.items.length ?? 0} 件 · {shown?.cables.length ?? 0} 根线</span></div>
          <div className="lab-result-row"><span>物品整理</span><Status status={packing?.status} testId="packing-status" />
            <button title="导出整理结果" aria-label="导出整理结果" disabled={!packing} onClick={() => saveJson('packing_result.json', packing)}><Download size={15} /></button></div>
          <div className="lab-result-row"><span>线缆走线</span><Status status={routing?.status} testId="routing-status" />
            <button title="导出走线结果" aria-label="导出走线结果" disabled={!routing} onClick={() => saveJson('cable_routing.json', routing)}><Download size={15} /></button></div>
          {bundle?.routingScene && <div className="lab-result-row lab-subtle"><span>模拟应用 v{bundle.routingScene.scene_revision}</span><button title="导出应用场景" aria-label="导出应用场景" onClick={() => saveJson('applied_scene.json', bundle.routingScene)}><Download size={15} /></button></div>}
        </section>
        <section className="lab-section" data-testid="issues">
          <div className="lab-section-title"><h2>问题</h2><span>{issues.length}</span></div>
          {issues.length ? <ul className="lab-issues">{issues.map((issue, index) => <li key={`${issue.entity_id}-${issue.code}-${index}`}>
            <button disabled={!shown?.items.some(current => current.id === issue.entity_id)} onClick={() => setSelected(issue.entity_id)}>{issue.entity_id ?? '场景'}<code>{issue.code}</code></button>
            <p>{issue.message}</p>
          </li>)}</ul> : <p className="lab-empty">{bundle ? '无报告问题' : '等待场景'}</p>}
        </section>
        <section className="lab-section">
          <div className="lab-section-title"><h2>物品</h2><span>{shown?.items.length ?? 0}</span></div>
          <div className="lab-item-list" data-testid="item-list">{shown?.items.map((current, index) => {
            const target = packing?.items.find(value => value.item_id === current.id)
            return <button key={current.id} aria-pressed={selected === current.id} onClick={() => setSelected(current.id)}>
              <i style={{ background: itemColors[index % itemColors.length] }} /><span>{current.name}<small>{current.id}</small></span>
              <em className={target?.placement_status === 'unplaced' ? 'lab-unplaced' : ''}>{target ? placementLabels[target.placement_status] : current.fixed ? '固定' : '可移动'}</em>
            </button>
          })}</div>
        </section>
        <section className="lab-section" data-testid="inspector">
          <div className="lab-section-title"><h2>{trayCandidate ? '集线槽建议详情' : support ? '支撑详情' : '物品详情'}</h2><span>{item?.fixed ? '固定物品' : trayCandidate ? '待安装' : ''}</span></div>
          {item ? <><p className="lab-detail-name">{item.name} <code>{item.id}</code></p><dl className="lab-details">
            <dt>底面中心 (m)</dt><dd>{position(item.position)}</dd><dt>尺寸 (m)</dt><dd>{position(item.size_m)}</dd>
            <dt>绕 Y 轴 (rad)</dt><dd>{item.rotation_y_rad.toFixed(4)}</dd><dt>目标区域</dt><dd>{resultItem?.target_region_id ?? '—'}</dd>
            <dt>接口</dt><dd>{item.ports.length}</dd>
          </dl></> : support ? <><p className="lab-detail-name">{supportLabels[support.kind]} <code>{support.id}</code></p><dl className="lab-details">
            <dt>安装物体</dt><dd>{support.obstacle_id}</dd><dt>安装面</dt><dd>{faceLabels[support.face]} · {support.face}</dd>
            <dt>面内范围 (m)</dt><dd>{position(support.bounds_uv_m)}</dd><dt>离面距离 (m)</dt><dd>{support.stand_off_m.toFixed(4)}</dd>
          </dl></> : trayCandidate ? <><p className="lab-detail-name">待安装集线槽 <code>{trayCandidate.id}</code></p><dl className="lab-details">
            <dt>安装物体</dt><dd>{trayCandidate.obstacle_id}</dd><dt>安装面</dt><dd>{faceLabels[trayCandidate.face]} · {trayCandidate.face}</dd>
            <dt>面内范围 (m)</dt><dd>{position(trayCandidate.bounds_uv_m)}</dd><dt>离面距离 (m)</dt><dd>{trayCandidate.stand_off_m.toFixed(4)}</dd>
            <dt>候选线缆</dt><dd>{trayCandidate.cable_ids.join(', ')}</dd>
          </dl></> : <p className="lab-empty">未选择物品</p>}
        </section>
        <section className="lab-section" data-testid="support-panel">
          <div className="lab-section-title"><h2>固定与支撑</h2><span>{supports.length}</span></div>
          <p className="lab-support-policy" data-testid="support-policy">{supportPolicy
            ? <>悬空段上限 <strong>{format(supportPolicy.max_unsupported_span_m, 'm')}</strong></>
            : '未配置支撑检查'}</p>
          {supports.length ? <div className="lab-support-list">{supports.map(current => <button key={current.id}
            aria-pressed={selected === current.id} onClick={() => setSelected(current.id)}>
            <i style={{ background: supportColors[current.kind] }} />
            <span>{supportLabels[current.kind]}<small>{current.id}</small></span>
            <em>{faceLabels[current.face]}</em>
          </button>)}</div> : <p className="lab-empty">无支撑记录</p>}
        </section>
        <section className="lab-section">
          <div className="lab-section-title"><h2>线缆详情</h2><span>v{routing?.scene_revision ?? '—'}</span></div>
          {routing?.cables.map(cable => <div className="lab-cable-detail" key={cable.id}><strong><i data-testid={`cable-color-${cable.id}`} style={{ backgroundColor: cableColor(cable.id) }} />{cable.id}</strong><span className={cable.status === 'failed' ? 'lab-unplaced' : ''}>{cable.status}</span>
            <p>{cable.mode} · {format(cable.path_length_m, 'm')} · {cable.reason_code ?? `${cable.path_points.length} 采样点`}</p>
            <p data-testid={`support-check-${cable.id}`} className={cable.support_check?.status === 'verified' ? 'lab-support-verified' : ''}>
              {cable.support_check?.status === 'verified'
                ? `支撑已复查 · 悬空段上界 ${format(cable.support_check.max_unsupported_span_m, 'm')}`
                : '支撑未评估'}
            </p>
            {!!cable.support_check?.support_ids.length && <div className="lab-cable-supports">
              {cable.support_check.support_ids.map(id => <button key={id} onClick={() => setSelected(id)}>{id}</button>)}
            </div>}
          </div>)}
        </section>
        {routing?.underside_tray_optimizations !== undefined && <section className="lab-section" data-testid="tray-optimization-panel">
          <div className="lab-section-title"><h2>桌下集线槽优化</h2><span>{trayOptimizations.length} 组</span></div>
          {trayOptimizations.length ? <div className="lab-tray-list">{trayOptimizations.map((optimization) => {
            const support = optimization.support_id ? supports.find(current => current.id === optimization.support_id) : undefined
            const candidate = shown?.routing_graph.tray_candidates?.find(current => current.id === optimization.id
              || !!optimization.mount && current.obstacle_id === optimization.mount.obstacle_id
                && current.face === optimization.mount.face && current.stand_off_m === optimization.mount.stand_off_m
                && current.bounds_uv_m.every((value, index) => value === optimization.mount!.bounds_uv_m[index]))
            return <div className="lab-tray-group" key={optimization.id} data-testid={`tray-group-${optimization.id}`}>
              <div className="lab-tray-heading"><strong>{optimization.id}</strong><span className={`lab-tray-status ${optimization.status}`}>{trayStatusLabels[optimization.status]}</span></div>
              <p>{optimization.cable_ids.length} 根线 · 合并段 {format(optimization.shared_length_m, 'm')}</p>
              <p>占用宽度 {format(optimization.occupied_width_m, 'm')} · 可用 {format(optimization.available_width_m, 'm')}</p>
              <p className="lab-tray-cables">{optimization.cable_ids.join(' · ') || '无可合并线缆'}</p>
              {support ? <button className="lab-tray-support" onClick={() => setSelected(support.id)}>查看集线槽 · {support.id}</button>
                : optimization.support_id ? <p className="lab-subtle">集线槽候选 · {optimization.support_id}</p> : null}
              {candidate && <button className="lab-tray-support" onClick={() => setSelected(candidate.id)}>查看安装建议 · {candidate.id}</button>}
              {optimization.mount && <p className="lab-subtle">安装位置 · {optimization.mount.obstacle_id} · {faceLabels[optimization.mount.face]}</p>}
              {optimization.status === 'recommended' && optimization.requires_installation && <p className="lab-tray-note">需要安装后才可作为机械支撑</p>}
              {optimization.reason_code && <p className="lab-tray-reason">{trayReasonLabels[optimization.reason_code]}</p>}
            </div>
          })}</div> : <p className="lab-empty">没有可合并的线缆</p>}
        </section>}
      </aside>
    </div>
  </main>
}
