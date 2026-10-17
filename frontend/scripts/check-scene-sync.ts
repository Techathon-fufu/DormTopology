import assert from 'node:assert/strict'
import { createDemoProject } from '../src/data/demoProject'
import { resolveOrganizationPreferences } from '../src/types/organization'
import { toPackingScene, type PackingScene } from '../src/api/core/packingWire'
import { ApiError } from '../src/api/core/errors'
import { forgetOrganizationScene, knownOrganizationScene, rememberOrganizationScene, type StoredOrganizationScene } from '../src/api/core/organizationScenes'
import { synchronizeScene } from '../src/api/core/sceneSync'

const storage = new Map<string, string>()
let storageUnavailable = false
let storageWriteUnavailable = false
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem(key: string) {
    if (storageUnavailable) throw new Error('Storage unavailable')
    return storage.get(key) ?? null
  },
  setItem(key: string, value: string) {
    if (storageWriteUnavailable) throw new DOMException('Storage quota exceeded', 'QuotaExceededError')
    storage.set(key, value)
  },
  removeItem: (key: string) => storage.delete(key),
} })

const project = createDemoProject()
const original = toPackingScene({
  projectId: project.id, objects: project.objects, room: project.room,
  preferences: resolveOrganizationPreferences(project), confirmed: true,
})
const known: StoredOrganizationScene = {
  sceneId: 'scene-existing', sceneRevision: 4,
  baselineId: 'baseline-existing', baselineSourceId: 'source-original',
}
const draft: PackingScene = { ...original, scene_id: known.sceneId, scene_revision: known.sceneRevision, baseline_id: known.baselineId }
const baseline = structuredClone(draft)
const canonical = (revision: number, overrides: Partial<PackingScene> = {}): PackingScene => ({
  ...structuredClone(draft), scene_revision: revision, ...overrides,
})
const args = { projectId: 'scene-sync-regression', scene: draft, baseline, baselineSourceId: known.baselineSourceId, known }
const conflict = { detail: 'Use null for initial creation or the current revision for edits' }
const missing = { detail: 'Project scene not found' }

interface CapturedRequest {
  method: string
  path: string
  body: Record<string, unknown> | undefined
}

interface Step {
  method: 'GET' | 'PUT'
  status?: number
  data?: unknown
  networkFailure?: boolean
  beforeResponse?: () => void
}

let cases = 0
async function withResponses(steps: Step[], run: (requests: CapturedRequest[]) => Promise<void>) {
  const previous = globalThis.fetch
  const requests: CapturedRequest[] = []
  let unexpected = false
  globalThis.fetch = async (input, options) => {
    const request = {
      method: options?.method ?? 'GET', path: String(input),
      body: options?.body ? JSON.parse(String(options.body)) as Record<string, unknown> : undefined,
    }
    requests.push(request)
    const step = steps[requests.length - 1]
    if (!step) {
      unexpected = true
      throw new Error(`Unexpected request: ${request.method} ${request.path}`)
    }
    step.beforeResponse?.()
    if (step.networkFailure) throw new TypeError('Simulated lost response')
    return new Response(JSON.stringify(step.data ?? {}), {
      status: step.status ?? 200, headers: { 'Content-Type': 'application/json' },
    })
  }
  try {
    await run(requests)
    assert.equal(unexpected, false, 'recovery must not issue unexpected requests')
    assert.equal(requests.length, steps.length, 'every expected request must run exactly once')
    for (const [index, request] of requests.entries()) {
      const step = steps[index]
      assert.equal(request.method, step.method)
      assert.ok(request.path.endsWith(`/projects/${args.projectId}/${step.method === 'GET' ? 'scene-state' : 'scene'}`))
    }
    cases += 1
  } finally { globalThis.fetch = previous }
}

const isConflict = (error: unknown) => error instanceof ApiError && error.kind === 'conflict' && error.status === 409
const isNetwork = (error: unknown) => error instanceof ApiError && error.kind === 'network'

rememberOrganizationScene(args.projectId, known)
await withResponses([
  { method: 'PUT', status: 409, data: conflict },
  { method: 'GET', status: 404, data: missing },
  { method: 'PUT', data: canonical(1, { scene_id: 'scene-recreated', baseline_id: 'baseline-recreated' }) },
], async (requests) => {
  const result = await synchronizeScene(args)
  assert.equal(result.scene_id, 'scene-recreated')
  assert.equal(result.scene_revision, 1)
  assert.equal(requests[0].body?.expected_revision, 4)
  assert.equal(requests[2].body?.expected_revision, null)
  assert.deepEqual(requests[2].body?.baseline, baseline, 'recreation requires the complete original baseline')
  assert.equal(knownOrganizationScene(args.projectId), null, 'an absent backend scene invalidates the old local reference')
})

rememberOrganizationScene(args.projectId, known)
await withResponses([
  { method: 'PUT', status: 409, data: conflict },
  { method: 'GET', status: 404, data: missing },
  { method: 'PUT', status: 409, data: conflict },
], async () => {
  await assert.rejects(() => synchronizeScene(args), isConflict)
  assert.equal(knownOrganizationScene(args.projectId), null)
})

const concurrentReference = { ...known, sceneRevision: known.sceneRevision + 1 }
rememberOrganizationScene(args.projectId, known)
await withResponses([
  { method: 'PUT', status: 409, data: conflict },
  { method: 'GET', status: 404, data: missing, beforeResponse: () => rememberOrganizationScene(args.projectId, concurrentReference) },
], async () => {
  await assert.rejects(() => synchronizeScene(args), isConflict)
  assert.deepEqual(knownOrganizationScene(args.projectId), concurrentReference, 'a stale request must not erase a newer reference from another tab')
})
forgetOrganizationScene(args.projectId)

