import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Html } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import * as THREE from 'three'
import type { Project, SceneObject, Vec3 } from '@/types/project'
import { useOrganizeStore } from '@/state/organizeStore'
import { useWorkspaceStore } from '@/state/workspaceStore'
import { drawerDisplayPosition } from './drawerContents'
import { currentDrawerOffsets, useDrawerStore } from '@/state/drawerStore'
import { useProjectsStore } from '@/state/projectsStore'
import { useObjectResizeStore } from '@/state/objectResizeStore'
import { bookPoseDimensions } from './bookPose'
import { resizeIssue } from './placementEditing'
import {
  RESIZE_MAX,
  RESIZE_MIN,
  clampUniformResize,
  cornerDiagonal,
  cubeCorners,
  projectToPixel,
  scaleFromScreenDrag,
  type ResizeCorner,
} from './objectResize'

const HANDLE_RADIUS_MIN = 0.006
const HANDLE_RADIUS_MAX = 0.012
const HIT_RADIUS_FACTOR = 2
const DIAG_EPSILON = 1e-3

/** key 稳定标识：corner.join(',') */
function cornerKey(corner: ResizeCorner): string {
  return corner.join(',')
}

function isTextInput(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || typeof el.tagName !== 'string') return false
  const tag = el.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable === true
}

/**
 * 选中物体角点的等比缩放手柄。
 *
 * - 可见 8 个角点小球仅在「选中 + 按住 Ctrl + 未锁定 / 隐藏 / 整理预览 / 无其它拖拽」时出现；
 * - 拖拽期间只写 objectResizeStore.preview；
 * - 松手时调用 updateObject(..., true) 提交一次可撤销的等比尺寸变更，端口偏移同比缩放；
 * - 拖拽期间禁用 OrbitControls，仅在本会话持有禁用时恢复原值；
 * - 取消 / Esc / 失焦 / 外部几何变化 / 选中丢失 全部丢弃预览，不提交。
 */
