import { Component, Suspense, useMemo, type ReactNode } from 'react'
import { Canvas } from '@react-three/fiber'
import { MonitorOff } from 'lucide-react'
import type { Project } from '@/types/project'
import { resolveOrganizationPreferences } from '@/types/organization'
import type { SceneIssue } from '@/scene/sceneValidation'
import { useCableStore } from '@/state/cableStore'
import { useOrganizeStore } from '@/state/organizeStore'
import { useWorkspaceStore } from '@/state/workspaceStore'
import { Button } from '@/ui/kit/button'
import { CameraRig } from '@/scene/CameraRig'
import { CablePlanningOverlay } from '@/scene/CablePlanningOverlay'
import { CablesLayer } from '@/scene/CablesLayer'
import { PortMarkers } from '@/scene/PortMarkers'
import { DormDeskModel } from '@/scene/DormDeskModel'
import { RoomShell } from '@/scene/RoomShell'
import { SceneObjectMesh } from '@/scene/SceneObjectMesh'
import { ZoneOverlay } from '@/scene/ZoneOverlay'
import { basicMaterial, ringGeometry } from '@/scene/resources'
import { detectWebGL } from '@/lib/webgl'
import { DeskModelNotice } from '@/ui/workspace/DeskModelNotice'

/** 三维渲染错误边界：渲染失败时给出重试入口，不影响左右面板继续工作 */
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
            你仍可通过左侧物品列表与右侧属性面板编辑位置、尺寸与旋转。
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

/** 拖拽预览指示环：落在吸附到的支撑面上，红色表示当前位置越界 / 相交 */
function DragIndicator() {
  const drag = useWorkspaceStore((s) => s.drag)
  if (!drag) return null
  const [x, y, z] = drag.position
  const size = Math.max(0.06, 0.13)
  return (
    <group position={[x, y + 0.004, z]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh
        geometry={ringGeometry(size * 0.72, size, 32)}
        material={basicMaterial(drag.valid ? '#0F9D8A' : '#D64545', {
          opacity: 0.85,
          doubleSide: true,
        })}
      />
    </group>
  )
}

/** 三维工作台视口：上床下桌场景 + 场景对象 + 线缆层（走线模式可见） */
export function Viewport({
  project,
  issuesById,
}: {
  project: Project
  issuesById: Map<string, SceneIssue[]>
}) {
  const mode = useWorkspaceStore((s) => s.mode)
  const viewPreset = useWorkspaceStore((s) => s.viewPreset)
  const selectedId = useWorkspaceStore((s) => s.selectedId)
  const select = useWorkspaceStore((s) => s.select)
  const organizeZonesVisible = useOrganizeStore((s) => s.open && s.showZones)

  const webglOk = useMemo(detectWebGL, [])

  if (!webglOk) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-muted/40 p-6 text-center">
        <MonitorOff className="h-8 w-8 text-faint" />
        <p className="text-sm font-medium">当前环境不支持 WebGL，三维视图不可用</p>
        <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
          你仍可使用左侧物品列表与右侧属性面板编辑物品的位置 / 尺寸 / 旋转，并在右侧面板生成空间整理方案（规则式演示）。
          如浏览器已支持 WebGL，请尝试开启硬件加速后刷新页面。
        </p>
      </div>
    )
  }

  return (
    <div className="relative h-full w-full">
      <SceneErrorBoundary>
        <Canvas
          shadows
          dpr={[1, 2]}
          camera={{ position: [1.9, 1.6, 2.6], fov: 42 }}
          onPointerMissed={() => {
            select(null)
            if (mode === 'cable') useCableStore.getState().selectCable(null)
          }}
        >
          <color attach="background" args={['#F4F1EA']} />
          <fog attach="fog" args={['#F4F1EA', 9, 20]} />
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
            {/* 房间外壳与桌体分离：桌体优先加载 dorm_desk_assembled.glb，失败 / 未就绪回退参数化几何 */}
            <RoomShell room={project.room} deskMode="none" />
            <DormDeskModel room={project.room} />
            {organizeZonesVisible ? (
              <ZoneOverlay room={project.room} preferences={resolveOrganizationPreferences(project)} />
            ) : null}
            {project.objects.map((object) => (
              <SceneObjectMesh
                key={object.id}
                project={project}
                object={object}
                selected={object.id === selectedId}
                issues={issuesById.get(object.id)}
                onSelect={select}
              />
            ))}
            {mode === 'cable' ? (
              <>
                <CablePlanningOverlay project={project} />
                <CablesLayer project={project} />
                <PortMarkers project={project} />
              </>
            ) : null}
          </Suspense>
          <DragIndicator />
          <CameraRig preset={viewPreset} />
        </Canvas>
      </SceneErrorBoundary>
      {/* 桌体模型状态提示（加载中 / 失败重试 / 简化几何恢复）：不遮挡三维操作 */}
      <DeskModelNotice />
    </div>
  )
}
