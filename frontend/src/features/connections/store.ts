import { create } from 'zustand'
import type { SurfaceHit } from './model'

/**
 * 连接面板的临时会话状态（不持久化草稿）。
 *
 * 关闭 / 重置后不保留 projectId、拾取目标或最近命中，避免把未提交的编辑写入项目。
 */
export interface ConnectionsState {
  projectId: string | null
  pickingObjectId: string | null
  editingPortId: string | null
  hit: SurfaceHit | null
  hover: SurfaceHit | null
  panelOpen: boolean
  pointerActive: boolean
  open: (projectId: string) => void
  close: () => void
  startPick: (projectId: string, objectId: string, portId?: string) => void
  setHit: (hit: SurfaceHit) => void
  setHover: (hit: SurfaceHit | null) => void
  setPointerActive: (pointerActive: boolean) => void
  cancelPick: () => void
  reset: () => void
}

const initial = {
  projectId: null,
  pickingObjectId: null,
  editingPortId: null,
  hit: null,
  hover: null,
  panelOpen: false,
  pointerActive: false,
} satisfies Omit<ConnectionsState, 'open' | 'close' | 'startPick' | 'setHit' | 'setHover' | 'setPointerActive' | 'cancelPick' | 'reset'>

export const useConnectionsStore = create<ConnectionsState>()((set) => ({
  ...initial,
  open: (projectId) => set({ projectId, panelOpen: true }),
  close: () => set({ panelOpen: false, pickingObjectId: null, editingPortId: null, hit: null, hover: null, pointerActive: false }),
  startPick: (projectId, objectId, portId) => set({
    projectId,
    panelOpen: true,
    pickingObjectId: objectId,
    editingPortId: portId ?? null,
    hit: null,
    hover: null,
    pointerActive: false,
  }),
  setHit: (hit) => set({ hit }),
  setHover: (hover) => set({ hover }),
  setPointerActive: (pointerActive) => set({ pointerActive }),
  cancelPick: () => set({ pickingObjectId: null, editingPortId: null, hit: null, hover: null, pointerActive: false }),
  reset: () => set({ ...initial }),
}))
