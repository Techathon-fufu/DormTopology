import { parseBundle, type Scene, type PackingResult, type RoutingResult } from '@/algorithm-lab/contract'

export const API_BASE = '/api/v1/workflow'
export const SCENE_ID_KEY = 'dormtopology.workflow.scene-id'
export const REQUEST_TIMEOUT_MS = 120_000

export type CanonicalComparison = {
  schema_version: string
  scene_id: string
  scene_revision: number
  baseline_id: string
  area_grid_cell_m: number
  baseline_free_area_m2: number | null
  current_free_area_m2: number
  baseline_exposed_length_m: number | null
  current_exposed_length_m: number | null
  issues: { entity_id: string | null; code: string; message: string }[]
  unresolved_issue_count: number
  comparison_note: string | null
}

export type Guide = {
  markdown: string
  status: string
  scene_id: string
  scene_revision: number
  baseline_id: string | null
}

export type SceneDocument = {
  scene: Scene
  baseline: Scene | null
  packing_result: PackingResult | null
  routing_result: RoutingResult | null
  comparison: CanonicalComparison | null
  guide: Guide | null
  photo_url: string | null
}

export class ApiError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export class StaleError extends Error {
  constructor(message = 'stale response discarded') {
    super(message)
    this.name = 'StaleError'
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

async function toApiError(res: Response): Promise<ApiError> {
  let code = `http_${res.status}`
  let message = res.statusText || `HTTP ${res.status}`
  try {
    const body: unknown = await res.json()
    if (isRecord(body) && isRecord(body.detail)) {
      if (typeof body.detail.code === 'string') code = body.detail.code
      if (typeof body.detail.message === 'string') message = body.detail.message
    }
  } catch {
    /* non-json body */
  }
  return new ApiError(res.status, code, message)
}

function parseDoc(data: unknown): SceneDocument {
  const record = data as Record<string, unknown>
  if (!isRecord(record) || !isRecord(record.scene)) {
    throw new Error('invalid scene document: missing scene')
  }
  const sceneBundle = parseBundle(record.scene)
  const baseline = record.baseline == null ? null : parseBundle(record.baseline).scene
  const packingResult = record.packing_result == null ? null : parseBundle(record.scene, record.packing_result).packingResult ?? null
  const routingResult = record.routing_result == null ? null : parseBundle(record.scene, undefined, record.routing_result).routingResult ?? null
  const guide = record.guide == null ? null : (record.guide as Guide)
  const comparison = record.comparison == null ? null : (record.comparison as CanonicalComparison)
  for (const result of [guide, comparison]) {
    if (result && (result.scene_id !== sceneBundle.scene.scene_id ||
      result.scene_revision !== sceneBundle.scene.scene_revision ||
      result.baseline_id !== sceneBundle.scene.baseline_id)) throw new Error('收到过期结果，请重新读取场景')
  }
  const photoUrl = typeof record.photo_url === 'string' ? record.photo_url : null
  return {
    scene: sceneBundle.scene,
    baseline,
    packing_result: packingResult,
    routing_result: routingResult,
    comparison,
    guide,
    photo_url: photoUrl,
  }
}

/** Build the packing preview scene from a result, but only after parseBundle verifies it. */
export function buildPackingPreview(
  doc: SceneDocument,
): { previewScene: Scene; packingResult: PackingResult } | null {
  if (!doc.packing_result) return null
  const bundle = parseBundle(doc.scene, doc.packing_result)
  if (!bundle.packingResult) return null
  const byId = new Map(bundle.packingResult.items.map((i) => [i.item_id, i]))
  const previewScene: Scene = {
    ...bundle.scene,
    items: bundle.scene.items.map((item) => {
      const placement = byId.get(item.id)
      if (!placement) return item
      return {
        ...item,
        position: placement.target_pos,
        rotation_y_rad: placement.target_rotation_y_rad,
      }
    }),
  }
  return { previewScene, packingResult: bundle.packingResult }
}

type RequestOptions = {
  method?: string
  body?: unknown
  signal?: AbortSignal
  formData?: FormData
  raw?: boolean
  accept?: string
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error('request timeout')), REQUEST_TIMEOUT_MS)
  const onAbort = () => controller.abort(new Error('aborted'))
  if (options.signal) {
    if (options.signal.aborted) onAbort()
    else options.signal.addEventListener('abort', onAbort, { once: true })
  }
  try {
    const headers: Record<string, string> = {}
    let body: BodyInit | undefined
    if (options.formData) {
      body = options.formData
    } else if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(options.body)
    }
    if (options.accept) headers['Accept'] = options.accept
    const res = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body,
      signal: controller.signal,
    })
    if (!res.ok) throw await toApiError(res)
    if (options.raw) return (await res.text()) as unknown as T
    if (res.status === 204) return undefined as unknown as T
    const text = await res.text()
    if (!text) return undefined as unknown as T
    return JSON.parse(text) as T
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', onAbort)
  }
}

