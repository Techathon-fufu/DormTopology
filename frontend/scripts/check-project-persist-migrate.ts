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
const { usePlansStore } = await import('../src/state/plansStore')
const { migrateDefaultDemoPorts, migrateDefaultDemoWiring, useProjectsStore } = await import('../src/state/projectsStore')

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
  usePlansStore.setState({ baselines: {}, candidates: {} })
  usePlansStore.getState().captureBaseline(old)
  const oldBaseline = structuredClone(usePlansStore.getState().baselines[old.id])
  useProjectsStore.getState().ensureDemo()
  const projects = useProjectsStore.getState().projects
  const current = projects[DEMO_PROJECT_ID]
  assert.equal(current.demoSeedVersion, DEMO_SEED_VERSION)
  assert.equal(current.room.furnitureModel, 'dormdesk-v1')
  assert.deepEqual(current.objects, createDemoProject().objects)
  const archives = Object.values(projects).filter((p) => p.id.startsWith(`${DEMO_PROJECT_ID}-seed-`))
  assert.equal(archives.length, 1)
  const archive = archives[0]
  assert.equal(usePlansStore.getState().baselines[old.id], undefined)
  assert.equal(usePlansStore.getState().baselines[archive.id].id, oldBaseline.id)
  assert.deepEqual(usePlansStore.getState().baselines[archive.id].scene!.objects.map((o) => ({ ...o, projectId: old.id })), oldBaseline.scene!.objects)
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

const legacyPorts = createDemoProject()
legacyPorts.objects = legacyPorts.objects.map((o) => ({ ...o, ports: o.ports.map((p) => p.id === 'port-laptop-usbc'
  ? { ...p, confirmed: false, offset: [.172, .03, -.06] }
  : p.id === 'port-monitor-hdmi' ? { ...p, confirmed: false, offset: [-.12, .05, -.092] }
    : p.id === 'port-monitor-pwr' ? { ...p, confirmed: true, offset: [.12, .05, -.092] }
      : p.id === 'port-laptop-hdmi' ? { ...p, confirmed: false, offset: [.173, .05, -.01] } : p) }))
const surfacePorts = migrateDefaultDemoPorts(legacyPorts)
const port = (p: typeof legacyPorts, id: string) => p.objects.flatMap((o) => o.ports).find((entry) => entry.id === id)!
assert.deepEqual(port(surfacePorts, 'port-laptop-usbc').offset, [.175, .005, -.06])
assert.deepEqual(port(surfacePorts, 'port-monitor-hdmi').offset, [-.12, .15, -.012])
assert.deepEqual(port(surfacePorts, 'port-monitor-pwr').offset, [.12, .05, -.092], 'confirmed port measurements are preserved')
assert.deepEqual(port(surfacePorts, 'port-laptop-hdmi').offset, [.173, .05, -.01], 'user-edited unconfirmed positions are preserved')
assert.equal(port(surfacePorts, 'port-laptop-usbc').confirmed, false)
assert.equal(migrateDefaultDemoPorts(surfacePorts), surfacePorts)

const oldWiring = createDemoProject()
oldWiring.name = 'Saved placement'
oldWiring.objects[0].transform.position[0] = -.19
oldWiring.objects = oldWiring.objects.map((o) => ({ ...o,
  ports: o.ports.filter((p) => p.id !== 'port-adapter-usbc-phone').map((p) => ({ ...p, confirmed: true })),
}))
oldWiring.cables = oldWiring.cables.filter((c) => c.id !== 'demo-cable-adapter-ac').map((c): typeof c => {
  if (c.id === 'demo-cable-laptop') return { ...c, to: { objectId: 'demo-power-strip', portId: 'port-strip-1', position: [.325, .781, .13] },
    note: '现状：笔记本充电线在桌面拖出松散弯折后斜跨垂落（待规划）' }
  if (c.id === 'demo-cable-phone') return { ...c, thickness: 'thin', to: { objectId: 'demo-power-strip', portId: 'port-strip-4', position: [.475, .781, .13] },
    note: '现状：手机充电线散在桌面（默认「可见线」：规划后从桌面出线槽走线；线径默认细线）' }
  return c
})
entries.set('dormtopology.projects', JSON.stringify({ version: 3, state: { projects: { [DEMO_PROJECT_ID]: oldWiring } } }))
await useProjectsStore.persist.rehydrate()
useProjectsStore.getState().ensureDemo()
const rewired = useProjectsStore.getState().projects[DEMO_PROJECT_ID]
assert.equal(rewired.name, oldWiring.name)
assert.deepEqual(rewired.room, oldWiring.room)
assert.deepEqual(rewired.objects.map((o) => ({ id: o.id, transform: o.transform, dimensions: o.dimensions })),
  oldWiring.objects.map((o) => ({ id: o.id, transform: o.transform, dimensions: o.dimensions })))
