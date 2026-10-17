import { create } from 'zustand'
import type {
  CableConnection,
  LayoutAssignment,
  PowerStripConfig,
  SceneObject,
  Vec3,
} from '@/types/project'
import { ensureDefaultPorts as defaultPortsForObject } from '@/scene/ports'
import { computePowerStripSpecChange } from '@/scene/powerStrip'
import { useProjectsStore } from './projectsStore'
import { usePlansStore } from './plansStore'
import { useCableStore } from './cableStore'

export type WorkspaceMode = 'organize' | 'cable'
export type ViewPreset = 'persp' | 'front' | 'top' | 'left' | 'right' | 'desk'

/**
 * 拖拽预览（仅存在于会话内，不写入项目存储）。
 * 拖拽过程中只更新该状态，场景中仅被拖拽的网格响应，避免整页重渲染；
 * 松开指针时才提交一次到项目存储（一次可撤销的移动记录）。
 */
export interface DragState {
  objectId: string
  /** 已吸附的预览位置（米） */
  position: Vec3
  /** 吸附到的支撑面 */
  support: 'desk' | 'shelf' | 'beam' | 'floor' | 'none'
  /** 预览位置是否通过越界 / 相交校验 */
  valid: boolean
  /** 上一次有效预览位置（指针未命中支撑面时回退用） */
  lastValid: Vec3
}

export type ObjectPatch = Partial<
  Pick<
    SceneObject,
    | 'name'
    | 'category'
    | 'quantity'
    | 'needsPower'
    | 'ports'
    | 'visible'
    | 'note'
    | 'fixed'
    | 'locked'
    | 'frequent'
  >
> & {
  transform?: Partial<SceneObject['transform']>
  dimensions?: Partial<SceneObject['dimensions']>
  model?: Partial<SceneObject['model']>
}

/** 历史快照：物品与线缆一起记录（移动设备会同时标记相关走线需重算，撤销时一并还原） */
interface HistorySnapshot {
  objects: SceneObject[]
  cables: CableConnection[]
}

const HISTORY_LIMIT = 40

function pushPast(past: HistorySnapshot[], snapshot: HistorySnapshot): HistorySnapshot[] {
  const next = [...past, snapshot]
  if (next.length > HISTORY_LIMIT) next.shift()
  return next
}

/**
 * 设备移动 / 旋转 / 接口变化后，把引用该设备的线缆标记为「需重新计算」。
 * 仅在状态确实变化时返回新数组（避免无意义的存储写入）。
 */
function markStaleCables(cables: CableConnection[], objectIds: string[]): CableConnection[] {
  if (objectIds.length === 0) return cables
  const ids = new Set(objectIds)
  let changed = false
  const next = cables.map((c) => {
    if (!ids.has(c.from.objectId) && !ids.has(c.to.objectId)) return c
    if (c.status === 'stale') return c
    changed = true
    return { ...c, status: 'stale' as const, updatedAt: Date.now() }
  })
  return changed ? next : cables
}

/**
 * 工作台会话状态：模式、视角、选中、撤销/重做历史。
 * 场景对象与线缆本体存于 projectsStore（持久化），历史堆栈为会话级。
 */
interface WorkspaceState {
  mode: WorkspaceMode
  viewPreset: ViewPreset
  /** 视角重置计数：同一预设再次触发时也会重新应用相机 */
  viewNonce: number
  selectedId: string | null
  /** 拖拽预览（会话级，不持久化） */
  drag: DragState | null
  past: HistorySnapshot[]
  future: HistorySnapshot[]
  lastScore: number | null
  setMode: (mode: WorkspaceMode) => void
  setViewPreset: (p: ViewPreset) => void
  /** 应用视角预设并强制重新应用相机（重复进入同一预设也会生效；导览步骤切换用） */
  applyViewPreset: (p: ViewPreset) => void
  resetView: () => void
  setDrag: (drag: DragState | null) => void
  select: (id: string | null) => void
  resetHistory: () => void
  setLastScore: (score: number | null) => void
  undo: (projectId: string) => void
  redo: (projectId: string) => void
  updateObject: (projectId: string, objectId: string, patch: ObjectPatch, record?: boolean) => void
  addObject: (projectId: string, object: SceneObject) => void
  removeObject: (projectId: string, objectId: string) => void
  replaceObjects: (projectId: string, objects: SceneObject[], record?: boolean) => void
  /**
   * 切换插排规格（4/6/8 位 / 孔距 / 负载上限）：
   * 一次提交完成「长度重算 + 插孔端口重建 + 线缆状态更新」（可一次撤销）；
   * 超出新容量的连接标记 conflict（保留不删除），保留插孔上的连接标记 stale（需重算）。
   */
  applyPowerStripSpec: (
    projectId: string,
    objectId: string,
    next: Partial<PowerStripConfig>,
  ) => { removed: number; affected: number; socketCount: number } | null
  applyAssignments: (
    projectId: string,
    assignments: Pick<LayoutAssignment, 'objectId' | 'position' | 'rotationY'>[],
    record?: boolean,
  ) => void
  resetToBaseline: (projectId: string) => void
  /** 为缺少接口的电气设备补充默认接口（返回补充数量） */
  ensureDefaultPorts: (projectId: string) => number
  // ── 线缆操作（与物品共用同一历史，可撤销） ──
  addCable: (projectId: string, cable: CableConnection) => void
  updateCable: (
    projectId: string,
    cableId: string,
    updater: (cable: CableConnection) => CableConnection,
    record?: boolean,
  ) => void
  removeCable: (projectId: string, cableId: string, record?: boolean) => void
  replaceCables: (projectId: string, cables: CableConnection[], record?: boolean) => void
}

