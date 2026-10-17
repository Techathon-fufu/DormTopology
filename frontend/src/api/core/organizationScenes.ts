import type { OrganizationSceneRef } from '@/types/organization'
import { apiBaseUrl } from './config'
import { ApiError } from './errors'

export interface StoredOrganizationScene extends OrganizationSceneRef {
  baselineSourceId: string
}

const active = new Set<string>()
const cache = new Map<string, StoredOrganizationScene>()
const key = (projectId: string) => `dormtopology.organization-scene:${apiBaseUrl}:${projectId}`

export function knownOrganizationScene(projectId: string): StoredOrganizationScene | null {
  if (cache.has(projectId)) return cache.get(projectId)!
  try {
    const raw = localStorage.getItem(key(projectId))
    if (!raw) return null
    const value = JSON.parse(raw) as StoredOrganizationScene
    if (typeof value.sceneId !== 'string' || !value.sceneId || !Number.isInteger(value.sceneRevision) || value.sceneRevision < 1 || typeof value.baselineId !== 'string' || !value.baselineId || typeof value.baselineSourceId !== 'string' || !value.baselineSourceId) return null
    cache.set(projectId, value)
    return value
  } catch { return null }
}

export function rememberOrganizationScene(projectId: string, ref: StoredOrganizationScene): void {
  cache.set(projectId, ref)
  try { localStorage.setItem(key(projectId), JSON.stringify(ref)) } catch { /* A missing persisted ref is rejected by the server on the next session. */ }
}

export async function withOrganizationSceneLock<T>(projectId: string, work: () => Promise<T>): Promise<T> {
  if (active.has(projectId)) throw new ApiError('该场景已有整理操作正在进行，请等待完成', { kind: 'input' })
  active.add(projectId)
  try { return await work() } finally { active.delete(projectId) }
}
