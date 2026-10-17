import {
  Component,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { MonitorOff } from 'lucide-react'
import type { CableConnection, Project, SceneObject } from '@/types/project'
import { CABLE_KIND_META } from '@/types/project'
import { hasUsableCableRoute } from '@/scene/cables'
import { cablePathSamples, createCableTube } from '@/scene/cableGeometry'
import { CATEGORY_COLORS, PrimitiveModel } from '@/scene/models'
import { RoomShell } from '@/scene/RoomShell'
import { basicMaterial, ringGeometry } from '@/scene/resources'
import { detectWebGL } from '@/lib/webgl'
import { Button } from '@/ui/kit/button'
import type { StepTarget } from '@/lib/guide'

/**
 * 方案交付页的三维视图（只读）。
 * - 俯视 / 透视两个机位，支持拖拽旋转与滚轮缩放；
 * - 点击物品或线缆高亮（也可由步骤列表触发）；
 * - 通过 captureRef 暴露「渲染一帧并导出 PNG dataURL」，用于页面截图与打印版式。
 */

export type GuideView = 'top' | 'persp'

export interface ViewportCaptureHandle {
  /** 渲染一帧并返回 PNG dataURL（失败返回 null） */
  capture: () => string | null
}

const VIEW_PRESETS: Record<
  GuideView,
  { position: [number, number, number]; target: [number, number, number] }
> = {
  top: { position: [0, 2.7, 0.5], target: [0, 0.75, 0.45] },
  persp: { position: [1.35, 1.2, 1.9], target: [0, 0.78, 0.35] },
}

class SceneErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state: { error: string | null } = { error: null }

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) }
  }

  render() {
    if (this.state.error !== null) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 bg-muted/40 p-6 text-center">
          <MonitorOff className="h-8 w-8 text-faint" />
          <p className="text-sm font-medium">三维视图渲染失败</p>
          <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
            {this.state.error}
            <br />
            你仍可阅读并执行下方的整理与走线步骤；导出 JSON 不受影响。
          </p>
          <Button size="sm" onClick={() => this.setState({ error: null })}>
            重试渲染
          </Button>
        </div>
      )
    }
    return this.props.children
  }
}

/** 机位切换（俯视 / 透视） */
function GuideCamera({ view }: { view: GuideView }) {
  const camera = useThree((s) => s.camera)
  const controls = useRef<OrbitControlsImpl | null>(null)

  useEffect(() => {
    const preset = VIEW_PRESETS[view]
    camera.position.set(preset.position[0], preset.position[1], preset.position[2])
    controls.current?.target.set(preset.target[0], preset.target[1], preset.target[2])
    controls.current?.update()
  }, [camera, view])

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      target={VIEW_PRESETS.persp.target}
      minDistance={0.6}
      maxDistance={7}
      maxPolarAngle={Math.PI / 2.02}
    />
  )
}

