import { useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { MonitorOff } from 'lucide-react'
import { CameraRig } from '@/scene/CameraRig'
import { DormDeskModel } from '@/scene/DormDeskModel'
import { RoomShell } from '@/scene/RoomShell'
import { detectWebGL } from '@/lib/webgl'
import { useDeskModelStore } from '@/state/deskModelStore'
import type { RoomConfig } from '@/types/project'
import { SceneLighting } from '@/scene/SceneLighting'
import { configureSceneRenderer, sceneDpr, SCENE_CAMERA_CLIP, SCENE_GL_OPTIONS } from '@/scene/renderProfile'
import { createPreviewCameraBounds, PREVIEW_CAMERA_FOV } from '@/scene/previewCameraBounds'

/**
 * 空间配置三维预览：与三维工作台共用同一套家具加载逻辑——DormDeskModel 负责
 * 加载无抽屉桌体 + 三只抽屉分离件（GLB 成功时按模型原样显示实心桌板；
 * 失败 / 简化时回退参数化几何），并按固定家具的支撑与出线孔几何隐藏参数化床架 / 孔位标记。
 *
 * 视角使用独立的约束模式（previewCameraBounds）：只保留一个透视预设作为观察方向，
 * 拖动旋转 / 滚轮缩放都在房间内侧完成，家具总览始终完整；不提供视角按钮与平移。
 */
export function SpacePreview3D({ room }: { room: RoomConfig }) {
  const webglOk = useMemo(detectWebGL, [])
  const deskGlbLoaded = useDeskModelStore((s) => s.status === 'loaded')
  const bounds = useMemo(() => createPreviewCameraBounds(room, { fovDeg: PREVIEW_CAMERA_FOV }), [room])

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
    <div className="relative h-72 overflow-hidden rounded-md border border-border bg-[#F4F7F8]">
      <Canvas shadows frameloop="demand" gl={SCENE_GL_OPTIONS} dpr={sceneDpr()}
        camera={{ position: [1.9, 1.6, 2.6], fov: PREVIEW_CAMERA_FOV, ...SCENE_CAMERA_CLIP }}
        onCreated={({ gl }) => configureSceneRenderer(gl)}>
        <SceneLighting />
        {/* 桌体由 DormDeskModel 接管（GLB / 回退几何）；GLB 就绪时床架由模型自带、隐藏参数化床架 */}
        <RoomShell
          room={room}
          deskMode="none"
          showBed={!deskGlbLoaded}
          showCableHoles={deskGlbLoaded}
        />
        <DormDeskModel room={room} respectToolbar={false} />
        {/* 约束模式：取景距离由家具包围盒与画布宽高比实时解算，不再用固定拉远倍数 */}
        <CameraRig preset="persp" furnitureModel={room.furnitureModel} bounds={bounds} />
      </Canvas>
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/35 to-transparent px-2.5 py-1.5 text-[11px] text-white">
        拖动旋转 · 滚轮缩放 · 不会绕到墙后
      </div>
    </div>
  )
}