export function ObjectResizeHandles({
  project,
  object,
  selected,
}: {
  project: Project
  object: SceneObject
  selected: boolean
}) {
  const { gl, camera, controls } = useThree()

  const [ctrlHeld, setCtrlHeld] = useState(false)
  const [activeCorner, setActiveCorner] = useState<ResizeCorner | null>(null)
  const ownedPreview = useObjectResizeStore((s) =>
    s.preview?.projectId === project.id && s.preview.objectId === object.id ? s.preview : null,
  )
  const setPreview = useObjectResizeStore((s) => s.setPreview)

  const sessionRef = useRef<{
    corner: ResizeCorner
    pointerId: number
    startX: number
    startY: number
    diagDx: number
    diagDy: number
    source: { width: number; height: number; depth: number }
    controlsWasEnabled: boolean
  } | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)

  const liveDims = ownedPreview?.dimensions ?? object.dimensions

  // ── Ctrl 监听（仅当可拖拽时挂载，避免全局无谓监听） ──
  const organizeBlocking = useOrganizeStore((s) => s.isPreviewBlocking())
  const eligibleBase = selected && object.visible && !object.locked && !organizeBlocking
  const cableMode = useWorkspaceStore((s) => s.mode === 'cable')
  const dragActive = useWorkspaceStore((s) => s.drag !== null)
  const cableDragging = useDrawerStore((s) => s.draggingId !== null)
  const eligible = eligibleBase && !cableMode && !dragActive && !cableDragging

  useEffect(() => {
    if (!eligible) { setCtrlHeld(false); return }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Control' && !isTextInput(e.target)) setCtrlHeld(true)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control') setCtrlHeld(false)
    }
    const onBlur = () => setCtrlHeld(false)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [eligible])

  // ── 会话丢弃：只恢复本会话曾禁用的 controls，不越权开启他人预览 ──
  const discardSession = useCallback(() => {
    const session = sessionRef.current
    cleanupRef.current?.()
    cleanupRef.current = null
    sessionRef.current = null
    setActiveCorner(null)
    if (session) {
      const c = controls as unknown as OrbitControlsImpl | null
      if (c) c.enabled = session.controlsWasEnabled
    }
    const preview = useObjectResizeStore.getState().preview
    if (preview?.projectId === project.id && preview.objectId === object.id) {
      useObjectResizeStore.getState().setPreview(null)
    }
  }, [controls, project.id, object.id])

  useEffect(
    () => () => {
      const session = sessionRef.current
      cleanupRef.current?.()
      cleanupRef.current = null
      sessionRef.current = null
      if (session) {
        const c = controls as unknown as OrbitControlsImpl | null
        if (c) c.enabled = session.controlsWasEnabled
      }
      // 仅当预览属于自己时才清空
      const preview = useObjectResizeStore.getState().preview
      if (preview?.projectId === project.id && preview.objectId === object.id) {
        useObjectResizeStore.getState().setPreview(null)
      }
    },
    [controls, project.id, object.id],
  )

  // ── 阻断条件变化时丢弃本会话 ──
  useEffect(() => {
    if (!selected || !object.visible || object.locked || organizeBlocking || cableMode || dragActive || cableDragging) {
      if (sessionRef.current || useObjectResizeStore.getState().preview?.objectId === object.id) {
        discardSession()
      }
    }
  }, [selected, object.visible, object.locked, organizeBlocking, cableMode, dragActive, cableDragging, object.id, discardSession])

  // ── 外部几何 / 端口 / 模型变化（props 原尺寸未变时并发修改）→ 取消本会话 ──
  const externalSig = JSON.stringify({
    dimensions: object.dimensions,
    ports: object.ports,
    model: object.model,
  })
  const lastExternalSig = useRef(externalSig)
  useEffect(() => {
    if (lastExternalSig.current !== externalSig) {
      lastExternalSig.current = externalSig
      if (sessionRef.current) discardSession()
    }
  }, [externalSig, discardSession])

  // ── 项目消失 → 取消 ──
  useEffect(() => {
    const unsub = useWorkspaceStore.subscribe((state, prev) => {
      if (prev.mode !== state.mode || prev.selectedId !== state.selectedId) {
        if (sessionRef.current) discardSession()
      }
    })
    return unsub
  }, [discardSession])

  const handlesVisible = eligible && ctrlHeld

  const physicalDims = bookPoseDimensions({ ...object, dimensions: liveDims })
  const corners = useMemo(() => cubeCorners(physicalDims), [physicalDims.width, physicalDims.height, physicalDims.depth])
  const radius = Math.min(
    HANDLE_RADIUS_MAX,
    Math.max(HANDLE_RADIUS_MIN, Math.max(liveDims.width, liveDims.height, liveDims.depth) * 0.025),
  )

  // ── 开始拖拽 ──
  const beginDrag = useCallback(
    (corner: ResizeCorner, pointerId: number, startX: number, startY: number) => {
      if (!handlesVisible || sessionRef.current) return
      cleanupRef.current?.()
      const controlsAny = controls as unknown as OrbitControlsImpl | null
      const controlsWasEnabled = controlsAny ? controlsAny.enabled : false

      const center = drawerDisplayPosition(object, project.room, currentDrawerOffsets())
      const rotY = object.transform.rotationY
      const source = {
        width: liveDims.width,
        height: liveDims.height,
        depth: liveDims.depth,
      }
      const original = useProjectsStore.getState().projects[project.id]?.objects.find((item) => item.id === object.id)
      if (!original || useObjectResizeStore.getState().preview) return
      const originalSignature = JSON.stringify(original)
      const diagonal = cornerDiagonal(bookPoseDimensions({ ...object, dimensions: source }), corner)

      const toWorld = (local: Vec3): Vec3 => {
        const cos = Math.cos(rotY)
        const sin = Math.sin(rotY)
        return [
          center[0] + (local[0] * cos + local[2] * sin),
          center[1] + local[1],
          center[2] + (-local[0] * sin + local[2] * cos),
        ]
      }

      const projectPoint = (point: Vec3) => {
        const v = new THREE.Vector3(point[0], point[1], point[2]).project(camera)
        if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) return null
        return { x: v.x, y: v.y }
      }

      const rect = gl.domElement.getBoundingClientRect()
      const originPx = projectToPixel(projectPoint, toWorld([0, 0, 0]), rect.width, rect.height)
      const cornerPx = projectToPixel(projectPoint, toWorld(diagonal), rect.width, rect.height)
      if (!originPx || !cornerPx) return

      const diagDx = cornerPx.x - originPx.x
      const diagDy = cornerPx.y - originPx.y
      if (Math.hypot(diagDx, diagDy) < DIAG_EPSILON) return

      if (controlsAny) controlsAny.enabled = false
      sessionRef.current = {
        corner,
        pointerId,
        startX,
        startY,
        diagDx,
        diagDy,
        source,
        controlsWasEnabled,
      }
      setActiveCorner(corner)
      setPreview({ projectId: project.id, objectId: object.id, dimensions: { ...source } })

      const onMove = (ev: PointerEvent) => {
        const s = sessionRef.current
        if (!s || ev.pointerId !== s.pointerId) return
        const scale = scaleFromScreenDrag(
          ev.clientX - s.startX,
          ev.clientY - s.startY,
          s.diagDx,
          s.diagDy,
        )
        if (scale === null) return
        const dimensions = clampUniformResize(s.source, scale)
        const currentProject = useProjectsStore.getState().projects[project.id]
        setPreview({
          projectId: project.id,
          objectId: object.id,
          dimensions,
          issue: currentProject ? resizeIssue(object, dimensions, currentProject.room, currentProject.objects) : '项目已关闭',
        })
      }

      const onUp = (ev: PointerEvent) => {
        const s = sessionRef.current
        if (!s || ev.pointerId !== s.pointerId) return
        onMove(ev)
        const finalPreview = useObjectResizeStore.getState().preview
        const current = useProjectsStore.getState().projects[project.id]?.objects.find((item) => item.id === object.id)
        const canCommit = current && JSON.stringify(current) === originalSignature && !useOrganizeStore.getState().isPreviewBlocking()
        cleanup()
        useObjectResizeStore.getState().setPreview(null)
        if (!canCommit || !finalPreview || finalPreview.projectId !== project.id || finalPreview.objectId !== object.id) return
        if (finalPreview.issue) { useWorkspaceStore.getState().setNotice(finalPreview.issue); return }
        const next = finalPreview.dimensions
        const changed =
          next.width !== object.dimensions.width ||
          next.height !== object.dimensions.height ||
          next.depth !== object.dimensions.depth
        if (!changed) return
        const factor = next.width / object.dimensions.width
        const nextPorts = object.ports.map((port) =>
          port.offset
            ? {
                ...port,
                offset: [port.offset[0] * factor, port.offset[1] * factor, port.offset[2] * factor] as Vec3,
                confirmed: false,
              }
            : { ...port, confirmed: false },
        )
        useWorkspaceStore.getState().updateObject(
          project.id,
          object.id,
          { dimensions: next, ports: nextPorts },
          true,
        )
      }

      const onCancelKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopImmediatePropagation()
          cancel()
          return
        }
        if (e.key === 'Control' && !e.repeat) return // keep session until mouseup
        if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
          e.preventDefault()
          e.stopImmediatePropagation()
          cancel()
          return
        }
        if (e.key === 'q' || e.key === 'e' || e.key === 'f' || e.key === 'Delete' || e.key === 'Backspace' || e.key.startsWith('Arrow')) {
          e.preventDefault()
          e.stopImmediatePropagation()
        }
      }

      const onBlur = () => {
        setCtrlHeld(false)
        cancel()
      }

      const cancel = () => {
        cleanup()
        setPreview(null)
      }

      const cleanup = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onCancelPointer)
        window.removeEventListener('keydown', onCancelKey, true)
        window.removeEventListener('blur', onBlur)
        unsubscribeProject()
        const c = controls as unknown as OrbitControlsImpl | null
        if (c && sessionRef.current) c.enabled = sessionRef.current.controlsWasEnabled
        sessionRef.current = null
        cleanupRef.current = null
        setActiveCorner(null)
        document.body.style.cursor = 'auto'
      }

      const onCancelPointer = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return
        cancel()
      }
      const unsubscribeProject = useProjectsStore.subscribe((state) => {
        const current = state.projects[project.id]?.objects.find((item) => item.id === object.id)
        if (JSON.stringify(current) !== originalSignature) cancel()
      })

      cleanupRef.current = cleanup
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onCancelPointer)
      window.addEventListener('keydown', onCancelKey, true)
      window.addEventListener('blur', onBlur)
      document.body.style.cursor = 'nwse-resize'
    },
    [handlesVisible, object, project.id, gl, camera, controls, liveDims, setPreview],
  )

  const onHandleDown = useCallback(
    (corner: ResizeCorner) => (e: ThreeEvent<PointerEvent>) => {
      if (e.button !== 0 || !e.ctrlKey) return
      e.stopPropagation()
      beginDrag(corner, e.pointerId, e.clientX, e.clientY)
    },
    [beginDrag],
  )

  if (!selected && !ownedPreview) return null

  return (
    <group position={[0, (physicalDims.height - liveDims.height) / 2, 0]}>
      {handlesVisible
        ? corners.map(({ corner, position }) => (
            <mesh
              key={`hit-${cornerKey(corner)}`}
              position={position}
              visible
              userData={{ resizeHitCorner: cornerKey(corner) }}
              onPointerDown={onHandleDown(corner)}
              onPointerOver={(e) => e.stopPropagation()}
              onPointerOut={(e) => e.stopPropagation()}
            >
              <sphereGeometry args={[radius * HIT_RADIUS_FACTOR, 8, 8]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} depthTest={false} />
              <mesh raycast={() => null} renderOrder={1000}>
                <sphereGeometry args={[radius, 14, 14]} />
                <meshBasicMaterial
                  color={activeCorner && cornerKey(activeCorner) === cornerKey(corner) ? '#F59E0B' : '#0F9D8A'}
                  depthTest={false}
                  depthWrite={false}
                  transparent
                  opacity={0.95}
                />
              </mesh>
            </mesh>
          ))
        : null}

      {handlesVisible && !ownedPreview ? (
        <Html fullscreen calculatePosition={(_, __, size) => [size.width / 2, size.height / 2]} style={{ pointerEvents: 'none' }} zIndexRange={[5, 0]}>
          <div
            data-testid="object-resize-hint"
            style={{
              position: 'absolute',
              top: 56,
              right: 12,
              width: 220,
              maxWidth: 'calc(100vw - 24px)',
              padding: '4px 10px',
              borderRadius: 6,
              background: 'rgba(15,157,138,0.92)',
              color: '#fff',
              fontSize: 12,
              pointerEvents: 'none',
            }}
          >
            按住 Ctrl 拖拽角点等比缩放
          </div>
        </Html>
      ) : null}

      {ownedPreview ? (
        <Html fullscreen calculatePosition={(_, __, size) => [size.width / 2, size.height / 2]} style={{ pointerEvents: 'none' }} zIndexRange={[10, 1]}>
          <div
            data-testid="object-resize-panel"
            style={{
              position: 'absolute',
              top: 56,
              right: 12,
              width: 220,
              maxWidth: 'calc(100vw - 24px)',
              padding: '8px 12px',
              borderRadius: 8,
              background: 'rgba(17,24,39,0.92)',
              color: '#fff',
              fontSize: 12,
              lineHeight: 1.5,
              pointerEvents: 'none',
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>等比缩放（Ctrl）</div>
            <div>宽 {(ownedPreview.dimensions.width * 1000).toFixed(1)} mm</div>
            <div>高 {(ownedPreview.dimensions.height * 1000).toFixed(1)} mm</div>
            <div>深 {(ownedPreview.dimensions.depth * 1000).toFixed(1)} mm</div>
            <div style={{ color: ownedPreview.issue ? '#FCA5A5' : undefined, marginTop: 4 }}>{ownedPreview.issue ?? 'Esc 取消 · 松开保存'}</div>
          </div>
        </Html>
      ) : null}
    </group>
  )
}

/** 供外部 / 集成参考：等比缩放边界 */
export const OBJECT_RESIZE_BOUNDS = { min: RESIZE_MIN, max: RESIZE_MAX }
