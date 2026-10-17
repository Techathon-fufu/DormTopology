import { useEffect, useRef } from 'react'
import { OrbitControls } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { useWorkspaceStore, type ViewPreset } from '@/state/workspaceStore'

const PRESETS: Record<ViewPreset, { pos: [number, number, number]; target: [number, number, number] }> = {
  persp: { pos: [1.35, 1.2, 1.9], target: [0, 0.78, 0.35] },
  front: { pos: [0, 1.05, 3.0], target: [0, 0.95, 0.4] },
  top: { pos: [0, 2.7, 0.46], target: [0, 0.75, 0.45] },
  left: { pos: [-2.6, 1.3, 0.7], target: [0, 0.9, 0.45] },
  right: { pos: [2.6, 1.3, 0.7], target: [0, 0.9, 0.45] },
  desk: { pos: [0.55, 1.5, 1.35], target: [0, 0.8, 0.35] },
}

/**
 * 视角预设 + 轨道控制：
 * - 切换预设 / 点击「重置视角」（viewNonce 变化）时移动相机与目标点；
 * - 用户自由旋转、平移、缩放（左键空白处旋转 · 右键平移 · 滚轮缩放）；
 * - 拖拽物品期间禁用轨道控制，避免与物品拖拽冲突。
 */
export function CameraRig({ preset }: { preset: ViewPreset }) {
  const controlsRef = useRef<OrbitControlsImpl | null>(null)
  const camera = useThree((s) => s.camera)
  const nonce = useWorkspaceStore((s) => s.viewNonce)
  const dragActive = useWorkspaceStore((s) => s.drag !== null)

  useEffect(() => {
    const p = PRESETS[preset]
    camera.position.set(p.pos[0], p.pos[1], p.pos[2])
    const controls = controlsRef.current
    if (controls) {
      controls.target.set(p.target[0], p.target[1], p.target[2])
      controls.update()
    }
  }, [preset, nonce, camera])

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enabled={!dragActive}
      enableDamping
      dampingFactor={0.08}
      enablePan
      panSpeed={0.9}
      zoomSpeed={0.9}
      minDistance={0.5}
      maxDistance={8}
      maxPolarAngle={Math.PI / 2 - 0.02}
      target={[0, 0.9, 0.45]}
    />
  )
}
