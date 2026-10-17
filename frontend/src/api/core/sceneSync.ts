import { requestJson } from './client'
import { ApiError, isApiError } from './errors'
import { forgetOrganizationScene, type StoredOrganizationScene } from './organizationScenes'
import { canonicalScene, sceneRef, type PackingScene } from './packingWire'

function synchronizedScene(raw: unknown, expected: PackingScene, known: StoredOrganizationScene | null, baselineSourceId: string): PackingScene {
  const canonical = canonicalScene(raw, expected)
  const ref = sceneRef(canonical)
  const sameBaseline = known?.baselineSourceId === baselineSourceId
  const valid = known
    ? ref.sceneId === known.sceneId && (sameBaseline
      ? [known.sceneRevision, known.sceneRevision + 1].includes(ref.sceneRevision) && ref.baselineId === known.baselineId
      : ref.sceneRevision === known.sceneRevision + 1 && ref.baselineId !== known.baselineId)
    : ref.sceneRevision === 1
  if (!valid) throw new ApiError('后端同步返回了不匹配的场景标识或版本', { kind: 'malformed' })
  return canonical
}

function conflict(error: unknown): unknown {
  return isApiError(error) && error.status === 409
    ? new ApiError('本地场景与后端保存的版本不一致，可在整理面板创建独立副本继续；原项目和后端场景会保留', {
      kind: 'conflict', status: 409, path: error.path, detail: error.detail,
    }) : error
}

export async function synchronizeScene(input: {
  projectId: string; scene: PackingScene; baseline: PackingScene; baselineSourceId: string
  known: StoredOrganizationScene | null; signal?: AbortSignal
}): Promise<PackingScene> {
  const { projectId, scene, baseline, baselineSourceId, known, signal } = input
  const path = `/projects/${encodeURIComponent(projectId)}/scene`
  const save = (ref: StoredOrganizationScene | null) => requestJson<PackingScene>(path, {
    method: 'PUT', signal,
    body: { scene, expected_revision: ref?.sceneRevision ?? null, baseline_source_id: baselineSourceId,
      ...(!ref || ref.baselineSourceId !== baselineSourceId ? { baseline } : {}) },
  })
  if (signal?.aborted) throw new ApiError('请求已取消', { kind: 'aborted' })
  try {
    return synchronizedScene(await save(known), scene, known, baselineSourceId)
  } catch (error) {
    if (signal?.aborted || !isApiError(error) || !(error.kind === 'network' || error.kind === 'timeout' || error.status === 409)) throw error
    let saved: { scene: unknown; baseline_source_id: unknown }
    try {
      saved = await requestJson<typeof saved>(`${path}-state`, { signal })
    } catch (readError) {
      if (signal?.aborted) throw new ApiError('请求已取消', { kind: 'aborted' })
      if (!signal?.aborted && error.status === 409 && known && isApiError(readError) && readError.status === 404) {
        // A different or rebuilt backend has no scene to overwrite. Recreate once with a full baseline.
        if (!forgetOrganizationScene(projectId, known)) throw conflict(error)
        try { return synchronizedScene(await save(null), scene, null, baselineSourceId) }
        catch (retryError) { throw conflict(retryError) }
      }
      throw conflict(error)
    }
    if (signal?.aborted) throw new ApiError('请求已取消', { kind: 'aborted' })
    if (saved.baseline_source_id !== baselineSourceId) throw conflict(error)
    try {
      if (error.status !== 409) return synchronizedScene(saved.scene, scene, known, baselineSourceId)
      // An exact existing scene can be rebound without writing, even after its revision advanced.
      const canonical = canonicalScene(saved.scene, scene)
      const ref = sceneRef(canonical)
      if (known && (ref.sceneId !== known.sceneId || ref.sceneRevision < known.sceneRevision || (known.baselineSourceId === baselineSourceId
        ? ref.baselineId !== known.baselineId : ref.sceneRevision !== known.sceneRevision + 1 || ref.baselineId === known.baselineId))) throw error
      return canonical
    } catch { throw conflict(error) }
  }
}
