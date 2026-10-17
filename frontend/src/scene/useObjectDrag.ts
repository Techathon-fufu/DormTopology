import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import type { Project, SceneObject, Vec3 } from '@/types/project'
import { resolveDropCommit } from '@/scene/dragCommit'
import { placementIssues, raycastSupports } from '@/scene/sceneValidation'
import { useDeskModelStore } from '@/state/deskModelStore'
import { useOrganizeStore } from '@/state/organizeStore'
import { useProjectsStore } from '@/state/projectsStore'
import { useWorkspaceStore } from '@/state/workspaceStore'

/** 拖拽判定阈值（像素）：小于该位移视为点击选中 */
const DRAG_THRESHOLD_PX = 4
/** 位置网格吸附精度（米）：10 mm */
const GRID = 0.01

export interface ObjectDragHandlers {
  onPointerDown: (e: ThreeEvent<PointerEvent>) => void
}

/**
 * 物品拖拽：pointerdown 开始，指针射线投射到支撑面（桌面 / 书架搁板 / 地面）上取最近命中，
 * 位置吸附到 10mm 网格；拖动过程中仅写入会话级 drag 状态（不写项目库、不记录历史），
 * 松手时提交一次可撤销的移动（取消碰撞体积拦截与强行弹回，直接提交落点并提示干涉）。
 * 拖拽期间 CameraRig 的轨道控制会被禁用，避免操作冲突。
 */
export function useObjectDrag(project: Project, object: SceneObject): ObjectDragHandlers {
  const { camera, gl } = useThree()
  const cleanupRef = useRef<(() => void) | null>(null)

  useEffect(
    () => () => {
      cleanupRef.current?.()
      if (useWorkspaceStore.getState().drag?.objectId === object.id) {
        useWorkspaceStore.getState().setDrag(null)
      }
    },
    [object.id],
  )

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0 || object.locked || !object.visible) return
    // 空间整理预览 / 动画期间禁止拖拽，避免与方案位姿冲突（需先接受方案或恢复原布局）
    if (useOrganizeStore.getState().isPreviewBlocking()) return
    e.stopPropagation()

    const startPos: Vec3 = [...object.transform.position]
    const startX = e.nativeEvent.clientX
    const startY = e.nativeEvent.clientY
    const pointerId = e.pointerId

    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    let moved = false
    let rafId = 0
    let pending: PointerEvent | null = null
    let lastPos: Vec3 = startPos
    /** 本次拖拽中最后一次「有效预览位置」（越界 / 相交的预览不更新它） */
    let lastValidPos: Vec3 = startPos
    /** 当前预览位置是否通过越界 / 相交校验（松手提交的判据） */
    let lastPreviewValid = true

    const cancelRaf = () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId)
        rafId = 0
      }
    }

    const flush = () => {
      rafId = 0
      const ev = pending
      pending = null
      if (!ev) return
      const rect = gl.domElement.getBoundingClientRect()
      ndc.set(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1,
      )
      raycaster.setFromCamera(ndc, camera)
      // 吸附面高度优先采用桌体 GLB 实测锚点（未加载 / 失败时回退 RoomConfig）
      const metrics = useDeskModelStore.getState().metrics
      const hit = raycastSupports(raycaster.ray, project.room, metrics)
      if (!hit) return // 指针未指向任何支撑面：保持上一次预览
      const position: Vec3 = [
        Math.round(hit.x / GRID) * GRID,
        hit.y,
        Math.round(hit.z / GRID) * GRID,
      ]
      const others = useProjectsStore.getState().projects[project.id]?.objects ?? project.objects
      const issues = placementIssues(object, position, others, project.room, metrics)
      const valid = !issues.some((i) => i.type === 'outOfBounds' || i.type === 'overlap' || i.type === 'roomCollision' || i.type === 'floating')
      moved = true
      lastPos = position
      lastPreviewValid = valid
      if (valid) lastValidPos = position
      useWorkspaceStore.getState().setDrag({
        objectId: object.id,
        position,
        support: hit.kind,
        valid,
        lastValid: lastValidPos,
      })
    }

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD_PX) return
      pending = ev
      if (!rafId) rafId = window.requestAnimationFrame(flush)
    }

    const finish = () => {
      cancelRaf()
      if (pending) flush()
      cleanup()
      document.body.style.cursor = 'auto'
      useWorkspaceStore.getState().setDrag(null)
      if (!moved) return
      // 松手时一次性提交（一次可撤销的移动记录）：
      // 拖拽摆放取消碰撞体积拦截，不弹回；保留落点并提示干涉；
      // 与起点一致时不提交，避免产生无变化的空历史记录。
      const commitPosition = resolveDropCommit(startPos, lastValidPos, lastPos, lastPreviewValid)
      if (commitPosition) {
        useWorkspaceStore.getState().updateObject(
          project.id,
          object.id,
          { transform: { position: commitPosition } },
          true,
        )
        if (!lastPreviewValid) {
          useWorkspaceStore.getState().setNotice(`已摆放「${object.name}」，注意存在干涉冲突（可撤销）`)
        }
      }
    }

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      cleanupRef.current = null
    }

    cleanupRef.current?.() // 取消上一次未完成的拖拽
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    cleanupRef.current = cleanup

    document.body.style.cursor = 'grabbing'
    // 立刻进入拖拽态：CameraRig 在下一帧即禁用轨道控制，避免拖拽与相机操作冲突
    useWorkspaceStore.getState().setDrag({
      objectId: object.id,
      position: startPos,
      support: 'none',
      valid: true,
      lastValid: startPos,
    })
  }

  return { onPointerDown }
}
