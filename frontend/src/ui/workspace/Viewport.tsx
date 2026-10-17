import { Component, Suspense, useMemo, type ReactNode } from 'react'
import { Canvas } from '@react-three/fiber'
import { MonitorOff, Pause, Play, RotateCcw, SkipForward } from 'lucide-react'
import type { Project } from '@/types/project'
import { resolveOrganizationPreferences } from '@/types/organization'
import { validateScene, type SceneIssue } from '@/scene/sceneValidation'
import { useDeskModelStore } from '@/state/deskModelStore'
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

function OperationPlayback() {
  const compare = useOrganizeStore((s) => s.compare)
  const setCompare = useOrganizeStore((s) => s.setCompare)
  const status = useOrganizeStore((s) => s.status)
  const commands = useOrganizeStore((s) => s.commands)
  const index = useOrganizeStore((s) => s.batchIndex)
  const progress = useOrganizeStore((s) => s.batchProgress)
  const plan = useOrganizeStore((s) => s.plan)
  const pause = useOrganizeStore((s) => s.pausePlayback)
  const resume = useOrganizeStore((s) => s.resumePlayback)
  const replay = useOrganizeStore((s) => s.startPlayback)
  const finish = useOrganizeStore((s) => s.skipToEnd)
  if (!plan) return null
  const finished = status === 'finished'
  const problems = plan.metrics.unplacedCount + plan.metrics.overlapCount + plan.metrics.outOfBoundsCount
  return (
    <section aria-label="整理演示控制" className="absolute bottom-12 left-3 right-3 z-10 mx-auto max-w-xl overflow-hidden rounded-xl border border-border bg-surface shadow-md sm:bottom-10 sm:left-5 sm:right-5">
      <div className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary"><Play className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold">{compare === 'before' ? '正在查看原布局' : finished ? '演示完成' : status === 'paused' ? '演示已暂停' : '正在整理'}<span className="ml-2 font-normal tabular-nums text-muted-foreground">{finished ? commands.length : Math.min(index + 1, commands.length)} / {commands.length}</span></p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{compare === 'before' ? '原始快照 · 方案尚未应用' : finished ? problems > 0 ? `最终布局 · ${problems} 项问题待处理` : '最终布局 · 接受方案后保存' : commands[index]?.label ?? '物品无需移动'}</p>
        </div>
        <Button size="icon" variant="ghost" aria-label={status === 'playing' ? '暂停演示' : status === 'paused' ? '继续播放' : '重新播放'} title={status === 'playing' ? '暂停' : status === 'paused' ? '继续播放' : '重新播放'} onClick={status === 'playing' ? pause : status === 'paused' ? resume : replay}>{status === 'playing' ? <Pause className="h-4 w-4" /> : finished ? <RotateCcw className="h-4 w-4" /> : <Play className="h-4 w-4" />}</Button>
        <Button size="icon" variant="ghost" aria-label="查看最终效果" title="查看最终效果" onClick={finish}><SkipForward className="h-4 w-4" /></Button>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-border/70 px-3 py-2 sm:px-4">
        <span className="text-[11px] text-muted-foreground">同视角对比</span>
        <div className="flex gap-1"><Button size="sm" className="h-7 px-2 text-xs" variant={compare === 'before' ? 'secondary' : 'ghost'} aria-pressed={compare === 'before'} onClick={() => setCompare('before')}>整理前</Button><Button size="sm" className="h-7 px-2 text-xs" variant={compare === 'after' && finished ? 'secondary' : 'ghost'} aria-pressed={compare === 'after' && finished} onClick={finish}>最终方案</Button></div>
      </div>
      <progress aria-label="整理演示进度" className="playback-progress block h-1 w-full" max={Math.max(1, commands.length)} value={finished ? Math.max(1, commands.length) : index + progress} />
    </section>
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
  const plan = useOrganizeStore((s) => s.plan)
  const compare = useOrganizeStore((s) => s.compare)
  const playbackStatus = useOrganizeStore((s) => s.status)
  const deskMetrics = useDeskModelStore((s) => s.metrics)
  const deskModelStatus = useDeskModelStore((s) => s.status)
  /** GLB 整组家具已加载：隐藏参数化床架（避免与模型床重复），出线孔标记改为叠加渲染 */
  const deskGlbLoaded = deskModelStatus === 'loaded'
  const previewIssues = useMemo(() => {
    if (!plan || compare === 'before') return issuesById
    if (playbackStatus !== 'finished' && playbackStatus !== 'preview') return new Map<string, SceneIssue[]>()
    const targets = new Map(plan.assignments.map((a) => [a.objectId, a]))
    return validateScene(project.objects.map((o) => {
      const a = targets.get(o.id)
      return a ? { ...o, transform: { position: a.position, rotationY: a.rotationY } } : o
    }), project.room, deskMetrics)
  }, [plan, compare, playbackStatus, project, issuesById, deskMetrics])
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
            {/* 房间外壳与桌体分离：桌体加载正式模型（无抽屉桌体 + 三只抽屉分离件，抽屉可推拉），
                失败 / 未就绪回退参数化几何；GLB 就绪后床架由模型自带，隐藏参数化床架并叠加逻辑出线孔标记 */}
            <RoomShell
              room={project.room}
              deskMode="none"
              showBed={viewPreset !== 'top' && !deskGlbLoaded}
              showCableHoles={deskGlbLoaded}
            />
            <DormDeskModel room={project.room} hideBedParts={viewPreset === 'top'} />
            {organizeZonesVisible ? (
              <ZoneOverlay room={project.room} preferences={resolveOrganizationPreferences(project)} />
            ) : null}
            {project.objects.map((object) => (
              <SceneObjectMesh
                key={object.id}
                project={project}
                object={object}
                selected={object.id === selectedId}
                issues={object.id === selectedId ? previewIssues.get(object.id) : undefined}
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
      <OperationPlayback />
    </div>
  )
}
