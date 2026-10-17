import assert from 'node:assert/strict'
import { createDemoProject, DEMO_PROJECT_ID, DEMO_SEED_VERSION } from '../src/data/demoProject'
import { createLegacyDemoProject } from './fixtures/legacyDemo'
import { OUTLET_FIXED_Y_M } from '../src/types/project'

// Hydrate the actual Zustand store, including its real persist migration.
const entries = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { value: {
  getItem: (key: string) => entries.get(key) ?? null,
  setItem: (key: string, value: string) => entries.set(key, value),
  removeItem: (key: string) => entries.delete(key),
}, configurable: true })
const { useProjectsStore } = await import('../src/state/projectsStore')

for (const version of [1, 2, 3]) {
  const old = createLegacyDemoProject()
  old.demoSeedVersion = 3
  old.name = 'Edited previous furniture'
  old.objects[0].transform.position[0] = -.31
  old.room.outlets = [
    { id: 'old-left', position: [-.4, .35, .01], label: 'left', slots: 2 },
    { id: 'old-right', position: [.4, .35, .01], label: 'right', slots: 2 },
  ]
  const custom = structuredClone(old)
  custom.id = 'user-project'
  custom.isDemo = false
  custom.name = 'User geometry'
  const geometry = structuredClone(old.objects)
  const oldRoom = structuredClone(old.room)
  entries.set('dormtopology.projects', JSON.stringify({ version, state: { projects: { [DEMO_PROJECT_ID]: old, [custom.id]: custom } } }))
  await useProjectsStore.persist.rehydrate()
  assert.equal(useProjectsStore.getState().projects[DEMO_PROJECT_ID].demoSeedVersion, 3, 'hydration preserves the old seed until archiving')
  useProjectsStore.getState().ensureDemo()
  const projects = useProjectsStore.getState().projects
  const current = projects[DEMO_PROJECT_ID]
  assert.equal(current.demoSeedVersion, DEMO_SEED_VERSION)
  assert.equal(current.room.furnitureModel, 'dormdesk-v1')
  assert.deepEqual(current.objects, createDemoProject().objects)
  const archives = Object.values(projects).filter((p) => p.id.startsWith(`${DEMO_PROJECT_ID}-seed-`))
  assert.equal(archives.length, 1)
  const archive = archives[0]
  assert.equal(archive.isDemo, false)
  assert.equal(archive.room.furnitureModel, undefined)
  assert.deepEqual(archive.room.desk, oldRoom.desk)
  assert.deepEqual(archive.objects.map((o) => ({ ...o, projectId: old.id })), geometry)
  assert.ok(archive.cables.every((c) => c.projectId === archive.id && c.status === 'stale'))
  const savedCustom = projects[custom.id]
  assert.deepEqual(savedCustom.objects, custom.objects)
  assert.deepEqual(savedCustom.room.desk, custom.room.desk)
  if (version < 3) {
    assert.equal(savedCustom.room.outlets.length, 1)
    assert.deepEqual(savedCustom.room.outlets[0].position, [-.4, OUTLET_FIXED_Y_M, .01])
  } else assert.deepEqual(savedCustom, JSON.parse(JSON.stringify(custom)))
  const ids = Object.keys(projects)
  useProjectsStore.getState().ensureDemo()
  assert.deepEqual(Object.keys(useProjectsStore.getState().projects), ids, 'upgrading is idempotent')
}
const earliest = createLegacyDemoProject()
earliest.demoSeedVersion = 1
const { cables: _cables, ...withoutCables } = earliest
entries.set('dormtopology.projects', JSON.stringify({ version: 1, state: { projects: { [DEMO_PROJECT_ID]: withoutCables } } }))
await useProjectsStore.persist.rehydrate()
useProjectsStore.getState().ensureDemo()
const archived = Object.values(useProjectsStore.getState().projects).find((p) => !p.isDemo)!
assert.ok(archived)
assert.deepEqual(archived.cables, [])
assert.deepEqual(archived.room.desk, earliest.room.desk)
console.log('Actual project-store hydration v1/v2/v3, archived edits, custom geometry and idempotence passed.')
