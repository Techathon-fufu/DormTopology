import { useRemoteJobsStore, type RemoteJobRecord } from '@/state/remoteJobsStore'
import type { ServiceProgress } from '../types'
import { requestJson, requestMultipart } from './client'
import { ApiError, isApiError } from './errors'
import {
  REMOTE_CAPABILITY_LABELS,
  REMOTE_CAPABILITY_PATHS,
  summarizeWireResult,
  wireJobErrorText,
  type RemoteCapability,
  type WireJobAccepted,
  type WireJobEnvelope,
  type WireJobStatus,
} from './wire'

/**
 * 长任务执行器：提交 → jobId 轮询（queued / running / succeeded / failed / cancelled）。
 *
 * - 每个任务在 remoteJobsStore 留痕：请求参数摘要、状态、算法版本、创建时间，刷新后可恢复查询；
 * - 轮询容忍短暂网络抖动（连续失败达到上限才判失败），但不静默降级为成功；
 * - 支持取消（POST /jobs/{id}/cancel）与组件侧中止（AbortSignal，中止后由 watcher 继续查询）。
 */

const POLL_INITIAL_MS = 800
const POLL_MAX_MS = 4000
const POLL_BACKOFF = 1.3
const MAX_CONSECUTIVE_POLL_ERRORS = 3

/** 本页面正在长轮询的任务号（watcher 跳过，避免重复查询） */
const locallyPolled = new Set<string>()

