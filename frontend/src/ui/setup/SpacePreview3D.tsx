import { useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { CameraRig } from '@/scene/CameraRig'
import { RoomShell } from '@/scene/RoomShell'
import { Segmented } from '@/ui/kit/segmented'
import type { ViewPreset } from '@/state/workspaceStore'
import type { RoomConfig } from '@/types/project'

/** 简化三维预览：由当前表单实时生成（桌面 / 书架 / 立柱 / 出线孔 / 插座 / 床架示意） */
export function SpacePreview3D({ room }: { room: RoomConfig }) {
  const [view, setView] = useState<ViewPreset>('persp')

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
        <RoomShell room={room} />
        <CameraRig preset={view} />
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
        简化预览 · 由当前表单实时生成 · 可拖拽旋转
      </div>
    </div>
  )
}
