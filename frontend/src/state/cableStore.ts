import { create } from 'zustand'
import type { Vec3 } from '@/types/project'
import { prefersReducedMotion } from '@/lib/motion'

/**
 * 走线模式会话状态（不持久化）：
 * - 线缆 / 路径节点选择、接口连线模式（点击两个接口建立连接）；
 * - 显示开关（接口 / 路径节点 / 避让区）与「原始走线 ↔ 建议走线」对比；
 * - 路径节点拖拽预览（松开才写入项目，一次可撤销）；
 * - 线缆收拢动画（显示效果，不代表真实收拢过程经过验证）。
 */

export type CableAnimStatus = 'idle' | 'playing' | 'paused' | 'finished'

export interface PortRef {
  objectId: string
  portId: string
}

export interface NodeDragState {
  cableId: string
  index: number
  /** 预览位置（已 10mm 吸附，可能贴合到附近路由节点） */
  position: Vec3
  /** 吸附到的路由节点 id（未吸附 = null） */
  snappedNodeId: string | null
}

const ANIM_DURATION_MS = 1800

interface CableState {
  selectedCableId: string | null
  selectedNodeIndex: number | null
  hoveredCableId: string | null
  /** 连线模式：已选择的起点接口 */
  linkFrom: PortRef | null
  /** 原始 / 建议走线对比 */
  routeView: 'suggested' | 'original'
  showPorts: boolean
  showRouteNodes: boolean
  showAvoidZones: boolean
  /** 路径节点拖拽预览（会话级） */
  nodeDrag: NodeDragState | null
  /** 收拢动画 */
  animStatus: CableAnimStatus
  animT: number
  /** 动画起点（每条线缆的重采样折线，会话级） */
  animFrom: Record<string, Vec3[]>
  /** 操作提示（由页面转换为 flash 消息） */
  notice: string | null

  selectCable: (id: string | null) => void
  selectNode: (index: number | null) => void
  setHoveredCable: (id: string | null) => void
  setLinkFrom: (ref: PortRef | null) => void
  setRouteView: (view: 'suggested' | 'original') => void
  setShowPorts: (v: boolean) => void
  setShowRouteNodes: (v: boolean) => void
  setShowAvoidZones: (v: boolean) => void
  setNodeDrag: (drag: NodeDragState | null) => void
  setNotice: (msg: string | null) => void
  onCableRemoved: (cableId: string) => void
  startAnim: (from: Record<string, Vec3[]>) => void
  pauseAnim: () => void
  resumeAnim: () => void
  skipAnim: () => void
  resetAnim: () => void
  /** 清空整个走线会话（演示重置 / 离开项目时使用） */
  resetSession: () => void
  tick: (dtMs: number) => void
}

export const useCableStore = create<CableState>()((set, get) => ({
  selectedCableId: null,
  selectedNodeIndex: null,
  hoveredCableId: null,
  linkFrom: null,
  routeView: 'suggested',
  showPorts: true,
  showRouteNodes: true,
  showAvoidZones: true,
  nodeDrag: null,
  animStatus: 'idle',
  animT: 0,
  animFrom: {},
  notice: null,

  selectCable: (id) => set({ selectedCableId: id, selectedNodeIndex: null }),
  selectNode: (index) => set({ selectedNodeIndex: index }),
  setHoveredCable: (id) => set({ hoveredCableId: id }),
  setLinkFrom: (ref) => set({ linkFrom: ref }),
  setRouteView: (routeView) => set({ routeView }),
  setShowPorts: (showPorts) => set({ showPorts }),
  setShowRouteNodes: (showRouteNodes) => set({ showRouteNodes }),
  setShowAvoidZones: (showAvoidZones) => set({ showAvoidZones }),
  setNodeDrag: (nodeDrag) => set({ nodeDrag }),
  setNotice: (notice) => set({ notice }),

  onCableRemoved(cableId) {
    const s = get()
    if (s.selectedCableId === cableId) set({ selectedCableId: null, selectedNodeIndex: null })
    if (s.nodeDrag?.cableId === cableId) set({ nodeDrag: null })
  },

  startAnim(from) {
    // 尊重系统「减少动态效果」偏好：直接显示收拢后的走线
    if (prefersReducedMotion()) {
      set({ animStatus: 'finished', animT: 1, animFrom: from })
      return
    }
    set({ animStatus: 'playing', animT: 0, animFrom: from })
  },
  pauseAnim() {
    if (get().animStatus === 'playing') set({ animStatus: 'paused' })
  },
  resumeAnim() {
    if (get().animStatus === 'paused') set({ animStatus: 'playing' })
  },
  skipAnim() {
    if (get().animStatus === 'idle') return
    set({ animStatus: 'finished', animT: 1 })
  },
  resetAnim() {
    set({ animStatus: 'idle', animT: 0, animFrom: {} })
  },

  /** 清空整个走线会话（演示重置 / 离开项目时使用） */
  resetSession() {
    set({
      selectedCableId: null,
      selectedNodeIndex: null,
      hoveredCableId: null,
      linkFrom: null,
      routeView: 'suggested',
      nodeDrag: null,
      animStatus: 'idle',
      animT: 0,
      animFrom: {},
      notice: null,
    })
  },

  tick(dtMs) {
    const s = get()
    if (s.animStatus !== 'playing') return
    const next = s.animT + dtMs / ANIM_DURATION_MS
    if (next >= 1) {
      set({ animT: 1, animStatus: 'finished' })
      return
    }
    set({ animT: next })
  },
}))

/** 收拢动画进度（缓入缓出，供渲染层使用） */
export function cableAnimEase(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}
