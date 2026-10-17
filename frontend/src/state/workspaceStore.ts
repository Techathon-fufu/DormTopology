import { create } from 'zustand'
import type {
  CableConnection,
  LayoutAssignment,
  LayoutPlan,
  PowerStripConfig,
  SceneObject,
  Vec3,
} from '@/types/project'
import { ensureDefaultPorts as defaultPortsForObject } from '@/scene/ports'
import { cableRoutingObjectsSignature, invalidateCableRoutes } from '@/scene/cables'
import { computePowerStripSpecChange, stripLengthFor } from '@/scene/powerStrip'
import { clonePlanData } from '@/lib/plans'
import { assertScenePlacement, objectsWithAssignments } from '@/lib/organizationValidation'
import { useProjectsStore } from './projectsStore'
import { usePlansStore } from './plansStore'
import { useCableStore } from './cableStore'
import { useOrganizeStore } from './organizeStore'

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
  support: 'desk' | 'shelf' | 'drawer' | 'beam' | 'floor' | 'none'
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

/** 「设为当前方案」执行结果（供界面提示） */
export interface PlanApplySummary {
  /** 已恢复位姿 / 插排规格的物品数 */
  objects: number
  /** 已还原的方案内线缆数 */
  cables: number
  /** 保留的保存之后新增的线缆数 */
  keptCables: number
  /** 方案中有、但当前项目已不存在的物品数 */
  skippedObjects: number
  /** 快照线缆中引用的物品 / 接口已不存在而跳过的条数 */
  skippedCables: number
  /** true = 旧版本方案（无场景快照，仅恢复物品位姿） */
  legacy: boolean
}

function pushPast(past: HistorySnapshot[], snapshot: HistorySnapshot): HistorySnapshot[] {
  const next = [...past, snapshot]
  if (next.length > HISTORY_LIMIT) next.shift()
  return next
}

/**
 * Any changed object can obstruct any route, including routes attached to other devices.
 * 仅在状态确实变化时返回新数组（避免无意义的存储写入）。
 */
function markStaleCables(cables: CableConnection[], objectIds: string[]): CableConnection[] {
  return objectIds.length === 0 ? cables : invalidateCableRoutes(cables)
}

