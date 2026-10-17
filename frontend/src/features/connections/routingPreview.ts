import { create } from 'zustand'
import type { CableConnection, Project } from '@/types/project'
import type { CablePlanningResult } from '@/api/types'
import { cablePlanningInputSignature, toRoutingScene } from '@/api/core/routingWire'
import { canonicalScene, sceneRef } from '@/api/core/packingWire'
import { requestJson } from '@/api/core/client'
import { useProjectsStore } from '@/state/projectsStore'
import { usePlansStore } from '@/state/plansStore'
import { useWorkspaceStore } from '@/state/workspaceStore'
import { useOrganizeStore } from '@/state/organizeStore'

/**
 * 走线规划候选预览（会话级，不持久化）。
 *
 * 边界职责（可整体替换，不改变其他模块）：
 * - stage：接收后端走线结果，本地校验后深拷贝保存为候选（不写项目）；
 * - acceptRoutingPreview：接受候选时先向后端核对正式场景版本（GET scene），
 *   再在写入前重新读取当前项目 / 基线 / 候选身份，确保没有迟到覆盖或取消；
 * - 仅调用 workspaceStore.replaceCables 写入本地项目（一次可撤销），
 *   服务端保存由接口能力决定，本模块不伪造后端保存。
 */

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** 走线结果里单条线缆的本地校验状态（不改变原始结果，仅用于界面） */
export interface RoutingPreviewValidation {
  /** 有效（算法验证通过、路径合规）线缆 id */
  validIds: string[]
  /** 失败线缆 id */
  failedIds: string[]
  /** 有效 / 失败数量 */
  validCount: number
  failedCount: number
  /** 校验失败原因（整体不合格时） */
  reason?: string
}

export interface RoutingCandidate {
  projectId: string
  signature: string
  baselineId: string
  result: CablePlanningResult
  /** 校验摘要，便于界面显示有效 / 失败数量 */
  validation: RoutingPreviewValidation
}

interface RoutingPreviewState {
  candidate: RoutingCandidate | null
  stage: (project: Project, result: CablePlanningResult, baselineId: string) => void
  discard: () => void
}

/** 本地校验走线结果：算法已验证、场景引用完整、全部当前线缆不重不漏 */
function validateResult(
  project: Project,
  result: CablePlanningResult,
): { ok: true; validation: RoutingPreviewValidation } | { ok: false; reason: string } {
  if (!result || result.algorithmVerified !== true) {
    return { ok: false, reason: '走线结果未经真实算法验证，不能作为候选预览。' }
  }
  if (!result.sceneRef || typeof result.sceneRef.sceneId !== 'string' || !result.sceneRef.sceneId) {
    return { ok: false, reason: '走线结果缺少正式场景标识，请重新规划。' }
  }
  if (!Array.isArray(result.cables)) {
    return { ok: false, reason: '走线结果缺少线缆列表。' }
  }
  const currentIds = project.cables.map((c) => c.id)
  const currentSet = new Set(currentIds)
  if (currentSet.size !== currentIds.length) return {ok:false,reason:'当前场景线缆 ID 重复。'}
  if (!Number.isInteger(result.sceneRef.sceneRevision) || result.sceneRef.sceneRevision < 1 || !result.sceneRef.baselineId) return {ok:false,reason:'走线结果缺少有效版本或基线。'}
  const seen = new Set<string>()
  let duplicate: string | null = null
  let unknown: string | null = null
  for (const cable of result.cables) {
    if (seen.has(cable.id)) {
      duplicate = cable.id
      break
    }
    if (!currentSet.has(cable.id)) {
      unknown = cable.id
      break
    }
    seen.add(cable.id)
  }
  if (duplicate) {
    return { ok: false, reason: `走线结果包含重复线缆（${duplicate}），不能作为候选。` }
  }
  if (unknown) {
    return { ok: false, reason: `走线结果包含当前场景不存在的线缆（${unknown}），不能作为候选。` }
  }
  const missing = currentIds.filter((id) => !seen.has(id))
  if (missing.length) {
    return { ok: false, reason: `走线结果未覆盖全部线缆（缺少 ${missing[0]}），不能作为候选。` }
  }
  const validIds: string[] = []
  const failedIds: string[] = []
  for (const cable of result.cables) {
    if (isValidRoute(cable)) validIds.push(cable.id)
    else failedIds.push(cable.id)
  }
  return {
    ok: true,
    validation: { validIds, failedIds, validCount: validIds.length, failedCount: failedIds.length },
  }
}

/** 单条线缆是否为「算法验证通过的有效路径」 */
export function isValidRoute(cable: CableConnection): boolean {
  if (!cable || cable.status !== 'planned') return false
  if (cable.planSource !== 'algorithm') return false
  if (!cable.route || !Array.isArray(cable.route.points) || cable.route.points.length < 2) return false
  const verification = cable.route.verification
  if (!verification || verification.status !== 'valid' || verification.pathStyle !== 'orthogonal') return false
  if (['power', 'video', 'network'].includes(cable.kind) && cable.route.strategy !== 'backboard') return false
  if (typeof cable.route.pathLengthM !== 'number' || !Number.isFinite(cable.route.pathLengthM) || cable.route.pathLengthM <= 0) return false
  return true
}

export const useRoutingPreviewStore = create<RoutingPreviewState>()((set) => ({
  candidate: null,

  stage(project, result, baselineId) {
    const check = validateResult(project, result)
    if (!check.ok) {
      set({ candidate: null })
      throw new Error(check.reason)
    }
    set({
      candidate: {
        projectId: project.id,
        signature: cablePlanningInputSignature(project),
        baselineId,
        result: clone(result),
        validation: check.validation,
      },
    })
  },

  discard() {
    set({ candidate: null })
  },
}))

