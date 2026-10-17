import { create } from 'zustand'
import type { RoomConfig, SceneObject, Vec3 } from '@/types/project'
import type { OrganizationPlan } from '@/types/organization'
import { compileOrganizationCommands } from '@/lib/organizationCommands'
import { prefersReducedMotion } from '@/lib/motion'
import { organizationPlanFailure } from '@/lib/organizationValidation'

/**
 * 空间整理模式会话状态（不持久化）：
 * - 方案生成 → 目标布局预览（compare: before/after 一键切换，镜头不变）
 * - 整理动画：按模型操作指令逐条插值移动（overrides 仅存在于会话内，不写项目存储）
 * - 接受方案才写入项目（一次可撤销记录）；「恢复原布局」= 丢弃预览
 *
 * 说明：动画只用于方案展示，不代表真实搬运路径已经过碰撞验证。
 */

export type OrganizeStatus = 'config' | 'planning' | 'preview' | 'playing' | 'paused' | 'finished'

export interface PoseOverride {
  position: Vec3
  rotationY: number
}

interface OrganizeState {
  open: boolean
  panelVisible: boolean
  sessionToken: number
  sourceSignature: string | null
  applying: boolean
  status: OrganizeStatus
  plan: OrganizationPlan | null
  commands: ReturnType<typeof compileOrganizationCommands>
  error: string | null
  /** 对比：before = 显示整理前（项目实际数据）；after = 显示整理后（预览 / 动画位置） */
  compare: 'before' | 'after'
  /** 分区参考线叠加显示 */
  showZones: boolean
  batchIndex: number
  batchProgress: number
  /** 预览覆盖位姿（会话级；未包含的物品按项目数据渲染） */
  overrides: Record<string, PoseOverride>
  /** 生成方案时的原布局快照（动画起点） */
  originals: Record<string, PoseOverride>
  openPanel: () => void
  hidePanel: () => void
  closePanel: () => void
  setStatus: (status: OrganizeStatus) => void
  setError: (message: string | null) => void
  setApplying: (applying: boolean) => void
  setPlan: (plan: OrganizationPlan, objects: SceneObject[], sourceSignature?: string, room?: RoomConfig) => void
  setCompare: (compare: 'before' | 'after') => void
  setShowZones: (show: boolean) => void
  startPlayback: () => void
  pausePlayback: () => void
  resumePlayback: () => void
  skipToEnd: () => void
  tick: (dtMs: number) => void
  /** 预览 / 动画期间禁止拖拽物品（避免与预览位姿冲突） */
  isPreviewBlocking: () => boolean
}

const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function lerpPose(from: PoseOverride, to: PoseOverride, t: number): PoseOverride {
  return {
    position: [
      lerp(from.position[0], to.position[0], t),
      lerp(from.position[1], to.position[1], t),
      lerp(from.position[2], to.position[2], t),
    ],
    rotationY: from.rotationY + Math.atan2(Math.sin(to.rotationY - from.rotationY), Math.cos(to.rotationY - from.rotationY)) * t,
  }
}