function cableInputs(cable: CableConnection): string {
  return JSON.stringify({
    from: cable.from, to: cable.to, kind: cable.kind, thickness: cable.thickness,
    visibility: cable.visibility, actualLengthM: cable.actualLengthM,
    reserveLengthM: cable.reserveLengthM, route: { points: cable.route.points,
      nodeIds: cable.route.nodeIds, smooth: cable.route.smooth, strategy: cable.route.strategy },
  })
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
  /**
   * 将候选方案设为当前方案：恢复物品位姿 / 插排规格 / 接口与线缆（一次提交，可撤销）。
   * - 全量快照：以快照为准还原；保存之后新增的设备与其线缆保留（不删除用户新工作）；
   * - 旧版本方案（无快照）：仅恢复物品位姿，线缆不动；
   * - 只读取方案数据（深拷贝），不修改原方案。
   */
  applyPlanSnapshot: (projectId: string, plan: LayoutPlan) => PlanApplySummary | null
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
    if (useOrganizeStore.getState().applying) throw new Error('整理方案正在应用，请稍后再修改场景')
    const project = useProjectsStore.getState().projects[projectId]
    if (!project) return
    let cables = patch.cables ?? project.cables
    if (patch.objects && cableRoutingObjectsSignature(patch.objects) !== cableRoutingObjectsSignature(project.objects)) {
      cables = markStaleCables(cables, ['scene-geometry'])
      const objects = new Map(patch.objects.map((o) => [o.id, o]))
      cables = cables.map((c) => {
        const hasPort = (end: CableConnection['from']) => objects.get(end.objectId)?.ports.some((p) => p.id === end.portId)
        return hasPort(c.from) && hasPort(c.to) ? c : {
          ...c, status: 'conflict' as const,
          note: '端点设备或接口已被删除，请重新指定连接（原线缆保留）',
        }
      })
      useCableStore.getState().resetAnim()
    }
    set((s) => ({
      past: record ? pushPast(s.past, { objects: project.objects, cables: project.cables }) : s.past,
      future: record ? [] : s.future,
    }))
    useProjectsStore.getState().update(projectId, (p) => ({
      ...p,
      objects: patch.objects ?? p.objects,
      cables,
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
      if (useOrganizeStore.getState().applying) return
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
        cables: invalidateCableRoutes(prev.cables),
      }))
      useCableStore.getState().resetAnim()
    },

    redo(projectId) {
      if (useOrganizeStore.getState().applying) return
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
        cables: invalidateCableRoutes(next.cables),
      }))
      useCableStore.getState().resetAnim()
    },

    updateObject(projectId, objectId, patch, record = true) {
      const project = useProjectsStore.getState().projects[projectId]
      if (!project) return
      const { transform: tPatch, dimensions: dPatch, model: mPatch, ...rest } = patch
      const next = project.objects.map((o) => {
        if (o.id !== objectId) return o
        const dimensions = dPatch ? { ...o.dimensions, ...dPatch } : o.dimensions
        const dimensionsChanged = JSON.stringify(dimensions) !== JSON.stringify(o.dimensions)
        const ports = (rest.ports ?? o.ports).map((port) => {
          const previous = o.ports.find((p) => p.id === port.id)
          const geometry = (p: typeof port) => JSON.stringify({ type: p.type, powered: p.powered, offset: p.offset, direction: p.direction })
          return dimensionsChanged || !previous || geometry(previous) !== geometry(port)
            ? { ...port, confirmed: false } : port
        })
        return {
          ...o,
          ...rest,
          transform: tPatch ? { ...o.transform, ...tPatch } : o.transform,
          dimensions,
          ports,
          model: mPatch ? { ...o.model, ...mPatch } : o.model,
        }
      })
      commit(
        projectId,
        {
          objects: next,
          cables: project.cables,
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
      change.object.ports = change.object.ports.map((port) => ({ ...port, confirmed: false }))
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

    applyPlanSnapshot(projectId, plan) {
      const project = useProjectsStore.getState().projects[projectId]
      if (!project) return null
      if (plan.projectId !== projectId) throw new Error('该方案属于其他项目，不能应用')
      const now = Date.now()
      const finish = (summary: PlanApplySummary): PlanApplySummary => {
        useProjectsStore.getState().update(projectId, (p) => ({
          ...p,
          lastAppliedPlan: { planId: plan.id, at: now },
        }))
        return summary
      }

      // 旧版本方案（0.8.0 之前保存）：仅有物品位姿，按现状恢复（线缆保持不动）
      if (!plan.scene) {
        const exists = new Set(project.objects.map((o) => o.id))
        const assignments = plan.assignments
          .filter((a) => exists.has(a.objectId))
          .map((a) => ({
            objectId: a.objectId,
            position: [...a.position] as Vec3,
            rotationY: a.rotationY,
          }))
        const nextObjects = objectsWithAssignments(project.objects, assignments)
        assertScenePlacement(nextObjects, project.room, project.objects)
        commit(projectId, { objects: nextObjects, cables: invalidateCableRoutes(project.cables) }, true)
        useCableStore.getState().resetAnim()
        return finish({
          objects: assignments.length,
          cables: 0,
          keptCables: project.cables.length,
          skippedObjects: plan.assignments.length - assignments.length,
          skippedCables: 0,
          legacy: true,
        })
      }

      // 全量快照：恢复物品位姿 / 插排规格（含长度重算）/ 接口，再合并线缆
      const snapshotById = new Map(plan.scene.objects.map((o) => [o.id, o]))
      let appliedObjects = 0
      const nextObjects = project.objects.map((o) => {
        const snap = snapshotById.get(o.id)
        if (!snap) return o
        appliedObjects += 1
        const strip = snap.powerStrip
        return {
          ...o,
          transform: {
            ...o.transform,
            position: [...snap.transform.position] as Vec3,
            rotationY: snap.transform.rotationY,
          },
          ...(strip
            ? {
                powerStrip: clonePlanData(strip),
                dimensions: {
                  ...o.dimensions,
                  width: stripLengthFor(strip.socketCount, strip.socketSpacing),
                },
              }
            : {}),
          ports: snap.ports ? clonePlanData(snap.ports) : o.ports,
        }
      })
      assertScenePlacement(nextObjects, project.room, project.objects)

      const portIdsByObject = new Map(nextObjects.map((o) => [o.id, new Set(o.ports.map((p) => p.id))]))
      const endpointOk = (end: CableConnection['from']): boolean => {
        const ports = portIdsByObject.get(end.objectId)
        if (!ports) return false
        return !end.portId || ports.has(end.portId)
      }
      const endpointPairKey = (c: CableConnection): string =>
        `${c.from.objectId}:${c.from.portId ?? ''}→${c.to.objectId}:${c.to.portId ?? ''}`

      const restoredCables: CableConnection[] = []
      let skippedCables = 0
      for (const cable of plan.scene.cables) {
        if (!endpointOk(cable.from) || !endpointOk(cable.to)) {
          skippedCables += 1
          continue
        }
        restoredCables.push(clonePlanData(cable))
      }
      // 保留保存之后新增、且不引用方案内设备的线缆（同一接口对以方案为准）
      const planCableIds = new Set(plan.scene.cables.map((c) => c.id))
      const planPairKeys = new Set(plan.scene.cables.map(endpointPairKey))
      let keptCables = 0
      for (const cable of project.cables) {
        if (planCableIds.has(cable.id)) continue
        if (planPairKeys.has(endpointPairKey(cable))) continue
        if (snapshotById.has(cable.from.objectId) || snapshotById.has(cable.to.objectId)) continue
        restoredCables.push(cable)
        keptCables += 1
      }

      commit(projectId, { objects: nextObjects, cables: invalidateCableRoutes(restoredCables) }, true)
      useCableStore.getState().resetAnim()
      return finish({
        objects: appliedObjects,
        cables: restoredCables.length - keptCables,
        keptCables,
        skippedObjects: plan.scene.objects.length - appliedObjects,
        skippedCables,
        legacy: false,
      })
    },

    resetToBaseline(projectId) {
      const project = useProjectsStore.getState().projects[projectId]
      const baseline = usePlansStore.getState().baselines[projectId]
      if (!project || !baseline) return
      if (baseline.projectId !== projectId) throw new Error('整理前快照属于其他项目')
      const existing = new Set(project.objects.map((object) => object.id))
      const assignments = baseline.assignments.filter((assignment) => existing.has(assignment.objectId))
      const objects = objectsWithAssignments(project.objects, assignments)
      assertScenePlacement(objects, project.room, project.objects)
      commit(projectId, { objects, cables: markStaleCables(project.cables, assignments.map((assignment) => assignment.objectId)) }, true)
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
      commit(projectId, { cables: invalidateCableRoutes([...project.cables, cable]) }, true)
      useCableStore.getState().resetAnim()
    },

    updateCable(projectId, cableId, updater, record = true) {
      const project = useProjectsStore.getState().projects[projectId]
      if (!project) return
      let changed = false
      const next = project.cables.map((c) => {
        if (c.id !== cableId) return c
        const updated = updater(c)
        if (cableInputs(updated) === cableInputs(c)) return updated
        changed = true
        const { verification: _verification, pathLengthM: _pathLengthM, ...route } = updated.route
        useCableStore.getState().resetAnim()
        return {
          ...updated, route,
          planSource: 'manual' as const,
          status: updated.status === 'conflict' ? 'conflict' as const : 'stale' as const,
          updatedAt: Date.now(),
        }
      })
      const cables = changed ? invalidateCableRoutes(next).map((cable) =>
        cable.id === cableId && next.find((entry) => entry.id === cableId)?.status === 'conflict'
          ? { ...cable, status: 'conflict' as const } : cable,
      ) : next
      commit(projectId, { cables }, record)
    },

    removeCable(projectId, cableId, record = true) {
      const project = useProjectsStore.getState().projects[projectId]
      if (!project) return
      commit(projectId, { cables: invalidateCableRoutes(project.cables.filter((c) => c.id !== cableId)) }, record)
      useCableStore.getState().resetAnim()
      useCableStore.getState().onCableRemoved(cableId)
    },

    replaceCables(projectId, cables, record = true) {
      commit(projectId, { cables }, record)
    },
  }
})
