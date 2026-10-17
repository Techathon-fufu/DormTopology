import { useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { MonitorOff } from 'lucide-react'
import { CameraRig } from '@/scene/CameraRig'
import { DormDeskModel } from '@/scene/DormDeskModel'
import { RoomShell } from '@/scene/RoomShell'
import { Segmented } from '@/ui/kit/segmented'
import { detectWebGL } from '@/lib/webgl'
import { useDeskModelStore } from '@/state/deskModelStore'
import type { ViewPreset } from '@/state/workspaceStore'
import type { RoomConfig } from '@/types/project'

/**
 * 空间配置预览与工作台共用家具加载、支撑及开孔几何。
 */
export function SpacePreview3D({ room }: { room: RoomConfig }) {
  const [view, setView] = useState<ViewPreset>('persp')
  const webglOk = useMemo(detectWebGL, [])
  const deskGlbLoaded = useDeskModelStore((s) => s.status === 'loaded')

  if (!webglOk) {
    return (
      <div className="flex h-72 flex-col items-center justify-center gap-2 rounded-md border border-border bg-muted/40 p-4 text-center">
        <MonitorOff className="h-7 w-7 text-faint" />
        <p className="text-sm font-medium">当前环境不支持 WebGL，三维预览不可用</p>
        <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
          左侧参数表单与结构校验不受影响，可继续编辑并保存配置；如浏览器已支持 WebGL，请尝试开启硬件加速后刷新页面。
        </p>
      </div>
    )
  }

  return (
    <div className="relative h-72 overflow-hidden rounded-md border border-border bg-[#F2EFE9]">
      <Canvas shadows dpr={[1, 1.5]} camera={{ position: [1.9, 1.6, 2.6], fov: 42 }}>
        <color attach="background" args={['#F2EFE9']} />
        <ambientLight intensity={0.6} />
        <directionalLight
          position={[3, 5, 2.5]}
          intensity={1.15}
          castShadow
          shadow-mapSize={[1024, 1024]}
        />
        <directionalLight position={[-4, 3, 3]} intensity={0.35} />
        {/* 桌体由 DormDeskModel 接管（GLB / 回退几何）；GLB 就绪时床架由模型自带、隐藏参数化床架 */}
        <RoomShell
          room={room}
          deskMode="none"
          showBed={view !== 'top' && !deskGlbLoaded}
          showCableHoles={deskGlbLoaded}
        />
        <DormDeskModel room={room} hideBedParts={view === 'top'} respectToolbar={false} />
        {/* 小画布取景：拉远 + 抬高注视点，容纳整组家具（默认机位按桌面区域取景会裁掉床） */}
        <CameraRig preset={view} furnitureModel={room.furnitureModel} zoomOut={1.75} targetShiftY={0.3} />
      </Canvas>
      <div className="absolute right-2 top-2">
        <Segmented
          size="sm"
          value={view}
          onChange={setView}
          options={[
            { value: 'persp', label: '透视' },
            { value: 'front', label: '正视' },
            { value: 'top', label: '俯视' },
          ]}
        />
      </div>
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/35 to-transparent px-2.5 py-1.5 text-[11px] text-white">
        正式模型 · 由当前表单实时生成 · 可拖拽旋转
      </div>
    </div>
  )
}