export const useOrganizeStore = create<OrganizeState>()((set, get) => ({
  commands: [],
  panelVisible: false,
  sessionToken: 0,
  sourceSignature: null,
  applying: false,
  open: false,
  status: 'config',
  plan: null,
  error: null,
  compare: 'after',
  showZones: false,
  batchIndex: 0,
  batchProgress: 0,
  overrides: {},
  originals: {},

  openPanel() {
    const s = get()
    if (s.open) {
      set({ panelVisible: true })
      return
    }
    set({ open: true, panelVisible: true, sessionToken: s.sessionToken + 1, status: 'config', error: null, showZones: false })
  },

  hidePanel() {
    if (get().applying) return
    if (!get().plan && get().status !== 'planning') { get().closePanel(); return }
    set({ panelVisible: false })
  },

  closePanel() {
    set({
      commands: [],
      panelVisible: false,
      sourceSignature: null,
      applying: false,
      sessionToken: get().sessionToken + 1,
      open: false,
      status: 'config',
      plan: null,
      error: null,
      compare: 'after',
      showZones: false,
      batchIndex: 0,
      batchProgress: 0,
      overrides: {},
      originals: {},
    })
  },

  setStatus: (status) => set({ status }),
  setError: (error) => set({ error }),
  setApplying: (applying) => set({ applying }),

  setPlan(plan, objects, sourceSignature, room) {
    const failure = organizationPlanFailure(plan)
    const commands = compileOrganizationCommands(plan, objects, room)
    const originals: Record<string, PoseOverride> = {}
    for (const o of objects) {
      originals[o.id] = {
        position: [...o.transform.position],
        rotationY: o.transform.rotationY,
      }
    }
    const overrides: Record<string, PoseOverride> = {}
    if (!failure) for (const a of plan.assignments) overrides[a.objectId] = { position: a.position, rotationY: a.rotationY }
    set({
      plan,
      sourceSignature: sourceSignature ?? null,
      commands,
      originals,
      overrides,
      status: 'preview',
      error: failure,
      compare: 'after',
      batchIndex: 0,
      batchProgress: 0,
    })
  },

  setCompare: (compare) => {
    if (get().applying) return
    set({ compare, ...(compare === 'before' && get().status === 'playing' ? { status: 'paused' as const } : {}) })
  },
  setShowZones: (showZones) => set({ showZones }),

  startPlayback() {
    const { plan } = get()
    if (get().applying || !plan || organizationPlanFailure(plan)) return
    // 尊重系统「减少动态效果」偏好：不播放分批动画，直接显示目标布局
    if (prefersReducedMotion()) {
      get().skipToEnd()
      return
    }
    set({
      status: get().commands.length > 0 ? 'playing' : 'finished',
      overrides: { ...get().originals },
      batchIndex: 0,
      batchProgress: 0,
      compare: 'after',
    })
  },

  pausePlayback() {
    if (get().status === 'playing') set({ status: 'paused' })
  },

  resumePlayback() {
    if (!get().applying && get().status === 'paused') set({ status: 'playing', compare: 'after' })
  },

  skipToEnd() {
    const { plan } = get()
    if (get().applying || !plan || organizationPlanFailure(plan)) return
    const overrides: Record<string, PoseOverride> = {}
    for (const a of plan.assignments) {
      overrides[a.objectId] = { position: a.position, rotationY: a.rotationY }
    }
    set({
      status: 'finished',
      overrides,
      batchIndex: Math.max(0, get().commands.length - 1),
      batchProgress: 1,
      compare: 'after',
    })
  },

  tick(dtMs) {
    const s = get()
    const plan = s.plan
    if (s.status !== 'playing' || !plan) return
    const batches = s.commands
    if (batches.length === 0) {
      set({ status: 'finished' })
      return
    }
    const targetById = new Map(s.commands.map((a) => [a.objectId, a]))
    const overrides: Record<string, PoseOverride> = { ...s.overrides }
    let idx = Math.min(s.batchIndex, batches.length - 1)
    if (!Number.isFinite(dtMs) || dtMs < 0) return
    let remaining = s.batchProgress * batches[idx].durationMs + dtMs
    let progress = remaining / batches[idx].durationMs

    // 完成整批：位置精确落到目标，推进到下一批
    while (progress >= 1) {
      for (const id of batches[idx].objectIds) {
        const a = targetById.get(id)
        if (a) overrides[id] = { position: a.position, rotationY: a.rotationY }
      }
      remaining -= batches[idx].durationMs
      idx += 1
      if (idx >= batches.length) {
        for (const a of plan.assignments) overrides[a.objectId] = { position: a.position, rotationY: a.rotationY }
        set({
          overrides,
          batchIndex: batches.length - 1,
          batchProgress: 1,
          status: 'finished',
        })
        return
      }
      progress = remaining / batches[idx].durationMs
    }

    // 当前批：从原布局插值到目标位姿
    const eased = easeInOutCubic(Math.max(0, Math.min(1, progress)))
    for (const id of batches[idx].objectIds) {
      const from = s.originals[id]
      const a = targetById.get(id)
      if (!from || !a) continue
      overrides[id] = lerpPose(from, { position: a.position, rotationY: a.rotationY }, eased)
    }
    set({ overrides, batchIndex: idx, batchProgress: progress })
  },

  isPreviewBlocking() {
    const s = get()
    return (
      s.applying || s.status === 'planning' || s.plan !== null
    )
  },
}))
