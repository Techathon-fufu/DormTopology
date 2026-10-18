import { create } from 'zustand'
import { useMemo } from 'react'
import { clampDrawerProgress, snapDrawerTarget, drawerSlideX, DORM_DESK_DRAWERS, type DrawerSlotId } from '@/scene/dormDeskDrawers'

/**
 * 抽屉开合会话状态（不持久化、不进方案快照；刷新后回到全闭）。
 *
 * - `progress / target` 为运动学驱动数据：拖动直接写 progress，其余由 DormDeskModel
 *   的逐帧缓动把 progress 推向 target；
 * - `loadedIds` 在桌体分离件挂载 / 卸载时更新（视图与自动检查据此判断可用性）；
 * - `draggingId` 供相机锁定（CameraRig 拖拽期间禁用轨道控制）与交互互斥。
 */
export interface DrawerRuntimeState {
  progress: number
  target: 0 | 1
}

interface DrawerStoreState {
  drawers: Record<DrawerSlotId, DrawerRuntimeState>
  loadedIds: DrawerSlotId[]
  draggingId: DrawerSlotId | null
  hoveredId: DrawerSlotId | null
  setLoaded: (ids: DrawerSlotId[]) => void
  setHovered: (id: DrawerSlotId | null) => void
  beginDrag: (id: DrawerSlotId) => void
  setProgress: (id: DrawerSlotId, progress: number) => void
  endDrag: () => void
  /** 松手吸附：目标取最近吸附点（progress ≥ 0.5 → 全开，否则全关） */
  snapAfterDrag: (id: DrawerSlotId) => void
  /** 单击开 / 关切换（按当前目标取反） */
  toggle: (id: DrawerSlotId) => void
  open: (id: DrawerSlotId) => void
  closeAll: () => void
  reset: () => void
}

const closed = (): DrawerRuntimeState => ({ progress: 0, target: 0 })
const closedAll = (): Record<DrawerSlotId, DrawerRuntimeState> => ({
  bot: closed(),
  mid: closed(),
  top: closed(),
})

export const useDrawerStore = create<DrawerStoreState>((set) => ({
  drawers: closedAll(),
  loadedIds: [],
  draggingId: null,
  hoveredId: null,
  setLoaded: (ids) => set({ loadedIds: ids }),
  setHovered: (id) => set({ hoveredId: id }),
  beginDrag: (id) => set({ draggingId: id }),
  setProgress: (id, progress) =>
    set((s) => ({
      drawers: { ...s.drawers, [id]: { ...s.drawers[id], progress: clampDrawerProgress(progress) } },
    })),
  endDrag: () => set({ draggingId: null }),
  snapAfterDrag: (id) =>
    set((s) => ({
      drawers: {
        ...s.drawers,
        [id]: { ...s.drawers[id], target: snapDrawerTarget(s.drawers[id].progress) },
      },
    })),
  toggle: (id) =>
    set((s) => ({
      drawers: {
        ...s.drawers,
        [id]: { ...s.drawers[id], target: s.drawers[id].target === 1 ? 0 : 1 },
      },
    })),
  open: (id) => set((s) => ({ drawers: { ...s.drawers, [id]: { ...s.drawers[id], target: 1 } } })),
  closeAll: () => set({ drawers: closedAll(), draggingId: null, hoveredId: null }),
  reset: () => set({ drawers: closedAll(), loadedIds: [], draggingId: null, hoveredId: null }),
}))

export function currentDrawerOffsets(drawers = useDrawerStore.getState().drawers) {
  return Object.fromEntries(DORM_DESK_DRAWERS.map((spec) => [spec.id, drawerSlideX(spec.travelM, drawers[spec.id].progress)]))
}
export function useDrawerOffsets() {
  const drawers = useDrawerStore((s) => s.drawers)
  return useMemo(() => currentDrawerOffsets(drawers), [drawers])
}