async function requestDoc(path: string, options: RequestOptions = {}): Promise<SceneDocument> {
  const data = await request<unknown>(path, options)
  return parseDoc(data)
}

export function createScene(signal?: AbortSignal): Promise<SceneDocument> {
  return requestDoc('/scenes', { method: 'POST', body: {}, signal })
}

export function getScene(sceneId: string, signal?: AbortSignal): Promise<SceneDocument> {
  return requestDoc(`/scenes/${sceneId}`, { method: 'GET', signal })
}

export function saveScene(
  sceneId: string,
  expectedRevision: number,
  scene: Scene,
  signal?: AbortSignal,
): Promise<SceneDocument> {
  return requestDoc(`/scenes/${sceneId}`, {
    method: 'PUT',
    body: { expected_revision: expectedRevision, scene },
    signal,
  })
}

export function confirmBaseline(
  sceneId: string,
  expectedRevision: number,
  signal?: AbortSignal,
): Promise<SceneDocument> {
  return requestDoc(`/scenes/${sceneId}/baseline`, {
    method: 'POST',
    body: { expected_revision: expectedRevision },
    signal,
  })
}

export function runPacking(
  sceneId: string,
  expectedRevision: number,
  signal?: AbortSignal,
): Promise<SceneDocument> {
  return requestDoc(`/scenes/${sceneId}/packing`, {
    method: 'POST',
    body: { expected_revision: expectedRevision },
    signal,
  })
}

export function applyPacking(
  sceneId: string,
  expectedRevision: number,
  signal?: AbortSignal,
): Promise<SceneDocument> {
  return requestDoc(`/scenes/${sceneId}/packing/apply`, {
    method: 'POST',
    body: { expected_revision: expectedRevision },
    signal,
  })
}

export function runRouting(
  sceneId: string,
  expectedRevision: number,
  signal?: AbortSignal,
): Promise<SceneDocument> {
  return requestDoc(`/scenes/${sceneId}/routing`, {
    method: 'POST',
    body: { expected_revision: expectedRevision },
    signal,
  })
}

export function runGuide(
  sceneId: string,
  expectedRevision: number,
  signal?: AbortSignal,
): Promise<SceneDocument> {
  return requestDoc(`/scenes/${sceneId}/guide`, {
    method: 'POST',
    body: { expected_revision: expectedRevision },
    signal,
  })
}

export function fetchGuideMarkdown(sceneId: string, revision: number, signal?: AbortSignal): Promise<string> {
  return request<string>(`/scenes/${sceneId}/guide.md?expected_revision=${revision}`, {
    method: 'GET',
    raw: true,
    accept: 'text/markdown',
    signal,
  })
}

export function uploadPhoto(
  sceneId: string,
  expectedRevision: number,
  file: File,
  signal?: AbortSignal,
): Promise<SceneDocument> {
  const form = new FormData()
  form.append('file', file)
  form.append('expected_revision', String(expectedRevision))
  return requestDoc(`/scenes/${sceneId}/photos`, { method: 'POST', formData: form, signal })
}

export function getStoredSceneId(): string | null {
  try {
    return window.localStorage.getItem(SCENE_ID_KEY)
  } catch {
    return null
  }
}

export function setStoredSceneId(id: string): void {
  try {
    window.localStorage.setItem(SCENE_ID_KEY, id)
  } catch {
    /* storage unavailable */
  }
}

export function clearStoredSceneId(): void {
  try {
    window.localStorage.removeItem(SCENE_ID_KEY)
  } catch {
    /* storage unavailable */
  }
}

export function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}