function DeliverObjectMesh({
  object,
  focused,
  onFocus,
}: {
  object: SceneObject
  focused: boolean
  onFocus: (target: StepTarget | null) => void
}) {
  const [hover, setHover] = useState(false)
  const { position, rotationY } = object.transform
  const { width: w, height: h, depth: d } = object.dimensions
  const color = CATEGORY_COLORS[object.category]

  useEffect(
    () => () => {
      document.body.style.cursor = ''
    },
    [],
  )

  return (
    <group
      position={[position[0], position[1], position[2]]}
      rotation={[0, rotationY, 0]}
      onClick={(e) => {
        e.stopPropagation()
        onFocus({ type: 'object', id: object.id })
      }}
      onPointerOver={(e) => {
        e.stopPropagation()
        setHover(true)
        document.body.style.cursor = 'pointer'
      }}
      onPointerOut={() => {
        setHover(false)
        document.body.style.cursor = ''
      }}
    >
      <group position={[0, h / 2, 0]}>
        <PrimitiveModel
          shape={object.model.shape}
          dims={object.dimensions}
          color={color}
          sockets={object.powerStrip?.socketCount}
        />
      </group>
      {focused || hover ? (
        <mesh position={[0, h / 2, 0]}>
          <boxGeometry args={[w + 0.01, h + 0.01, d + 0.01]} />
          <meshBasicMaterial color="#0F9D8A" wireframe transparent opacity={focused ? 0.7 : 0.32} />
        </mesh>
      ) : null}
      {focused ? (
        <mesh
          position={[0, 0.004, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          geometry={ringGeometry(
            Math.max(w, d) / 2 + 0.035,
            Math.max(w, d) / 2 + 0.06,
            40,
          )}
          material={basicMaterial('#0F9D8A', { opacity: 0.85, doubleSide: true })}
        />
      ) : null}
    </group>
  )
}

function DeliverCableMesh({
  cable,
  objects,
  focused,
  dimmed,
  onFocus,
}: {
  cable: CableConnection
  objects: SceneObject[]
  focused: boolean
  dimmed: boolean
  onFocus: (target: StepTarget | null) => void
}) {
  const samples = useMemo(
    () => cablePathSamples(cable, objects),
    [cable, objects],
  )
  const geometry = useMemo(() => {
    return createCableTube(samples, focused ? 0.0075 : 0.005, 8)
  }, [samples, focused])

  useEffect(
    () => () => {
      geometry?.dispose()
    },
    [geometry],
  )

  if (!geometry || samples.length < 2) return null
  const color = CABLE_KIND_META[cable.kind].color
  const first = samples[0]
  const last = samples[samples.length - 1]

  return (
    <group
      onClick={(e) => {
        e.stopPropagation()
        onFocus({ type: 'cable', id: cable.id })
      }}
      onPointerOver={(e) => {
        e.stopPropagation()
        document.body.style.cursor = 'pointer'
      }}
      onPointerOut={() => {
        document.body.style.cursor = ''
      }}
    >
      <mesh geometry={geometry}>
        <meshBasicMaterial color={color} transparent opacity={dimmed ? 0.16 : 1} />
      </mesh>
      {focused ? (
        <>
          {[first, last].map((p, i) => (
            <group key={i} position={[p[0], p[1], p[2]]}>
              <mesh>
                <sphereGeometry args={[0.0135, 16, 12]} />
                <meshBasicMaterial color="#FFFFFF" transparent opacity={0.9} />
              </mesh>
              <mesh>
                <sphereGeometry args={[0.0095, 16, 12]} />
                <meshBasicMaterial color={color} />
              </mesh>
            </group>
          ))}
        </>
      ) : null}
    </group>
  )
}

/** 高亮某对象 / 线缆时，其余线缆降透明：对象高亮时保留其两端线缆，线缆高亮时仅保留自身 */
function isCableDimmed(cable: CableConnection, focus: StepTarget | null): boolean {
  if (!focus) return false
  if (focus.type === 'cable') return cable.id !== focus.id
  return cable.from.objectId !== focus.id && cable.to.objectId !== focus.id
}

export interface DeliverViewportProps {
  project: Project
  view: GuideView
  focus: StepTarget | null
  onFocus: (target: StepTarget | null) => void
  captureRef?: MutableRefObject<ViewportCaptureHandle | null>
}

export function DeliverViewport({ project, view, focus, onFocus, captureRef }: DeliverViewportProps) {
  const webglOk = useMemo(detectWebGL, [])

  useEffect(
    () => () => {
      if (captureRef) captureRef.current = null
    },
    [captureRef],
  )

  if (!webglOk) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-muted/40 p-6 text-center">
        <MonitorOff className="h-8 w-8 text-faint" />
        <p className="text-sm font-medium">当前环境不支持 WebGL，三维视图不可用</p>
        <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
          你仍可阅读并执行右侧的整理与走线步骤，并导出 JSON 方案（截图与打印中的场景图将不可用）。
        </p>
      </div>
    )
  }

  return (
    <SceneErrorBoundary>
      <Canvas
        shadows
        dpr={[1, 1.75]}
        camera={{ position: VIEW_PRESETS.top.position, fov: 42 }}
        onCreated={({ gl, scene, camera }) => {
          if (!captureRef) return
          captureRef.current = {
            capture: () => {
              try {
                gl.render(scene, camera)
                return gl.domElement.toDataURL('image/png')
              } catch {
                return null
              }
            },
          }
        }}
        onPointerMissed={() => onFocus(null)}
      >
        <color attach="background" args={['#F4F1EA']} />
        <ambientLight intensity={0.55} />
        <hemisphereLight args={['#FFF8EC', '#C9BFAC', 0.45]} />
        <directionalLight
          position={[2.5, 4, 3]}
          intensity={1.1}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-camera-left={-3}
          shadow-camera-right={3}
          shadow-camera-top={3}
          shadow-camera-bottom={-3}
          shadow-camera-near={0.5}
          shadow-camera-far={14}
        />
        <Suspense fallback={null}>
          <RoomShell room={project.room} showBed={view !== 'top'} />
          {project.objects
            .filter((o) => o.visible)
            .map((object) => (
              <DeliverObjectMesh
                key={object.id}
                object={object}
                focused={focus?.type === 'object' && focus.id === object.id}
                onFocus={onFocus}
              />
            ))}
          {project.cables.filter(hasUsableCableRoute).map((cable) => (
            <DeliverCableMesh
              key={cable.id}
              cable={cable}
              objects={project.objects}
              focused={focus?.type === 'cable' && focus.id === cable.id}
              dimmed={isCableDimmed(cable, focus)}
              onFocus={onFocus}
            />
          ))}
        </Suspense>
        <GuideCamera view={view} />
      </Canvas>
    </SceneErrorBoundary>
  )
}