export const useWorkspaceStore = create<WorkspaceState>()((set, get) => {
  /** 统一的「记录历史 + 写入项目」入口（物品与线缆一并快照） */
  function commit(
    projectId: string,
    patch: { objects?: SceneObject[]; cables?: CableConnection[] },
    record: boolean,
  ) {
    const project = useProjectsStore.getState().projects[projectId]
    if (!project) return
    set((s) => ({
      past: record ? pushPast(s.past, { objects: project.objects, cables: project.cables }) : s.past,
      future: record ? [] : s.future,
    }))
    useProjectsStore.getState().update(projectId, (p) => ({
      ...p,
      objects: patch.objects ?? p.objects,
      cables: patch.cables ?? p.cables,
    }))
  }

  return {
    mode: 'organize',
    viewPreset: 'persp',
    viewNonce: 0,
    selectedId: null,
    drag: null,
    past: [],
    future: [],
    lastScore: null,
    setMode: (mode) => set({ mode }),
    setViewPreset: (viewPreset) => set({ viewPreset }),
    applyViewPreset: (viewPreset) => set((s) => ({ viewPreset, viewNonce: s.viewNonce + 1 })),
    resetView: () => set((s) => ({ viewPreset: 'persp', viewNonce: s.viewNonce + 1 })),
    setDrag: (drag) => set({ drag }),
    select: (selectedId) => set({ selectedId }),
    resetHistory: () => set({ past: [], future: [], lastScore: null }),
    setLastScore: (lastScore) => set({ lastScore }),

    undo(projectId) {
      const state = get()
      const prev = state.past[state.past.length - 1]
      const project = useProjectsStore.getState().projects[projectId]
      if (!prev || !project) return
      set({
        past: state.past.slice(0, -1),
        future: [
          { objects: project.objects, cables: project.cables },
          ...state.future,
        ].slice(0, HISTORY_LIMIT),
      })
      useProjectsStore.getState().update(projectId, (p) => ({
        ...p,
        objects: prev.objects,
        cables: prev.cables,
      }))
    },

    redo(projectId) {
      const state = get()
      const next = state.future[0]
      const project = useProjectsStore.getState().projects[projectId]
      if (!next || !project) return
      set({
        future: state.future.slice(1),
        past: pushPast(state.past, { objects: project.objects, cables: project.cables }),
      })
      useProjectsStore.getState().update(projectId, (p) => ({
        ...p,
        objects: next.objects,
        cables: next.cables,
      }))
    },

    updateObject(projectId, objectId, patch, record = true) {
      const project = useProjectsStore.getState().projects[projectId]
      if (!project) return
      const { transform: tPatch, dimensions: dPatch, model: mPatch, ...rest } = patch
      // 位置 / 旋转 / 接口变化 → 相关走线标记为「需重新计算」
      const touchesRoute = Boolean(tPatch) || rest.ports !== undefined
      const next = project.objects.map((o) => {
        if (o.id !== objectId) return o
        return {
          ...o,
          ...rest,
          transform: tPatch ? { ...o.transform, ...tPatch } : o.transform,
          dimensions: dPatch ? { ...o.dimensions, ...dPatch } : o.dimensions,
          model: mPatch ? { ...o.model, ...mPatch } : o.model,
        }
      })
      commit(
        projectId,
        {
          objects: next,
          cables: touchesRoute ? markStaleCables(project.cables, [objectId]) : project.cables,
        },
        record,
      )
    },

    addObject(projectId, object) {
      const project = useProjectsStore.getState().projects[projectId]
      if (!project) return
      commit(projectId, { objects: [...project.objects, object] }, true)
      set({ selectedId: object.id })
    },

    removeObject(projectId, objectId) {
      const project = useProjectsStore.getState().projects[projectId]
      if (!project) return
      const affected = project.cables.filter(
        (c) => c.from.objectId === objectId || c.to.objectId === objectId,
      )
      commit(
        projectId,
        {
          objects: project.objects.filter((o) => o.id !== objectId),
          cables: project.cables.filter(
            (c) => c.from.objectId !== objectId && c.to.objectId !== objectId,
          ),
        },
        true,
      )
      if (get().selectedId === objectId) set({ selectedId: null })
      const cableStore = useCableStore.getState()
      for (const c of affected) cableStore.onCableRemoved(c.id)
      if (affected.length > 0) {
        cableStore.setNotice(`已随设备删除 ${affected.length} 条关联线缆（Ctrl+Z 可撤销）`)
      }
    },

    replaceObjects(projectId, objects, record = true) {
      commit(projectId, { objects }, record)
    },

    applyPowerStripSpec(projectId, objectId, next) {
      const project = useProjectsStore.getState().projects[projectId]
      if (!project) return null
      const strip = project.objects.find((o) => o.id === objectId)
      if (!strip) return null
      const change = computePowerStripSpecChange(strip, project.cables, next)
      const removed = new Set(change.removedPortCableIds)
      const affected = new Set(change.affectedCableIds)
      const cables = project.cables.map((c) => {
        if (removed.has(c.id)) {
          return {
            ...c,
            status: 'conflict' as const,
            note: `排插规格调整为 ${change.config.socketCount} 位：该连接所在插孔已被移除，请改插到保留插孔（连接未删除）`,
            updatedAt: Date.now(),
          }
        }
        if (affected.has(c.id) && c.status !== 'stale' && c.status !== 'conflict') {
          return { ...c, status: 'stale' as const, updatedAt: Date.now() }
        }
        return c
      })
      commit(
        projectId,
        { objects: project.objects.map((o) => (o.id === objectId ? change.object : o)), cables },
        true,
      )
      return {
        removed: change.removedPortCableIds.length,
        affected: change.affectedCableIds.length,
        socketCount: change.config.socketCount,
      }
    },

    applyAssignments(projectId, assignments, record = true) {
      const project = useProjectsStore.getState().projects[projectId]
      if (!project) return
      const byId = new Map(assignments.map((a) => [a.objectId, a]))
      const movedIds: string[] = []
      const next = project.objects.map((o) => {
        const a = byId.get(o.id)
        if (!a) return o
        const changed =
          a.position[0] !== o.transform.position[0] ||
          a.position[1] !== o.transform.position[1] ||
          a.position[2] !== o.transform.position[2] ||
          a.rotationY !== o.transform.rotationY
        if (changed) movedIds.push(o.id)
        return {
          ...o,
          transform: { position: a.position, rotationY: a.rotationY },
        }
      })
      commit(
        projectId,
        { objects: next, cables: markStaleCables(project.cables, movedIds) },
        record,
      )
    },

    resetToBaseline(projectId) {
      const baseline = usePlansStore.getState().baselines[projectId]
      if (!baseline) return
      get().applyAssignments(
        projectId,
        baseline.assignments.map((a) => ({
          objectId: a.objectId,
          position: a.position,
          rotationY: a.rotationY,
        })),
        true,
      )
    },

    ensureDefaultPorts(projectId) {
      const project = useProjectsStore.getState().projects[projectId]
      if (!project) return 0
      let count = 0
      const next = project.objects.map((o) => {
        const ports = defaultPortsForObject(o)
        if (!ports) return o
        count += 1
        return { ...o, ports }
      })
      if (count > 0) {
        commit(projectId, { objects: next }, true)
      }
      return count
    },

    addCable(projectId, cable) {
      const project = useProjectsStore.getState().projects[projectId]
      if (!project) return
      commit(projectId, { cables: [...project.cables, cable] }, true)
    },

    updateCable(projectId, cableId, updater, record = true) {
      const project = useProjectsStore.getState().projects[projectId]
      if (!project) return
      const next = project.cables.map((c) => (c.id === cableId ? updater(c) : c))
      commit(projectId, { cables: next }, record)
    },

    removeCable(projectId, cableId, record = true) {
      const project = useProjectsStore.getState().projects[projectId]
      if (!project) return
      commit(projectId, { cables: project.cables.filter((c) => c.id !== cableId) }, record)
      useCableStore.getState().onCableRemoved(cableId)
    },

    replaceCables(projectId, cables, record = true) {
      commit(projectId, { cables }, record)
    },
  }
})