export function isLocallyPolled(jobId: string): boolean {
  return locallyPolled.has(jobId)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function patchRecord(id: string, patch: Partial<RemoteJobRecord>): void {
  useRemoteJobsStore.getState().patch(id, patch)
}

function statusFields(env: WireJobEnvelope, capability: RemoteCapability): Partial<RemoteJobRecord> {
  const fields: Partial<RemoteJobRecord> = {}
  const known: WireJobStatus[] = ['queued', 'running', 'succeeded', 'failed', 'cancelled']
  if (known.includes(env.status)) fields.status = env.status
  if (typeof env.progress === 'number' && Number.isFinite(env.progress)) {
    fields.progress = Math.min(1, Math.max(0, env.progress))
  }
  if (typeof env.stage === 'string' && env.stage) fields.stage = env.stage
  if (typeof env.algorithm_version === 'string' && env.algorithm_version) {
    fields.algorithmVersion = env.algorithm_version
  }
  if (env.status === 'succeeded') {
    fields.resultSummary = summarizeWireResult(capability, env.result)
    fields.lastQueryError = undefined
  }
  if (env.status === 'failed') fields.error = wireJobErrorText(env.error) ?? '后端任务失败（未提供原因）'
  return fields
}

export interface RunRemoteJobOptions<TResult> {
  capability: RemoteCapability
  projectId: string
  /** 界面展示名（如「走线规划（真实后端）」） */
  label: string
  /** 接口路径（相对 /api/v1）；缺省按能力取 */
  path?: string
  /** JSON 请求体（与 form 二选一） */
  body?: unknown
  form?: FormData
  /** 请求参数摘要（留痕展示用，不得包含密钥——前端也不持有任何密钥） */
  requestSummary?: Record<string, unknown>
  onProgress?: ServiceProgress
  signal?: AbortSignal
  /** wire 结果 → 内部模型（含本地校验，见 core/wire.ts） */
  mapResult: (wire: unknown) => TResult
}

interface PollOptions {
  signal?: AbortSignal
  onEnvelope: (env: WireJobEnvelope) => void
}

async function pollUntilTerminal(jobId: string, opts: PollOptions): Promise<WireJobEnvelope> {
  let delay = POLL_INITIAL_MS
  let consecutiveErrors = 0
  for (;;) {
    if (opts.signal?.aborted) throw new ApiError('请求已取消', { kind: 'aborted', jobId })
    await sleep(delay)
    let env: WireJobEnvelope
    try {
      env = await requestJson<WireJobEnvelope>(`/jobs/${encodeURIComponent(jobId)}`, {
        signal: opts.signal,
      })
    } catch (err) {
      if (isApiError(err) && err.kind === 'aborted') throw err
      if (isApiError(err) && err.kind === 'not-found') {
        throw new ApiError('任务不存在（可能已过期，或后端已重启），无法继续查询状态', {
          kind: 'not-found',
          jobId,
        })
      }
      consecutiveErrors += 1
      if (consecutiveErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
        const reason = err instanceof Error ? err.message : String(err)
        throw new ApiError(`连续 ${consecutiveErrors} 次查询任务状态失败：${reason}`, {
          kind: isApiError(err) ? err.kind : 'network',
          jobId,
        })
      }
      delay = Math.min(POLL_MAX_MS, Math.round(delay * POLL_BACKOFF))
      continue
    }
    consecutiveErrors = 0
    if (!env || typeof env.job_id !== 'string') {
      throw new ApiError('任务状态响应格式错误（缺少 job_id）', { kind: 'malformed', jobId })
    }
    opts.onEnvelope(env)
    if (env.status === 'succeeded' || env.status === 'failed' || env.status === 'cancelled') return env
    if (env.status !== 'queued' && env.status !== 'running') {
      throw new ApiError(`任务状态「${String(env.status)}」无法识别`, { kind: 'malformed', jobId })
    }
    delay = Math.min(POLL_MAX_MS, Math.round(delay * POLL_BACKOFF))
  }
}

/** 提交长任务并轮询至终态；失败 / 取消抛出分类明确的 ApiError */
export async function runRemoteJob<TResult>(opts: RunRemoteJobOptions<TResult>): Promise<TResult> {
  const path = opts.path ?? REMOTE_CAPABILITY_PATHS[opts.capability]
  const accepted = opts.form
    ? await requestMultipart<WireJobAccepted>(path, opts.form, { signal: opts.signal })
    : await requestJson<WireJobAccepted>(path, { method: 'POST', body: opts.body, signal: opts.signal })
  const jobId = accepted?.job_id
  if (typeof jobId !== 'string' || !jobId) {
    throw new ApiError('后端未返回任务号（job_id），无法跟踪任务状态', { kind: 'malformed', path })
  }

  useRemoteJobsStore.getState().upsert({
    id: jobId,
    projectId: opts.projectId,
    capability: opts.capability,
    label: opts.label,
    status: accepted.status ?? 'queued',
    stage: '已提交，等待后端处理',
    requestSummary: opts.requestSummary,
    createdAt: accepted.created_at ?? new Date().toISOString(),
    submittedAt: Date.now(),
    updatedAt: Date.now(),
  })

  locallyPolled.add(jobId)
  try {
    const final = await pollUntilTerminal(jobId, {
      signal: opts.signal,
      onEnvelope: (env) => {
        const fields = statusFields(env, opts.capability)
        patchRecord(jobId, fields)
        if (fields.progress !== undefined || env.stage) {
          opts.onProgress?.(fields.progress ?? 0, env.stage)
        }
      },
    })

    if (final.status === 'succeeded') {
      let mapped: TResult
      try {
        mapped = opts.mapResult(final.result)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        patchRecord(jobId, { status: 'failed', error: `结果本地校验失败：${msg}` })
        throw new ApiError(`结果本地校验失败：${msg}`, { kind: 'malformed', jobId })
      }
      patchRecord(jobId, {
        status: 'succeeded',
        stage: undefined,
        resultSummary: summarizeWireResult(opts.capability, final.result),
      })
      return mapped
    }

    if (final.status === 'failed') {
      const msg = wireJobErrorText(final.error) ?? '后端任务失败（未提供原因）'
      patchRecord(jobId, { status: 'failed', error: msg, stage: undefined })
      throw new ApiError(`${opts.label}失败：${msg}`, { kind: 'job', jobId })
    }

    // cancelled
    patchRecord(jobId, { status: 'cancelled', stage: undefined })
    throw new ApiError(`${opts.label}已取消`, { kind: 'cancelled', jobId })
  } catch (err) {
    if (isApiError(err)) {
      if (err.kind === 'aborted') {
        // 调用方中止（组件卸载 / 页面关闭）：任务留存，watcher 或下次打开时继续查询
        patchRecord(jobId, { stage: '等待继续查询（调用方已中止轮询）' })
        throw err
      }
      if (err.kind === 'not-found' || err.kind === 'timeout' || err.kind === 'network' || err.kind === 'http' || err.kind === 'malformed') {
        patchRecord(jobId, { status: 'failed', error: err.message, stage: undefined })
      }
    }
    throw err
  } finally {
    locallyPolled.delete(jobId)
  }
}

/**
 * 单次刷新一条任务记录（供 watcher 与界面「重查」使用）。
 * 不抛错：失败写入 lastQueryError / error，返回更新后的记录（找不到返回 null）。
 */
export async function refreshRemoteJob(jobId: string, signal?: AbortSignal): Promise<RemoteJobRecord | null> {
  const record = useRemoteJobsStore.getState().records.find((r) => r.id === jobId)
  try {
    const env = await requestJson<WireJobEnvelope>(`/jobs/${encodeURIComponent(jobId)}`, { signal })
    if (!env || typeof env.job_id !== 'string') {
      patchRecord(jobId, { lastQueryError: '状态响应格式错误（缺少 job_id）' })
      return useRemoteJobsStore.getState().records.find((r) => r.id === jobId) ?? null
    }
    const fields = statusFields(env, record?.capability ?? 'cable')
    patchRecord(jobId, { ...fields, lastQueryError: undefined })
    return useRemoteJobsStore.getState().records.find((r) => r.id === jobId) ?? null
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (isApiError(err) && err.kind === 'not-found') {
      patchRecord(jobId, { status: 'failed', error: msg, stage: undefined })
    } else if (!(isApiError(err) && err.kind === 'aborted')) {
      patchRecord(jobId, { lastQueryError: msg })
    }
    return useRemoteJobsStore.getState().records.find((r) => r.id === jobId) ?? null
  }
}

/** 后台恢复查询：对未在本地轮询中的非终态记录各查询一次（刷新后的「继续查询状态」） */
export async function refreshActiveRemoteJobs(signal?: AbortSignal): Promise<void> {
  const records = useRemoteJobsStore
    .getState()
    .records.filter((r) => (r.status === 'queued' || r.status === 'running') && !locallyPolled.has(r.id))
  for (const r of records) {
    if (signal?.aborted) return
    await refreshRemoteJob(r.id, signal)
  }
}

/** 取消任务：POST /jobs/{id}/cancel；失败不吞错 */
export async function cancelRemoteJob(jobId: string): Promise<void> {
  try {
    const env = await requestJson<WireJobEnvelope>(`/jobs/${encodeURIComponent(jobId)}/cancel`, {
      method: 'POST',
    })
    const record = useRemoteJobsStore.getState().records.find((r) => r.id === jobId)
    if (env && typeof env.status === 'string') {
      patchRecord(jobId, {
        ...statusFields(env, record?.capability ?? 'cable'),
        lastQueryError: undefined,
      })
    } else {
      patchRecord(jobId, { status: 'cancelled', stage: undefined, lastQueryError: undefined })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    patchRecord(jobId, { lastQueryError: `取消失败：${msg}` })
    throw err
  }
}

export function remoteJobCapabilityLabel(capability: RemoteCapability): string {
  return REMOTE_CAPABILITY_LABELS[capability]
}
