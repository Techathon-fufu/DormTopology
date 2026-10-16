/**
 * 走线规划领域类型：场景路由节点（桌沿 / 桌底 / 立柱 / 出线孔 …）、
 * 避让区（打字 / 水杯 / 桌下腿部活动区）与路径检查结果。
 *
 * 重要说明（诚实标注）：
 * - 演示路径由本地「规则式」规划器生成，未经过真实算法验证；
 * - Catmull-Rom 平滑曲线仅用于渲染，避让结论以「对平滑采样点的障碍检查」为准；
 * - 路径检查是本地几何规则（采样点 vs 避让区 / 物品包围盒 / 桌板），不是真实寻路算法。
 */

import type { Vec3 } from './project'

// ───────────────────────────── 场景路由节点 ─────────────────────────────

export type RouteNodeKind = 'deskEdge' | 'deskUnder' | 'leg' | 'post' | 'hole' | 'outlet' | 'floor'

export const ROUTE_NODE_META: Record<RouteNodeKind, { label: string; color: string }> = {
  deskEdge: { label: '桌边', color: '#0F9D8A' },
  deskUnder: { label: '桌底', color: '#2563EB' },
  leg: { label: '桌腿立柱', color: '#7C3AED' },
  post: { label: '床架立柱', color: '#7C3AED' },
  hole: { label: '出线孔', color: '#D97706' },
  outlet: { label: '电源插座', color: '#E5484D' },
  floor: { label: '地面', color: '#64748B' },
}

/** 场景中可用于走线的路径节点（坐标由房间配置推导，单位：米） */
export interface RouteNode {
  id: string
  kind: RouteNodeKind
  label: string
  position: Vec3
}

// ───────────────────────────── 避让区 ─────────────────────────────

export type CableAvoidZoneKind = 'typing' | 'cup' | 'legroom'

export const CABLE_AVOID_ZONE_META: Record<CableAvoidZoneKind, { label: string; color: string }> = {
  typing: { label: '打字活动区', color: '#E5484D' },
  cup: { label: '水杯活动区', color: '#D97706' },
  legroom: { label: '桌下腿部活动区', color: '#2563EB' },
}

/** 走线避让区（立体区间：俯视矩形 × 高度区间，单位：米） */
export interface CableAvoidZone {
  id: string
  kind: CableAvoidZoneKind
  label: string
  rect: { x0: number; x1: number; z0: number; z1: number }
  y0: number
  y1: number
}

// ───────────────────────────── 路径检查 ─────────────────────────────

export type CableIssueKind = 'zone' | 'object' | 'slab' | 'bounds' | 'endpoint'

export interface CableCheckIssue {
  kind: CableIssueKind
  /** 问题所在位置（米，用于在三维中标记） */
  position: Vec3
  message: string
}

export interface CableCheckResult {
  /** 平滑采样点（渲染与长度估算同源） */
  samples: Vec3[]
  /** 平滑路径长度（米） */
  lengthM: number
  issues: CableCheckIssue[]
  ok: boolean
}

/** 复制折线控制点（避免各环节共享可变数组） */
export function clonePoints(points: Vec3[]): Vec3[] {
  return points.map((p) => [p[0], p[1], p[2]] as Vec3)
}