for (const revision of [1, 7]) {
  await withResponses([
    { method: 'PUT', status: 409, data: conflict },
    { method: 'GET', data: { scene: canonical(revision), baseline_source_id: args.baselineSourceId } },
  ], async (requests) => {
    const result = await synchronizeScene({ ...args, known: null })
    assert.equal(result.scene_revision, revision)
    assert.equal(result.scene_id, known.sceneId)
    assert.equal(requests[0].body?.expected_revision, null)
    assert.equal(requests.filter((request) => request.method === 'PUT').length, 1, 'rebinding an identical scene must be read-only')
  })
}

for (const mismatch of ['source', 'content', 'scene-id', 'baseline-id'] as const) {
  const saved = canonical(4)
  if (mismatch === 'content') saved.items[0].name += ' changed by another client'
  if (mismatch === 'scene-id') saved.scene_id = 'scene-another'
  if (mismatch === 'baseline-id') saved.baseline_id = 'baseline-another'
  await withResponses([
    { method: 'PUT', status: 409, data: conflict },
    { method: 'GET', data: {
      scene: saved, baseline_source_id: mismatch === 'source' ? 'source-another' : args.baselineSourceId,
    } },
  ], async () => {
    const input = { ...args, known: mismatch === 'source' || mismatch === 'content' ? null : known }
    await assert.rejects(() => synchronizeScene(input), isConflict)
  })
}

await withResponses([
  { method: 'PUT', status: 409, data: conflict },
  { method: 'GET', data: { scene: canonical(known.sceneRevision - 1), baseline_source_id: args.baselineSourceId } },
], async () => {
  await assert.rejects(() => synchronizeScene(args), isConflict)
})

for (const revision of [1, 2]) {
  await withResponses([
    { method: 'PUT', networkFailure: true },
    { method: 'GET', data: { scene: canonical(revision), baseline_source_id: args.baselineSourceId } },
  ], async () => {
    const operation = () => synchronizeScene({ ...args, known: null })
    if (revision === 1) assert.equal((await operation()).scene_revision, 1)
    else await assert.rejects(operation, isNetwork)
  })
}

for (const revision of [4, 5, 6]) {
  await withResponses([
    { method: 'PUT', networkFailure: true },
    { method: 'GET', data: { scene: canonical(revision), baseline_source_id: args.baselineSourceId } },
  ], async () => {
    const operation = () => synchronizeScene(args)
    if (revision <= 5) assert.equal((await operation()).scene_revision, revision)
    else await assert.rejects(operation, isNetwork)
  })
}

for (const changedBaseline of [true, false]) {
  await withResponses([
    { method: 'PUT', networkFailure: true },
    { method: 'GET', data: {
      scene: canonical(5, { baseline_id: changedBaseline ? 'baseline-new' : known.baselineId }),
      baseline_source_id: 'source-new',
    } },
  ], async () => {
    const operation = () => synchronizeScene({ ...args, baselineSourceId: 'source-new' })
    if (changedBaseline) assert.equal((await operation()).baseline_id, 'baseline-new')
    else await assert.rejects(operation, isNetwork)
  })
}

const controller = new AbortController()
await withResponses([
  { method: 'PUT', networkFailure: true, beforeResponse: () => controller.abort() },
], async () => {
  await assert.rejects(() => synchronizeScene({ ...args, signal: controller.signal }),
    (error: unknown) => error instanceof ApiError && error.kind === 'aborted')
})

const readController = new AbortController()
await withResponses([
  { method: 'PUT', status: 409, data: conflict },
  { method: 'GET', networkFailure: true, beforeResponse: () => readController.abort() },
], async () => {
  await assert.rejects(() => synchronizeScene({ ...args, signal: readController.signal }),
    (error: unknown) => error instanceof ApiError && error.kind === 'aborted')
})

const cacheProject = 'scene-sync-storage-regression'
rememberOrganizationScene(cacheProject, known)
const storageKey = [...storage.keys()].find((key) => key.endsWith(`:${cacheProject}`))!
assert.ok(storageKey)
const externallyUpdated = { ...known, sceneRevision: known.sceneRevision + 1 }
storage.set(storageKey, JSON.stringify(externallyUpdated))
assert.deepEqual(knownOrganizationScene(cacheProject), externallyUpdated, 'other tabs can advance the persisted revision')
storage.delete(storageKey)
assert.equal(knownOrganizationScene(cacheProject), null, 'other tabs can invalidate the persisted reference')
rememberOrganizationScene(cacheProject, externallyUpdated)
storageUnavailable = true
try { assert.deepEqual(knownOrganizationScene(cacheProject), externallyUpdated, 'unavailable storage still permits the session cache') }
finally { storageUnavailable = false }
forgetOrganizationScene(cacheProject)
assert.equal(knownOrganizationScene(cacheProject), null)

rememberOrganizationScene(cacheProject, known)
storageWriteUnavailable = true
try {
  rememberOrganizationScene(cacheProject, externallyUpdated)
  assert.deepEqual(knownOrganizationScene(cacheProject), externallyUpdated, 'quota failure must retain the new session reference despite readable old storage')
} finally { storageWriteUnavailable = false }
const externallyReplaced = { ...known, sceneRevision: known.sceneRevision + 2 }
storage.set(storageKey, JSON.stringify(externallyReplaced))
assert.deepEqual(knownOrganizationScene(cacheProject), externallyReplaced, 'external storage changes replace a reference retained after quota failure')
forgetOrganizationScene(cacheProject)

console.log(`Scene synchronization checks passed: ${cases} HTTP scenarios covering backend reset, bounded recreation, missing references, strict conflicts, lost responses and abort; cross-tab storage and unavailable-storage fallback passed.`)
