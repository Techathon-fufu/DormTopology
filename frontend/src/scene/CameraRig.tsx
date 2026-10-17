import { useEffect, useRef } from 'react'
import { OrbitControls } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { useDrawerStore } from '@/state/drawerStore'
import { useWorkspaceStore, type ViewPreset } from '@/state/workspaceStore'

const PRESETS: Record<ViewPreset, { pos: [number, number, number]; target: [number, number, number] }> = {
  persp: { pos: [1.35, 1.2, 1.9], target: [0, 0.78, 0.35] },
  front: { pos: [0, 1.05, 3.0], target: [0, 0.95, 0.4] },
  top: { pos: [0, 2.7, 0.46], target: [0, 0.75, 0.45] },
  // 从室内斜前方看抽屉，避免左墙遮挡操作面。
  left: { pos: [-1.05, 1.35, 1.95], target: [0.55, 0.6, 0.7] },
  right: { pos: [2.6, 1.3, 0.7], target: [0, 0.9, 0.45] },
  desk: { pos: [0.75, 1.9, 2.0], target: [0, 0.85, 0.45] },
}

/**
 * 视角预设 + 轨道控制：
 * - 切换预设 / 点击「重置视角」（viewNonce 变化）时移动相机与目标点；
 * - 用户自由旋转、平移、缩放（左键空白处旋转 · 右键平移 · 滚轮缩放）；
 * - 拖拽物品 / 抽屉推拉期间禁用轨道控制，避免与拖拽冲突。
 *
 * 小画布（空间配置预览）可传 zoomOut / targetShiftY：正式模型整体更高更大，
 * 默认机位按桌面区域取景，预览需要拉远并抬高注视点才能看到完整家具。
 */
export function CameraRig({
  preset,
  zoomOut = 1,
  targetShiftY = 0,
}: {
  preset: ViewPreset
  /** 距离倍数（>1 拉远）；1 = 工作台默认取景 */
  zoomOut?: number
  /** 目标点高度微调（米） */
  targetShiftY?: number
}) {
  const controlsRef = useRef<OrbitControlsImpl | null>(null)
  const camera = useThree((s) => s.camera)
  const nonce = useWorkspaceStore((s) => s.viewNonce)
  const objectDragActive = useWorkspaceStore((s) => s.drag !== null)
  const drawerDragActive = useDrawerStore((s) => s.draggingId !== null)

  useEffect(() => {
    const p = PRESETS[preset]
    const tx = p.target[0]
    const ty = p.target[1] + targetShiftY
    const tz = p.target[2]
    camera.position.set(
      tx + (p.pos[0] - p.target[0]) * zoomOut,
      ty + (p.pos[1] - p.target[1]) * zoomOut,
      tz + (p.pos[2] - p.target[2]) * zoomOut,
    )
    const controls = controlsRef.current
    if (controls) {
      controls.target.set(tx, ty, tz)
      controls.update()
    }
  }, [preset, nonce, camera, zoomOut, targetShiftY])

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enabled={!objectDragActive && !drawerDragActive}
      enableDamping
      dampingFactor={0.08}
      enablePan
      panSpeed={0.9}
      zoomSpeed={0.9}
      minDistance={0.5}
      maxDistance={8}
      maxPolarAngle={Math.PI / 2 - 0.02}
      target={[PRESETS[preset].target[0], PRESETS[preset].target[1] + targetShiftY, PRESETS[preset].target[2]]}
    />
  )
}
