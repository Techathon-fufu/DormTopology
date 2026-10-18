import assert from 'node:assert/strict'
import { createDemoProject } from '../src/data/demoProject'
import { createLegacyDemoProject } from './fixtures/legacyDemo'
import { cableMountVolume, createCableManagementPreset, currentCableTrayAnalysis, mountToRoutingSupport, mountToTrayCandidate, resolveCableManagement, validCableMounts } from '../src/scene/cableManagement'
import { toPackingPosition } from '../src/api/core/packingWire'
import type { CableManagementPreset } from '../src/types/cableManagement'

const presets: CableManagementPreset[] = ['rear-clips', 'underside-ties', 'underside-tray']
for (const project of [createDemoProject(), createLegacyDemoProject()]) {
  assert.equal(resolveCableManagement(project.room).verifySupport, false)
  for (const preset of presets) {
    const mounts = createCableManagementPreset(project.room, preset)
    assert.ok(mounts.length > 0, `${project.room.furnitureModel ?? 'legacy'}: ${preset}`)
    assert.ok(mounts.every((mount) => !mount.installed), 'a preset never confirms installation')
    const room = { ...project.room, cableManagement: { mounts, verifySupport: false, maxUnsupportedSpanM: .3 } }
    assert.equal(validCableMounts(room).length, mounts.length)
    for (const mount of mounts) {
      assert.ok(cableMountVolume(room, mount))
      const wire = mountToRoutingSupport(mount, (point) => toPackingPosition(point, room))
      assert.equal(wire.obstacle_id, mount.obstacleId)
      assert.equal(wire.face, mount.face)
      assert.equal(wire.bounds_uv_m[0], toPackingPosition([mount.boundsUvM[0], 0, 0], room)[0])
      if (mount.kind === 'cable_tray') {
        assert.equal(mountToTrayCandidate(mount, ['one'], (point) => point), null)
        assert.equal(mountToTrayCandidate(mount, ['one', 'one'], (point) => point), null)
        const candidate = mountToTrayCandidate(mount, ['one', 'two'], (point) => point)!
        assert.deepEqual(candidate.cable_ids, ['one', 'two'])
        assert.equal(mountToTrayCandidate({ ...mount, installed: true }, ['one', 'two'], (point) => point), null)
      }
      assert.equal(cableMountVolume(room, { ...mount, obstacleId: 'deleted-furniture' }), null)
      assert.equal(cableMountVolume(room, { ...mount, boundsUvM: [-99, 99, -99, 99] }), null)
    }
  }
}

const entries = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => entries.get(key) ?? null,
  setItem: (key: string, value: string) => entries.set(key, value),
  removeItem: (key: string) => entries.delete(key),
} })
const { useProjectsStore } = await import('../src/state/projectsStore')
const { useWorkspaceStore } = await import('../src/state/workspaceStore')
const project = createDemoProject()
project.id = 'accessory-regression'
project.isDemo = false
project.cables = project.cables.map((cable) => ({ ...cable, status: 'planned', planSource: 'algorithm' }))
const analyzed = { ...project,
  cableTrayAnalysis: { sceneId: 'verified-scene', sceneRevision: 3, optimizations: [] },
  cables: project.cables.map((cable) => ({ ...cable, route: { ...cable.route, verification: {
    sceneId: 'verified-scene', sceneRevision: 3, status: 'valid' as const, supportStatus: 'not_evaluated' as const,
  } } })),
}
assert.equal(currentCableTrayAnalysis(analyzed), analyzed.cableTrayAnalysis)
assert.equal(currentCableTrayAnalysis({ ...analyzed, cables: analyzed.cables.map((cable, index) => index === 0 ? { ...cable, status: 'stale' } : cable) }), undefined)
assert.equal(currentCableTrayAnalysis({ ...analyzed, cableTrayAnalysis: { ...analyzed.cableTrayAnalysis, sceneRevision: 4 } }), undefined)
assert.equal(currentCableTrayAnalysis({ ...analyzed, cables: [] }), undefined)
assert.equal(currentCableTrayAnalysis({ ...analyzed, cables: project.cables }), undefined)
useProjectsStore.getState().upsert(project)
const workspace = useWorkspaceStore.getState()
workspace.resetHistory()
const mounts = createCableManagementPreset(project.room, 'underside-tray')
const config = { mounts, verifySupport: false, maxUnsupportedSpanM: .3 }
workspace.updateCableManagement(project.id, config)
const current = () => useProjectsStore.getState().projects[project.id]
assert.deepEqual(current().room.cableManagement, config)
assert.ok(current().cables.every((cable) => cable.status === 'stale'), 'adding a proposal invalidates saved routes')
workspace.updateCableManagement(project.id, { ...config, mounts: mounts.map((mount) => ({ ...mount, installed: true })) })
assert.equal(current().room.cableManagement?.mounts[0].installed, true)
workspace.undo(project.id)
assert.equal(current().room.cableManagement?.mounts[0].installed, false)
workspace.undo(project.id)
assert.equal(current().room.cableManagement, undefined)
assert.ok(current().cables.every((cable) => cable.status === 'stale'), 'undo never restores a previous verified route')
workspace.redo(project.id)
workspace.redo(project.id)
assert.equal(current().room.cableManagement?.mounts[0].installed, true)
const historyLength = useWorkspaceStore.getState().past.length
workspace.updateCableManagement(project.id, structuredClone(current().room.cableManagement!))
assert.equal(useWorkspaceStore.getState().past.length, historyLength, 'unchanged edits do not consume undo history')
await useProjectsStore.persist.rehydrate()
assert.equal(current().room.cableManagement?.mounts[0].installed, true, 'installation state survives actual store hydration')
workspace.updateCableManagement(project.id, { ...config, mounts: [] })
assert.equal(current().room.cableManagement?.mounts.length, 0)
workspace.undo(project.id)
assert.equal(current().room.cableManagement?.mounts[0].installed, true)
console.log('Cable management: real fixed/legacy mounts, candidate semantics, persistence, undo/redo and route invalidation passed.')
