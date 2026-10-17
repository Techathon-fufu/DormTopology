import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { PerspectiveCamera, Vector3 } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { Project, SceneObject } from '@/types/project'
import { ObjectModel } from '@/scene/ObjectModel'
import { resolvePortOffset } from '@/scene/ports'
import { detectWebGL } from '@/lib/webgl'
import { Button } from '@/ui/kit/button'
import { useSurfacePortPick } from './useSurfacePortPick'
import { SurfacePointOverlay } from './SurfacePointOverlay'
import { useConnectionsStore } from './store'

type View = 'reset' | 'front' | 'back' | 'top'
const views: { id: View; label: string }[] = [
  { id: 'reset', label: '重置视角' }, { id: 'front', label: '正面' },
  { id: 'back', label: '背面' }, { id: 'top', label: '顶面' },
]

class ModelErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) return <div role="alert" className="p-6 text-sm">
      模型视图加载失败。<Button variant="outline" onClick={() => this.setState({ failed: false })}>重试</Button>
    </div>
    return this.props.children
  }
}

function ModelCamera({ object, view, nonce }: { object: SceneObject; view: View; nonce: number }) {
  const camera = useThree((state) => state.camera)
  const size = useThree((state) => state.size)
  const controls = useRef<OrbitControlsImpl>(null)
  const { width, height, depth } = object.dimensions
  const radius = Math.max(.005, Math.hypot(width, height, depth) / 2)
  useEffect(() => {
    if (!(camera instanceof PerspectiveCamera)) return
    const target = new Vector3(0, height / 2, 0)
    const halfFov = camera.fov * Math.PI / 360
    const aspect = size.width / Math.max(1, size.height)
    const limitingFov = Math.min(halfFov, Math.atan(Math.tan(halfFov) * aspect))
    const distance = radius / Math.sin(limitingFov) * 1.25
    const direction = view === 'front' ? new Vector3(0, 0, 1)
      : view === 'back' ? new Vector3(0, 0, -1)
      : view === 'top' ? new Vector3(0, 1, .001) : new Vector3(.9, .65, 1)
    camera.position.copy(target).addScaledVector(direction.normalize(), distance)
    camera.near = Math.max(.0001, radius / 100)
    camera.far = Math.max(10, radius * 100)
    camera.lookAt(target)
    camera.updateProjectionMatrix()
    controls.current?.target.copy(target)
    controls.current?.update()
  }, [camera, radius, height, size.width, size.height, view, nonce])
  return <OrbitControls ref={controls} makeDefault enablePan enableDamping dampingFactor={.12}
    minDistance={radius * .3} maxDistance={radius * 20} maxPolarAngle={Math.PI} />
}

function ModelScene({ project, object, view, nonce }: { project: Project; object: SceneObject; view: View; nonce: number }) {
  // Only the display copy is recentered. A hit on it is already in the item's bottom-origin local coordinates.
  const display = useMemo<SceneObject>(() => ({ ...object, visible: true,
    transform: { position: [0, 0, 0], rotationY: 0 },
  }), [object])
  const displayProject = useMemo(() => ({ ...project, objects: [display] }), [project, display])
  const pick = useSurfacePortPick(displayProject, display, true)
  const markerRadius = Math.max(.001, Math.max(object.dimensions.width, object.dimensions.height, object.dimensions.depth) * .018)
  return <>
    <color attach="background" args={['#edf2f1']} />
    <ambientLight intensity={1.1} />
    <hemisphereLight intensity={1.2} groundColor="#83938f" />
    <directionalLight position={[4, 6, 5]} intensity={2} />
    <directionalLight position={[-3, 2, -4]} intensity={1} />
    <group name="isolated-model" userData={{ objectId: object.id }}>
      <group position={[0, object.dimensions.height / 2, 0]}
        onPointerDown={pick.onPointerDown} onPointerMove={pick.onPointerMove}
        onPointerUp={pick.onPointerUp} onPointerOut={pick.onPointerOut} onPointerCancel={pick.onPointerCancel}>
        <ObjectModel object={display} shape={display.model.shape} color="#687681" sockets={display.powerStrip?.socketCount} />
      </group>
      {object.ports.map((port) => <mesh key={port.id} name="isolated-port" userData={{ portId: port.id }}
        position={resolvePortOffset(display, port)} raycast={() => {}} renderOrder={5}>
        <sphereGeometry args={[markerRadius, 16, 12]} />
        <meshBasicMaterial color={port.confirmed ? '#0F9D8A' : '#E5A332'} depthTest={false} />
      </mesh>)}
    </group>
    <SurfacePointOverlay project={displayProject} markerScale={markerRadius / .009} />
    <ModelCamera object={display} view={view} nonce={nonce} />
  </>
}

export function IsolatedModelViewport({ project, object }: { project: Project; object: SceneObject }) {
  const supported = useMemo(detectWebGL, [])
  const [view, setView] = useState<View>('reset')
  const [nonce, setNonce] = useState(0)
  const picking = useConnectionsStore((state) => state.projectId === project.id && state.pickingObjectId === object.id)
  if (!supported) return <p role="alert" className="p-6 text-sm">当前环境不支持 WebGL，无法显示模型。请开启浏览器硬件加速后重试。</p>
  return <div className="relative h-full w-full" aria-label="单模型视图" onContextMenu={(event) => event.preventDefault()}>
    <ModelErrorBoundary>
      <Canvas camera={{ position: [1, 1, 2], fov: 42 }} dpr={[1, 2]}>
        <ModelScene project={project} object={object} view={view} nonce={nonce} />
      </Canvas>
    </ModelErrorBoundary>
    <div className="absolute left-3 top-3 flex flex-wrap gap-1 rounded-lg border border-border bg-surface/95 p-1 shadow-sm" role="group" aria-label="模型视角">
      {views.map((entry) => <Button key={entry.id} size="sm" variant={view === entry.id ? 'secondary' : 'ghost'}
        onClick={() => { setView(entry.id); setNonce((value) => value + 1) }}>{entry.label}</Button>)}
    </div>
    <p className="pointer-events-none absolute bottom-3 left-3 right-3 rounded-lg bg-surface/90 px-3 py-2 text-center text-xs text-muted-foreground">
      {picking ? '点击模型表面标记接线点 · ' : ''}拖动旋转 · 滚轮缩放
    </p>
  </div>
}
