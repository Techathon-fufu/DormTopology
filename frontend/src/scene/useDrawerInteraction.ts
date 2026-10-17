import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { clampDrawerProgress, setDrawerHighlight, type DormDeskDrawerSpec } from '@/scene/dormDeskDrawers'
import { useDrawerStore } from '@/state/drawerStore'

/** 拖拽判定阈值（像素）：小于该位移视为单击（开 / 关切换） */
const DRAG_THRESHOLD_PX = 4

/**
 * 抽屉交互：悬停高亮 + 单击开 / 关 + 拖拽跟手（含移动端触摸，pointer 事件统一）。
 *
 * - 拖拽：把指针位移投影到抽屉滑出轴在屏幕上的方向（全行程屏幕向量为单位），
 *   `progress = clamp(起始 progress + 投影比例)` 实时跟手；不写项目数据（会话视图状态）；
 * - 松手 / Esc / 触摸取消：吸附到最近吸附点（progress ≥ 0.5 → 全开，否则全关）；
 * - 拖拽期间写入 `drawerStore.draggingId`，CameraRig 据此禁用轨道控制（与物品拖拽同机制）。
 */
export function useDrawerInteraction(
  spec: DormDeskDrawerSpec,
  scene: THREE.Object3D,
): {
  onPointerDown: (e: ThreeEvent<PointerEvent>) => void
  onPointerOver: (e: ThreeEvent<PointerEvent>) => void
  onPointerOut: (e: ThreeEvent<PointerEvent>) => void
} {
  const { camera, gl } = useThree()
  const cleanupRef = useRef<(() => void) | null>(null)
  const hovered = useDrawerStore((s) => s.hoveredId === spec.id)

  // 悬停高亮（材质自发光），卸载时兜底还原
  useEffect(() => {
    setDrawerHighlight(scene, hovered)
  }, [scene, hovered])
  useEffect(
    () => () => {
      setDrawerHighlight(scene, false)
    },
    [scene],
  )

  // 卸载时清理未完成的拖拽会话（组件销毁 / 模型重载）
  useEffect(
    () => () => {
      cleanupRef.current?.()
      const store = useDrawerStore.getState()
      if (store.draggingId === spec.id) store.endDrag()
    },
    [spec.id],
  )

  const onPointerOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    if (useDrawerStore.getState().draggingId !== null) return
    useDrawerStore.getState().setHovered(spec.id)
    document.body.style.cursor = 'grab'
  }

  const onPointerOut = () => {
    const store = useDrawerStore.getState()
    if (store.hoveredId === spec.id) store.setHovered(null)
    if (store.draggingId === null) document.body.style.cursor = 'auto'
  }

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    cleanupRef.current?.() // 取消上一次未完成的拖拽

    const store = useDrawerStore.getState()
    store.beginDrag(spec.id)
    const startX = e.nativeEvent.clientX
    const startY = e.nativeEvent.clientY
    const pointerId = e.pointerId
    const startProgress = store.drawers[spec.id].progress
    let moved = false

    // 屏幕投影基准：拖动开始时抽屉包围盒中心 + 全行程屏幕位移（像素 / 单位行程）
    const center = new THREE.Box3().setFromObject(scene).getCenter(new THREE.Vector3())
    const axisWorld = new THREE.Vector3(-1, 0, 0).transformDirection(scene.matrixWorld).normalize()
    const toPixels = (point: THREE.Vector3) => {
      const rect = gl.domElement.getBoundingClientRect()
      const projected = point.clone().project(camera)
      return {
        x: rect.left + ((projected.x + 1) / 2) * rect.width,
        y: rect.top + ((1 - projected.y) / 2) * rect.height,
      }
    }
    const start = toPixels(center)
    const end = toPixels(center.clone().addScaledVector(axisWorld, spec.travelM))
    const dx = end.x - start.x
    const dy = end.y - start.y
    const denom = dx * dx + dy * dy

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      const mx = ev.clientX - startX
      const my = ev.clientY - startY
      if (!moved && Math.hypot(mx, my) < DRAG_THRESHOLD_PX) return
      moved = true
      document.body.style.cursor = 'grabbing'
      if (denom < 1) return // 滑出轴几乎与视线平行：本帧不做映射，保持当前进度
      const progress = startProgress + (mx * dx + my * dy) / denom
      useDrawerStore.getState().setProgress(spec.id, clampDrawerProgress(progress))
    }

    const finish = () => {
      cleanup()
      const current = useDrawerStore.getState()
      // 松手（含 Esc / 触摸取消）吸附到最近吸附点；未移动视为单击：开 / 关切换
      if (moved) current.snapAfterDrag(spec.id)
      else current.toggle(spec.id)
      current.endDrag()
      document.body.style.cursor = 'auto'
    }

    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') finish()
    }

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      window.removeEventListener('keydown', onKeyDown)
      cleanupRef.current = null
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    window.addEventListener('keydown', onKeyDown)
    cleanupRef.current = cleanup
  }

  return { onPointerDown, onPointerOver, onPointerOut }
}