/** 候选是否仍匹配当前项目（项目 id、输入签名、基线一致） */
export function isCandidateCurrent(candidate: RoutingCandidate, project: Project): boolean {
  if (candidate.projectId !== project.id) return false
  if (candidate.signature !== cablePlanningInputSignature(project)) return false
  const baseline = usePlansStore.getState().baselines[project.id]
  if (!baseline || baseline.id !== candidate.baselineId) return false
  return true
}

/** 计算候选的实时新鲜度（不修改全局态） */
export function candidateFreshness(candidate: RoutingCandidate, project: Project): 'current' | 'stale' {
  return isCandidateCurrent(candidate, project) ? 'current' : 'stale'
}

/**
 * 接受走线候选：
 * 1. 校验候选存在且与当前项目 / 输入签名 / 基线一致；
 * 2. 要求至少一条有效路径，且未处于整理预览 / 应用状态；
 * 3. 通过现有后端接口读取正式场景并核对版本（不新增端点）；
 * 4. 写入前重新读取项目 / 基线 / 候选身份与签名，避免迟到覆盖或取消；
 * 5. 只把算法验证通过的有效路径写入本地项目（一次可撤销），
 *    失败线路保持原状，避免把失败结果伪装成已规划连接；随后丢弃候选。
 * 接受后只保存在本机；服务端保存由接口能力决定。
 *
 * 返回值供界面如实说明写入范围：applied 条已应用，skipped 条失败未应用。
 */
export async function acceptRoutingPreview(
  project: Project,
  baselineId: string,
): Promise<{ applied: number; skipped: number }> {
  const state = useRoutingPreviewStore.getState()
  const candidate = state.candidate
  if (!candidate) throw new Error('没有可接受的理线预览。')
  if (candidate.projectId !== project.id) throw new Error('理线预览属于其他项目，不能接受。')
  if (candidate.baselineId !== baselineId) throw new Error('理线预览基于其他整理前基线，请重新规划。')
  if (candidate.signature !== cablePlanningInputSignature(project)) {
    throw new Error('项目内容已变化，理线预览已过期，请重新规划。')
  }

  const organize = useOrganizeStore.getState()
  if (organize.isPreviewBlocking()) {
    throw new Error('整理预览或应用进行中，请先结束整理后再接受理线方案。')
  }

  if (candidate.validation.validCount < 1) {
    throw new Error('理线预览没有可用的成功路径，不能接受。')
  }
  if (!candidate.result.sceneRef) throw new Error('理线预览缺少正式场景标识，请重新规划。')
  const ref = candidate.result.sceneRef

  // 写入前用现有后端接口核对正式场景版本；不新增端点。
  const raw = await requestJson<unknown>(`/projects/${encodeURIComponent(project.id)}/scene`)
  const expected = toRoutingScene({ project, confirmed: true, ref })
  const scene = canonicalScene(raw, expected, ref)

  // await 之后重新读取状态：防止迟到覆盖 / 取消。
  const latestProject = useProjectsStore.getState().projects[project.id]
  if (!latestProject) throw new Error('项目已不存在，理线预览已失效。')
  const latestBaseline = usePlansStore.getState().baselines[project.id]
  if (!latestBaseline || latestBaseline.id !== candidate.baselineId) {
    throw new Error('整理前基线已变化，理线预览已过期，请重新规划。')
  }
  const latestCandidate = useRoutingPreviewStore.getState().candidate
  if (!latestCandidate) throw new Error('理线预览已被取消。')
  if (
    latestCandidate !== candidate ||
    latestCandidate.projectId !== candidate.projectId ||
    latestCandidate.baselineId !== candidate.baselineId ||
    latestCandidate.signature !== candidate.signature
  ) {
    throw new Error('理线预览已被替换，请重新确认后再接受。')
  }
  if (latestCandidate.signature !== cablePlanningInputSignature(latestProject)) {
    throw new Error('项目内容已变化，理线预览已过期，请重新规划。')
  }
  if (sceneRef(scene).sceneId !== ref.sceneId || sceneRef(scene).sceneRevision !== ref.sceneRevision || sceneRef(scene).baselineId !== ref.baselineId) {
    throw new Error('后端正式场景版本已变化，理线预览已过期，请重新规划。')
  }

  if (useOrganizeStore.getState().isPreviewBlocking()) {
    throw new Error('整理方案正在应用，请稍后再接受理线方案。')
  }

  // 只应用算法验证通过的有效路径：失败线路保持原状，不把失败结果写进项目。
  const appliedCables = latestCandidate.result.cables.filter(isValidRoute)
  if (appliedCables.length === 0) throw new Error('理线预览没有可用的成功路径，不能接受。')
  const appliedById = new Map(appliedCables.map((cable) => [cable.id, cable]))
  // 深拷贝，避免把 store 中的候选直接交给 workspace；未通过的线缆沿用当前项目内容。
  const merged = latestProject.cables.map((cable) => clone(appliedById.get(cable.id) ?? cable))
  useWorkspaceStore.getState().replaceCables(project.id, merged, true)
  useProjectsStore.getState().update(project.id, (current) => ({
    ...current,
    cableTrayAnalysis: latestCandidate.result.trayAnalysis ? clone(latestCandidate.result.trayAnalysis) : undefined,
  }))
  state.discard()
  return { applied: appliedCables.length, skipped: latestCandidate.result.cables.length - appliedCables.length }
}
