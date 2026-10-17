import { useEffect, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { Grid, Line, OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { DormDeskModel } from '@/scene/DormDeskModel'
import { ObjectModel } from '@/scene/ObjectModel'
import { mapRoutingResult } from '@/api/core/routingWire'
import type { PackingScene } from '@/api/core/packingWire'
import type { Project, Vec3 } from '@/types/project'
import { useDeskModelStore } from '@/state/deskModelStore'
import './routing-demo.css'

const COLORS = ['#eab308', '#ef4444', '#3b82f6', '#8b5cf6', '#14b8a6', '#f97316', '#ec4899']
const VIEWS = { front: [2.1, 1.9, 2.8], rear: [-1.3, 1.45, -2.1], top: [.2, 3.7, .35] } satisfies Record<string, Vec3>
type View = keyof typeof VIEWS

function Camera({ view }: { view: View }) {
  const { camera } = useThree()
  const controls = useRef<OrbitControlsImpl>(null)
  useEffect(() => {
    camera.position.set(...VIEWS[view])
    controls.current?.target.set(.2, .75, .25)
    controls.current?.update()
  }, [camera, view])
  return <OrbitControls ref={controls} makeDefault minDistance={.35} maxDistance={6} target={[.2, .75, .25]} />
}

export function RoutingDemoPage() {
  const [project, setProject] = useState<Project | null>(null)
  const [error, setError] = useState('')
  const [view, setView] = useState<View>('front')
  const [selected, setSelected] = useState<string | null>(null)
  const [showFurniture, setShowFurniture] = useState(true)
  const [showObjects, setShowObjects] = useState(true)
  const [showBed, setShowBed] = useState(false)
  const modelStatus = useDeskModelStore(s => s.status)
  useEffect(() => {
    const controller = new AbortController()
    fetch(`${import.meta.env.BASE_URL}routing-demo/fixed-desk.json`, { signal: controller.signal })
      .then(r => { if (!r.ok) throw new Error(`演示数据加载失败 (${r.status})`); return r.json() })
      .then((data: { project: Project; scene: PackingScene; result: unknown }) => {
        const mapped = mapRoutingResult(data.result, { project: data.project, scene: data.scene })
        setProject({ ...data.project, cables: mapped.cables })
      }).catch(e => { if (!controller.signal.aborted) setError(String(e)) })
    return () => controller.abort()
  }, [])
  if (!project) return <main className="routing-demo"><p role="status">{error || '正在加载正式桌体走线结果…'}</p></main>
  const valid = project.cables.filter(c => c.route.verification?.status === 'valid').length
  return <main className="routing-demo">
    <header><div><span className="routing-demo-eyebrow">DORMTOPOLOGY · ROUTING STUDY</span><h1>沿边走线，桌后收拢</h1>
      <p>使用 main 的正式桌体与三个抽屉模型。直线段连接，主体沿轴向转直角；旋转设备只保留短的接口法向出线。</p></div>
      <div className="routing-demo-total"><strong>{valid} / {project.cables.length}</strong><span>几何与连接校验通过</span></div></header>
    <section className="routing-demo-body">
      <div className="routing-demo-view">
        <nav aria-label="观察视角">{([['front', '正面'], ['rear', '背面'], ['top', '俯视']] as const).map(([key, label]) =>
          <button key={key} aria-pressed={view === key} onClick={() => setView(key)}>{label}</button>)}</nav>
        <Canvas camera={{ position: VIEWS.front, fov: 42, near: .01, far: 30 }} dpr={[1, 2]}>
          <color attach="background" args={['#eef2f3']} />
          <ambientLight intensity={1.7} /><directionalLight position={[3, 5, 4]} intensity={2.3} />
          <directionalLight position={[-2, 2, -3]} intensity={1.5} />
          <DormDeskModel room={project.room} respectToolbar={false} hideBedParts={!showBed} visible={showFurniture} />
          {showObjects && project.objects.map(object => <group key={object.id}
            position={[object.transform.position[0], object.transform.position[1] + object.dimensions.height / 2, object.transform.position[2]]}
            rotation={[0, object.transform.rotationY, 0]}>
            <ObjectModel object={object} shape={object.model.shape} color="#c9d5d5" />
          </group>)}
          {project.cables.map((cable, index) => cable.route.verification?.status === 'valid' && (!selected || selected === cable.id) &&
            <Line key={cable.id} points={cable.route.points} color={COLORS[index % COLORS.length]} lineWidth={selected ? 4 : 2.5} />)}
          <Grid args={[6, 6]} position={[0, -.015, .3]} cellSize={.1} sectionSize={.5} fadeDistance={7} cellColor="#d5dddd" sectionColor="#bacaca" />
          <Camera view={view} />
        </Canvas>
        <div className="routing-demo-model" role="status">{modelStatus === 'loaded' ? '正式 GLB 已加载 · 桌体 + 3 个抽屉' :
          <>模型状态：{modelStatus} <button onClick={() => useDeskModelStore.getState().retry()}>加载正式模型</button></>}</div>
      </div>
      <aside>
        <h2>线路 <button onClick={() => setSelected(null)} aria-pressed={!selected}>显示全部</button></h2>
        <p>点选一根线，再切到背面检查。拖动旋转，滚轮缩放。</p>
        <div className="routing-demo-cables">{project.cables.map((cable, index) => {
          const name = (id: string) => project.objects.find(o => o.id === id)?.name ?? id
          return <button key={cable.id} aria-pressed={selected === cable.id} onClick={() => setSelected(selected === cable.id ? null : cable.id)}>
            <i style={{ background: COLORS[index % COLORS.length] }} /><span><strong>{name(cable.from.objectId)} → {name(cable.to.objectId)}</strong>
              <small>{cable.route.strategy === 'backboard' ? '背板后走线' : '穿孔走线'} · {cable.route.pathLengthM?.toFixed(2) ?? '—'} m</small></span>
          </button>
        })}</div>
        <fieldset><legend>观察图层</legend>
          <label><input type="checkbox" checked={showFurniture} onChange={e => setShowFurniture(e.target.checked)} />显示桌体</label>
          <label><input type="checkbox" checked={showObjects} onChange={e => setShowObjects(e.target.checked)} />显示设备</label>
          <label><input type="checkbox" checked={showBed} onChange={e => setShowBed(e.target.checked)} />显示上铺床体</label>
        </fieldset>
        <p className="routing-demo-note">Python 算法离线计算的可复现结果，非实时 API。17 件物品、7 根线；不含插排总线。隐藏图层仅影响观察，碰撞计算仍包含完整家具。长度为所需路径长度，安装支撑尚未复核。</p>
        <a href={`${import.meta.env.BASE_URL}routing-demo/fixed-desk.json`} download>下载输入和验证结果 JSON</a>
      </aside>
    </section>
  </main>
}
