import { useEffect, useRef } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import { Matrix3 } from 'three'
import type { Project, SceneObject } from '@/types/project'
import { useOrganizeStore } from '@/state/organizeStore'
import { useWorkspaceStore } from '@/state/workspaceStore'
import { useConnectionsStore } from './store'
import { surfaceHit } from './model'

/** Attach to the model group, excluding selection and collision helper meshes. */
export function useSurfacePortPick(project: Project, object: SceneObject, isolated = false) {
  const start = useRef<{ id: number; x: number; y: number } | null>(null)
  const active = useConnectionsStore(s => s.projectId === project.id && s.pickingObjectId === object.id)
  const canPick = () => active && object.visible && (isolated || useWorkspaceStore.getState().mode === 'cable')
    && !useOrganizeStore.getState().isPreviewBlocking()
  useEffect(() => {
    const clear = () => { start.current = null; useConnectionsStore.getState().setPointerActive(false) }
    window.addEventListener('pointerup', clear)
    window.addEventListener('pointercancel', clear)
    window.addEventListener('blur', clear)
    return () => { window.removeEventListener('pointerup', clear); window.removeEventListener('pointercancel', clear); window.removeEventListener('blur', clear) }
  }, [])
  function hit(e: ThreeEvent<PointerEvent>) {
    if (!e.face) return null
    const n = e.face.normal.clone().applyNormalMatrix(new Matrix3().getNormalMatrix(e.object.matrixWorld))
    return surfaceHit(object, e.point.toArray(), n.toArray())
  }
  return {
    active,
    onPointerDown(e: ThreeEvent<PointerEvent>) {
      if (!canPick() || e.button !== 0 || e.isPrimary === false) return
      e.stopPropagation()
      start.current = { id: e.pointerId, x: e.nativeEvent.clientX, y: e.nativeEvent.clientY }
      useConnectionsStore.getState().setPointerActive(true)
    },
    onPointerMove(e: ThreeEvent<PointerEvent>) {
      if (!canPick()) return
      const s = start.current
      if (s && Math.hypot(e.nativeEvent.clientX-s.x, e.nativeEvent.clientY-s.y) > 4) start.current = null
      useConnectionsStore.getState().setHover(hit(e))
    },
    onPointerUp(e: ThreeEvent<PointerEvent>) {
      const s = start.current; start.current = null
      if (!canPick()) return
      e.stopPropagation()
      useConnectionsStore.getState().setPointerActive(false)
      if (!s || s.id !== e.pointerId || Math.hypot(e.nativeEvent.clientX-s.x, e.nativeEvent.clientY-s.y) > 4) return
      const point = hit(e)
      if (point) { useConnectionsStore.getState().setHit(point); useConnectionsStore.getState().setHover(null) }
    },
    onPointerOut() { useConnectionsStore.getState().setHover(null) },
    onPointerCancel() { start.current = null; useConnectionsStore.getState().setPointerActive(false) },
  }
}
