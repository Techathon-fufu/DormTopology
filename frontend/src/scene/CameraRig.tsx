import { useEffect, useMemo, useRef } from 'react'
import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import type { PerspectiveCamera } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { useDrawerStore } from '@/state/drawerStore'
import { useObjectResizeStore } from '@/state/objectResizeStore'
import { useWorkspaceStore, type ViewPreset } from '@/state/workspaceStore'
import type { RoomConfig, Vec3 } from '@/types/project'
import {
  clampPreviewCameraPosition,
  previewAzimuthRange,
  previewCameraPlacement,
  previewCameraViolations,
  previewFrameCoverage,
  previewKeepOutRadius,
  previewMaxDistance,
  type PreviewCameraBounds,
  type PreviewViewport,
} from './previewCameraBounds'

const PRESETS: Record<ViewPreset, { pos: [number, number, number]; target: [number, number, number] }> = {
  persp: { pos: [1.35, 1.2, 1.9], target: [0, 0.78, 0.35] },
  front: { pos: [0, 1.05, 3.0], target: [0, 0.95, 0.4] },
  top: { pos: [0, 2.7, 0.46], target: [0, 0.75, 0.45] },
  // 从室内斜前方看抽屉，避免左墙遮挡操作面。
  left: { pos: [-1.05, 1.35, 1.95], target: [0.55, 0.6, 0.7] },
  right: { pos: [2.6, 1.3, 0.7], target: [0, 0.9, 0.45] },
  desk: { pos: [0.75, 1.9, 2.0], target: [0, 0.85, 0.45] },
}
const FIXED_TOP = { pos: [.25, 3.2, .46], target: [.25, .75, .46] } as const
const FIXED_DESK = { pos: [1, 2.1, 2.4], target: [.25, .85, .45] } as const
const FIXED_PERSPECTIVE = { pos: [.05, 1.45, 2.8], target: [.07, .96, .35] } as const

/** 约束模式下的位置 / 角度 / 距离是否与上一帧一致（避免每帧写回相机）。 */
const SAME = 1e-5

/**
 * 视角预设 + 轨道控制：
 * - 切换预设 / 点击「重置视角」（viewNonce 变化）时移动相机与目标点；
 * - 用户自由旋转、平移、缩放（左键空白处旋转 · 右键平移 · 滚轮缩放）；
 * - 拖拽物品 / 抽屉推拉期间禁用轨道控制，避免与拖拽冲突。
 *
 * 小画布（空间配置预览）可传 bounds（见 previewCameraBounds.ts）进入独立的约束模式：
 * 相机固定在房间内侧观察家具，水平 / 垂直角与距离由真实房间边界与家具体积反解，
 * 不平移、不绕到后墙或左墙背面、不穿地、不钻进家具；不传 bounds（工作台 / 最终页）时
 * 行为与原来一致。
 *
 * 兼容参数 zoomOut / targetShiftY 仅作用于无 bounds 的默认模式（正式模型整体更高更大时
 * 拉远并抬高注视点）；约束模式改用家具总览取景距离。
 */