assert.equal(Object.keys(useProjectsStore.getState().projects).length, 1, 'wiring repair never reseeds or archives the layout')
assert.equal(rewired.cables.length, 7)
assert.equal(rewired.cables.find((c) => c.id === 'demo-cable-laptop')?.to.portId, 'port-adapter-usbc')
assert.equal(rewired.cables.find((c) => c.id === 'demo-cable-phone')?.to.portId, 'port-adapter-usbc-phone')
assert.equal(rewired.cables.find((c) => c.id === 'demo-cable-phone')?.thickness, 'thin')
assert.equal(rewired.objects.find((o) => o.id === 'demo-power-adapter')?.ports.find((p) => p.id === 'port-adapter-usbc-phone')?.confirmed, false)
assert.ok(rewired.objects.flatMap((o) => o.ports).filter((p) => p.id !== 'port-adapter-usbc-phone').every((p) => p.confirmed))
assert.equal(migrateDefaultDemoWiring(rewired), rewired, 'wiring repair is idempotent')
assert.equal(migrateDefaultDemoWiring({ ...oldWiring, id: 'custom', isDemo: false }).id, 'custom')
const future = { ...oldWiring, demoSeedVersion: DEMO_SEED_VERSION + 1 }
assert.equal(migrateDefaultDemoWiring(future), future, 'future seeds are not downgraded')
const customized = { ...oldWiring, cables: oldWiring.cables.map((c) => ({ ...c, note: 'User connection' })) }
assert.equal(migrateDefaultDemoWiring(customized), customized, 'user-edited cable definitions stay unchanged')
const partlyFixed = { ...oldWiring, cables: oldWiring.cables.map((c): typeof c => c.id === 'demo-cable-laptop'
  ? { ...c, to: { objectId: 'demo-power-adapter', portId: 'port-adapter-usbc', position: [-.05, .7675, .34] }, note: 'User fixed laptop' }
  : c) }
const completed = migrateDefaultDemoWiring(partlyFixed)
assert.deepEqual(completed.cables.find((c) => c.id === 'demo-cable-laptop')?.to,
  partlyFixed.cables.find((c) => c.id === 'demo-cable-laptop')?.to)
assert.equal(completed.cables.find((c) => c.id === 'demo-cable-phone')?.to.portId, 'port-adapter-usbc-phone')
assert.ok(completed.cables.some((c) => c.id === 'demo-cable-adapter-ac'))
const occupied = { ...oldWiring, cables: [...oldWiring.cables, { ...oldWiring.cables[0], id: 'custom-strip-connection',
  from: { objectId: 'demo-power-adapter', portId: 'port-adapter-ac', position: [-.15, .7675, .34] },
  to: { objectId: 'demo-power-strip', portId: 'port-strip-1', position: [.325, .781, .13] } }] }
const repairedOccupied = migrateDefaultDemoWiring(occupied)
assert.ok(repairedOccupied.cables.some((c) => c.id === 'custom-strip-connection'))
assert.equal(repairedOccupied.cables.filter((c) => c.id === 'demo-cable-adapter-ac').length, 0, 'do not duplicate an existing AC input connection')
console.log('Actual project-store hydration v1/v2/v3, archived edits, custom geometry and idempotence passed.')
console.log('Saved default wiring repair passed: placement retained, separate USB outputs, AC input, confirmations and custom connections preserved.')
