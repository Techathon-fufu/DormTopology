import type { OrganizationSceneRef } from '@/types/organization'
import { apiBaseUrl } from './config'
import { ApiError } from './errors'

export interface StoredOrganizationScene extends OrganizationSceneRef {
  baselineSourceId: string
}

const active = new Set<string>()
const cache = new Map<string, StoredOrganizationScene>()
const pendingStorage = new Map<string, string | null>()
const key = (projectId: string) => `dormtopology.organization-scene:${apiBaseUrl}:${projectId}`

export function knownOrganizationScene(projectId: string): StoredOrganizationScene | null {
  let raw: string | null
  try { raw = localStorage.getItem(key(projectId)) }
  catch { return cache.get(projectId) ?? null }
  if (pendingStorage.has(projectId) && pendingStorage.get(projectId) === raw) return cache.get(projectId) ?? null
  pendingStorage.delete(projectId)
  try {
    if (!raw) { cache.delete(projectId); return null }
    const value = JSON.parse(raw) as StoredOrganizationScene
    if (!value || typeof value.sceneId !== 'string' || !value.sceneId || !Number.isInteger(value.sceneRevision) || value.sceneRevision < 1 || typeof value.baselineId !== 'string' || !value.baselineId || typeof value.baselineSourceId !== 'string' || !value.baselineSourceId) { cache.delete(projectId); return null }
    cache.set(projectId, value)
    return value
  } catch { cache.delete(projectId); return null }
}

export function rememberOrganizationScene(projectId: string, ref: StoredOrganizationScene): void {
  cache.set(projectId, ref)
  try {
    const previous = localStorage.getItem(key(projectId))
    try { localStorage.setItem(key(projectId), JSON.stringify(ref)); pendingStorage.delete(projectId) }
    catch { pendingStorage.set(projectId, previous) }
  } catch { /* Keep the reference for this session when storage is unavailable. */ }
}

export function forgetOrganizationScene(projectId: string, expected?: StoredOrganizationScene): boolean {
  if (expected) {
    const current = knownOrganizationScene(projectId)
    if (current && (['sceneId', 'sceneRevision', 'baselineId', 'baselineSourceId'] as const).some((field) => current[field] !== expected[field])) return false
  }
  cache.delete(projectId)
  pendingStorage.delete(projectId)
  try { localStorage.removeItem(key(projectId)) } catch { /* The server still rejects stale persisted references. */ }
  return true
}

export async function withOrganizationSceneLock<T>(projectId: string, work: () => Promise<T>): Promise<T> {
  if (active.has(projectId)) throw new ApiError('该场景已有整理操作正在进行，请等待完成', { kind: 'input' })
  active.add(projectId)
  try { return await work() } finally { active.delete(projectId) }
}