export function CameraRig({
  preset,
  zoomOut = 1,
  targetShiftY = 0,
  furnitureModel,
  bounds,
}: {
  preset: ViewPreset
  furnitureModel?: RoomConfig['furnitureModel']
  /** 距离倍数（>1 拉远）；1 = 工作台默认取景 */
  zoomOut?: number
  /** 目标点高度微调（米） */
  targetShiftY?: number
  /** 约束模式（空间配置预览）：由 createPreviewCameraBounds 生成；不传 = 默认自由轨道 */
  bounds?: PreviewCameraBounds
}) {
  const controlsRef = useRef<OrbitControlsImpl | null>(null)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const nonce = useWorkspaceStore((s) => s.viewNonce)
  const objectDragActive = useWorkspaceStore((s) => s.drag !== null)
  const drawerDragActive = useDrawerStore((s) => s.draggingId !== null)
  const resizeActive = useObjectResizeStore((s) => s.preview !== null)
  const currentPreset = furnitureModel === 'dormdesk-v1'
    ? preset === 'persp' ? FIXED_PERSPECTIVE : preset === 'top' ? FIXED_TOP : preset === 'desk' ? FIXED_DESK : PRESETS[preset]
    : PRESETS[preset]

  // 房间参数变化（尺寸 / 家具）时重新取景；仅重渲染不重算，避免表单编辑时相机乱跳。
  const boundsKey = useMemo(() => (bounds
    ? JSON.stringify({
      target: bounds.target,
      walls: [bounds.wallX, bounds.wallZ, bounds.floorY],
      distances: [bounds.minDistance, bounds.maxDistance],
      angles: [bounds.minPolarAngle, bounds.maxPolarAngle],
      keepOut: bounds.keepOut.length,
    })
    : ''), [bounds])

  const viewport = useMemo<PreviewViewport>(() => ({
    aspect: size.width / Math.max(1, size.height),
    fovDeg: (camera as PerspectiveCamera).fov || bounds?.fovDeg || 42,
  }), [camera, size.width, size.height, bounds?.fovDeg])

  useEffect(() => {
    const controls = controlsRef.current
    if (bounds) {
      // 约束模式：预设只提供观察方向，距离与角度由约束模型解算。
      const direction: Vec3 = [
        currentPreset.pos[0] - currentPreset.target[0],
        currentPreset.pos[1] - currentPreset.target[1],
        currentPreset.pos[2] - currentPreset.target[2],
      ]
      const { position } = previewCameraPlacement(bounds, direction, viewport)
      camera.position.set(position[0], position[1], position[2])
      if (controls) {
        controls.target.set(bounds.target[0], bounds.target[1], bounds.target[2])
        controls.update()
      }
      return
    }

    // Approach the fixed L desk from the front so its ladder does not obscure the workspace.
    const p = currentPreset
    const distanceScale = zoomOut * Math.max(1, 1.1 / (size.width / Math.max(1, size.height)))
    const tx = p.target[0]
    const ty = p.target[1] + targetShiftY
    const tz = p.target[2]
    camera.position.set(
      tx + (p.pos[0] - p.target[0]) * distanceScale,
      ty + (p.pos[1] - p.target[1]) * distanceScale,
      tz + (p.pos[2] - p.target[2]) * distanceScale,
    )
    const controlsAtPreset = controlsRef.current
    if (controlsAtPreset) {
      controlsAtPreset.target.set(tx, ty, tz)
      controlsAtPreset.update()
    }
  }, [currentPreset, boundsKey, viewport, nonce, camera, size.width, size.height, zoomOut, targetShiftY])

  // 约束模式的硬边界：每帧按当前半径重算水平角范围与距离区间，并兜底夹取一次位置。
  useFrame(() => {
    const controls = controlsRef.current
    if (!bounds || !controls) return

    const position: Vec3 = [camera.position.x, camera.position.y, camera.position.z]
    const offset: Vec3 = [
      position[0] - controls.target.x,
      position[1] - controls.target.y,
      position[2] - controls.target.z,
    ]
    const radius = Math.hypot(offset[0], offset[1], offset[2])
    if (radius < SAME) return

    const polar = Math.acos(Math.min(1, Math.max(-1, offset[1] / radius)))
    const azimuthRange = previewAzimuthRange(bounds, polar, radius)
    controls.minAzimuthAngle = azimuthRange.min
    controls.maxAzimuthAngle = azimuthRange.max

    const minDistance = Math.max(bounds.minDistance, previewKeepOutRadius(bounds, offset))
    const maxDistance = Math.max(minDistance + 0.1, previewMaxDistance(bounds, offset, viewport))
    controls.minDistance = minDistance
    controls.maxDistance = maxDistance

    const clamped = clampPreviewCameraPosition(position, bounds, { minDistance, maxDistance })
    if (
      Math.abs(clamped[0] - position[0]) > SAME ||
      Math.abs(clamped[1] - position[1]) > SAME ||
      Math.abs(clamped[2] - position[2]) > SAME
    ) {
      camera.position.set(clamped[0], clamped[1], clamped[2])
    }
  })

  // 仅开发环境的观测探针：供 Playwright 读取真实相机位置 / 取景覆盖 / 违例，生产构建不注入。
  useEffect(() => {
    if (!bounds || !import.meta.env.DEV) return
    const probe = {
      bounds,
      state: () => ({
        position: camera.position.toArray() as Vec3,
        target: controlsRef.current
          ? [controlsRef.current.target.x, controlsRef.current.target.y, controlsRef.current.target.z] as Vec3
          : bounds.target,
        fov: (camera as PerspectiveCamera).fov,
        size: { width: size.width, height: size.height },
      }),
      coverage: () => previewFrameCoverage(
        bounds,
        camera.position.toArray() as Vec3,
        viewport,
      ),
      violations: () => previewCameraViolations(camera.position.toArray() as Vec3, bounds),
    }
    const host = window as unknown as { __previewCamera?: typeof probe }
    host.__previewCamera = probe
    return () => {
      if (host.__previewCamera === probe) delete host.__previewCamera
    }
  }, [bounds, camera, size.width, size.height])

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enabled={!objectDragActive && !drawerDragActive && !resizeActive}
      enableDamping
      dampingFactor={0.08}
      enablePan={!bounds}
      panSpeed={0.9}
      zoomSpeed={0.9}
      rotateSpeed={bounds ? 0.6 : 1}
      minDistance={bounds ? bounds.minDistance : 0.5}
      maxDistance={bounds ? bounds.maxDistance : 8}
      minPolarAngle={bounds ? bounds.minPolarAngle : 0}
      maxPolarAngle={bounds ? bounds.maxPolarAngle : Math.PI / 2 - 0.02}
      target={bounds
        ? bounds.target
        : [currentPreset.target[0], currentPreset.target[1] + targetShiftY, currentPreset.target[2]]}
    />
  )
}
