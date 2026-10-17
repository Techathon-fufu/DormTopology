/* Node check script (run via esbuild bundling as repo scripts do).
 * Covers: surfaceHit inverse transforms + rejection, resolvePortLocalDirection
 * legacy/custom, portWorldDirection rotations, auditConnections blockers,
 * workspaceStore confirmation invalidation/preservation, routing/packing scene
 * serialization, and audio-backend boundary (audit message only).
 */
import assert from 'node:assert/strict'
import { surfaceHit, auditConnections } from '@/features/connections/model'
import { resolvePortLocalDirection } from '@/features/connections/portGeometry'
import { portWorldDirection, portWorldPosition } from '@/scene/ports'
import { createDemoProject, createStandardRoom } from '@/data/demoProject'
import { useWorkspaceStore } from '@/state/workspaceStore'
import { useProjectsStore } from '@/state/projectsStore'
import { toRoutingScene } from '@/api/core/routingWire'
import { toPackingScene } from '@/api/core/packingWire'
import type { Port, Project, SceneObject, Vec3 } from '@/types/project'

const close = (a: Vec3, b: Vec3, msg?: string) => {
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(a[i] - b[i]) < 1e-6, msg ?? `vec mismatch at ${i}: ${a} vs ${b}`)
}
const mkObj = (over: Partial<SceneObject> & { id: string }): SceneObject => ({
  projectId: 'p', name: over.id, category: 'electrical', dimensions: { width: 0.2, height: 0.2, depth: 0.2 },
  transform: { position: [0, 0, 0], rotationY: 0 }, model: { status: 'placeholder', source: 'demo', format: 'placeholder-box', shape: 'genericBox' },
  ports: [], quantity: 1, needsPower: false, visible: true, fixed: false, locked: false, frequent: false, ...over,
})
const port = (over: Partial<Port> & { id: string }): Port => ({ type: 'power-ac', powered: true, confirmed: true, offset: [0, 0.1, 0], direction: 'back', ...over })

// ── surfaceHit inverse transforms ──
{
  const o = mkObj({ id: 'h0', transform: { position: [1, 0.5, -2], rotationY: 0 } })
  const hit = surfaceHit(o, [1.3, 0.8, -1.5], [0, 0, 1])
  assert.ok(hit); close(hit!.offset, [0.3, 0.3, 0.5]); close(hit!.localDirection, [0, 0, 1]); assert.equal(hit!.objectId, 'h0')
  const rot = mkObj({ id: 'hpi2', transform: { position: [0, 0, 0], rotationY: Math.PI / 2 } })
  // local +x (1,0,0) rotated by +pi/2 about Y => world (0,0,-1)
  const h2 = surfaceHit(rot, [0, 0, -1], [0, 0, -1])
  assert.ok(h2); close(h2!.offset, [1, 0, 0]); close(h2!.localDirection, [1, 0, 0])
  const arb = 0.7
  const a = mkObj({ id: 'harb', transform: { position: [0.5, 0, 0.5], rotationY: arb } })
  const cos = Math.cos(arb), sin = Math.sin(arb)
  // world point = position + R*(local) ; pick local (0.2,0.1,-0.3)
  const lx = 0.2, ly = 0.1, lz = -0.3
  const wx = 0.5 + lx * cos + lz * sin, wz = 0.5 - lx * sin + lz * cos
  const wh = surfaceHit(a, [wx, ly, wz], [0, 1, 0])
  assert.ok(wh); close(wh!.offset, [lx, ly, lz], 'arb offset'); close(wh!.localDirection, [0, 1, 0])
  // rejections
  assert.equal(surfaceHit(o, [NaN, 0, 0], [0, 0, 1]), null)
  assert.equal(surfaceHit(o, [0, 0, 0], [0, 0, 0]), null)
  assert.equal(surfaceHit(mkObj({ id: 'bad', transform: { position: [0, 0, 0], rotationY: NaN } }), [0, 0, 0], [0, 0, 1]), null)
}

// ── resolvePortLocalDirection legacy + custom ──
{
  close(resolvePortLocalDirection({ direction: 'left' }), [-1, 0, 0])
  close(resolvePortLocalDirection({ direction: 'up' }), [0, 1, 0])
  close(resolvePortLocalDirection({ direction: 'front' }), [0, 0, 1])
  // custom normalized despite nonuniform source magnitude
  close(resolvePortLocalDirection({ direction: 'back', localDirection: [0, 0, -10] }), [0, 0, -1])
  close(resolvePortLocalDirection({ direction: 'back', localDirection: [3, 0, 4] }), [0.6, 0, 0.8])
  // invalid => fallback to legacy axis
  close(resolvePortLocalDirection({ direction: 'right', localDirection: [0, 0, 0] }), [1, 0, 0])
  close(resolvePortLocalDirection({ direction: 'right', localDirection: [Infinity, 0, 0] }), [1, 0, 0])
}

// ── portWorldDirection rotations ──
{
  const o0 = mkObj({ id: 'wd0' })
  close(portWorldDirection(o0, port({ id: 'p', direction: 'front' })), [0, 0, 1])
  const o90 = mkObj({ id: 'wd90', transform: { position: [0, 0, 0], rotationY: Math.PI / 2 } })
  close(portWorldDirection(o90, port({ id: 'p', direction: 'front' })), [1, 0, 0])
  close(portWorldPosition(o90, port({ id: 'p', offset: [1, 0, 0] })), [0, 0, -1])
}

// ── auditConnections blockers ──
{
  const p1 = port({ id: 'a', type: 'usb-c', powered: false })
  const p2 = port({ id: 'b', type: 'usb-c', powered: false })
  const o1 = mkObj({ id: 'o1', ports: [p1] })
  const o2 = mkObj({ id: 'o2', ports: [p2] })
  const cable = (over: any) => ({ id: 'c1', projectId: 'p', kind: 'data', from: { objectId: 'o1', portId: 'a' }, to: { objectId: 'o2', portId: 'b' }, route: { channels: ['free'], points: [[0, 0, 0], [1, 1, 1]] }, status: 'existing', planSource: 'manual', accessories: [], ...over })
  // dangling port
  const dang = auditConnections({ id: 'p', objects: [o1, o2], cables: [cable({ from: { objectId: 'o1', portId: 'nope' } })] })
  assert.ok(dang.blocking); assert.ok(dang.issues.some((i) => /悬空|不存在/.test(i.message)))
  // duplicate port id global
  const dup = auditConnections({ id: 'p', objects: [mkObj({ id: 'x', ports: [port({ id: 'dup' })] }), mkObj({ id: 'y', ports: [port({ id: 'dup' })] })], cables: [] })
  assert.ok(dup.issues.some((i) => /重复/.test(i.message)))
  // duplicate cable id
  const dupc = auditConnections({ id: 'p', objects: [o1, o2], cables: [cable({ id: 'cc', from: { objectId: 'o1', portId: 'a' } }), cable({ id: 'cc', from: { objectId: 'o1', portId: 'a' } })] })
  assert.ok(dupc.issues.some((i) => /线缆 ID 重复/.test(i.message)))
  // unconfirmed referenced port
  const unc = auditConnections({ id: 'p', objects: [mkObj({ id: 'o1', ports: [port({ id: 'a', type: 'usb-c', powered: false, confirmed: false })] }), o2], cables: [cable({})] })
  assert.ok(unc.issues.some((i) => /尚未确认/.test(i.message)))
  // incompatible port
  const inc = auditConnections({ id: 'p', objects: [mkObj({ id: 'o1', ports: [port({ id: 'a', type: 'hdmi' })] }), mkObj({ id: 'o2', ports: [port({ id: 'b', type: 'usb-a' })] })], cables: [cable({})] })
  assert.ok(inc.issues.some((i) => /不兼容/.test(i.message)))
  // duplicate connection + occupied
  const occ = auditConnections({ id: 'p', objects: [o1, o2], cables: [cable({ id: 'c1' }), cable({ id: 'c2' })] })
  assert.ok(occ.issues.some((i) => /占用|已存在/.test(i.message)))
  // cablekind mismatch
  const km = auditConnections({ id: 'p', objects: [o1, o2], cables: [cable({ kind: 'network' })] })
  assert.ok(km.issues.some((i) => /用途|不兼容/.test(i.message)))
  // wireless: no fake connection; electrical no-port with reference produces review
  const wl = auditConnections({ id: 'p', objects: [mkObj({ id: 'w', ports: [port({ id: 'w1', type: 'wireless' })] })], cables: [] })
  assert.equal(wl.objects[0].status, 'wireless'); assert.ok(!wl.blocking)
  const noport = auditConnections({ id: 'p', objects: [mkObj({ id: 'n', needsPower: true, ports: [] }), o2], cables: [cable({ from: { objectId: 'n', portId: 'x' } })] })
  assert.equal(noport.objects.find((r) => r.objectId === 'n')!.status, 'missing_ports')
  assert.ok(noport.issues.some((i) => /缺少物理接口/.test(i.message)))
  // audio boundary (audit message only)
  const au = auditConnections({ id: 'p', objects: [mkObj({ id: 'o1', ports: [port({ id: 'a', type: 'audio', powered: false })] }), mkObj({ id: 'o2', ports: [port({ id: 'b', type: 'audio', powered: false })] })], cables: [cable({ kind: 'data' })] })
  assert.ok(au.issues.some((i) => /音频/.test(i.message)))
  const hidden = auditConnections({id:'p',objects:[{...o1,visible:false,category:'nonElectrical'},o2],cables:[cable({})]})
  assert.equal(hidden.objects.length,2)
  assert.equal(hidden.blocking,false)
  const crossId = auditConnections({id:'p',objects:[mkObj({id:'same',ports:[port({id:'same'})]})],cables:[]})
  assert.equal(crossId.blocking,true)
  // no mutation of inputs
  const frozen = JSON.stringify([o1, o2])
  auditConnections({ id: 'p', objects: [o1, o2], cables: [cable({})] })
  assert.equal(JSON.stringify([o1, o2]), frozen)
}

// ── workspaceStore confirmation invalidation / preservation ──
{
  const projectId = 'test-ws-1'
  const base = createDemoProject()
  const obj: SceneObject = mkObj({ id: 'ws-obj', category: 'electrical', needsPower: true, ports: [port({ id: 'ws-port', type: 'usb-c', powered: false, confirmed: true, offset: [0.1, 0.1, -0.1], direction: 'back' })], transform: { position: [0, 0.75, 0], rotationY: 0 } })
  const project: Project = { ...base, id: projectId, objects: [obj], cables: [] }
  useProjectsStore.setState({ projects: { [projectId]: project } } as any)
  useWorkspaceStore.getState().resetHistory()

  const get = () => useProjectsStore.getState().projects[projectId].objects.find((o) => o.id === 'ws-obj')!
  // dimension edit clears confirmation
  useWorkspaceStore.getState().updateObject(projectId, 'ws-obj', { dimensions: { width: 0.5 } })
  assert.equal(get().ports[0].confirmed, false, 'dimension edit clears confirmation')
  // re-confirm, localDirection edit clears confirmation
  useWorkspaceStore.getState().updateObject(projectId, 'ws-obj', { ports: [{ ...get().ports[0], localDirection: [1, 0, 0] }] })
  assert.equal(get().ports[0].confirmed, false)
  useWorkspaceStore.getState().updateObject(projectId, 'ws-obj', { ports: [{ ...get().ports[0], confirmed: true }] })
  assert.equal(get().ports[0].confirmed, true)
  useWorkspaceStore.getState().updateObject(projectId, 'ws-obj', { ports: [{ ...get().ports[0], localDirection: [0, 0, 1] }] })
  assert.equal(get().ports[0].confirmed, false, 'localDirection edit clears confirmation')
  // re-confirm, movement preserves confirmed + endpointWorld transforms
  useWorkspaceStore.getState().updateObject(projectId, 'ws-obj', { ports: [{ ...get().ports[0], confirmed: true, localDirection: [0, 0, 1] }] })
  const beforePos = portWorldPosition(get(), get().ports[0])
  useWorkspaceStore.getState().updateObject(projectId, 'ws-obj', { transform: { position: [1, 0.75, 2] } })
  assert.equal(get().ports[0].confirmed, true, 'movement preserves confirmation')
  const afterPos = portWorldPosition(get(), get().ports[0])
  close([afterPos[0] - beforePos[0], 0, afterPos[2] - beforePos[2]], [1, 0, 2], 'endpointWorld tracks movement')
  // rotation preserves confirmed endpoint direction
  useWorkspaceStore.getState().updateObject(projectId, 'ws-obj', { transform: { rotationY: Math.PI / 2 } })
  assert.equal(get().ports[0].confirmed, true, 'rotation preserves confirmation')
  close(portWorldDirection(get(), get().ports[0]), [1, 0, 0], 'rotated endpoint direction')
  useWorkspaceStore.getState().updateObject(projectId,'ws-obj',{ports:[{...get().ports[0],direction:'up'}]})
  assert.equal(get().ports[0].confirmed,false)
  close(portWorldDirection(get(),get().ports[0]),[0,1,0],'legacy direction edits override picked normals')
  useWorkspaceStore.getState().updateObject(projectId,'ws-obj',{ports:[{...get().ports[0],confirmed:true}]})
  // label/note preserve confirmation
  useWorkspaceStore.getState().updateObject(projectId, 'ws-obj', {ports:[{...get().ports[0],label:'renamed',note:'n'}]})
  assert.equal(get().ports[0].confirmed, true, 'label/note preserve confirmation')
}

// ── serialization: routing scene + packing scene, no wire extra fields ──
{
  const project = createDemoProject()
  project.cables = []
  const packed = toPackingScene({ projectId: project.id, objects: project.objects, room: project.room, preferences: project.organization as any, confirmed: true } as any)
  assert.ok(packed && Array.isArray(packed.items))
  const routing = toRoutingScene({ project: { ...project, room: createStandardRoom() }, confirmed: true })
  assert.ok(routing && Array.isArray(routing.cables))
  for (const c of routing.cables) {
    assert.ok(typeof (c as any).start_port_id === 'string' && typeof (c as any).end_port_id === 'string')
    assert.ok(!('additionalProperties' in (c as any)))
  }
  // custom normalized local direction surfaces in routing scene
  const custom = createDemoProject()
  custom.cables = []
  custom.objects[0] = { ...custom.objects[0], ports: [{ id: 'cust', type: 'usb-c', powered: false, confirmed: true, localDirection: [0, 0, 50], offset: [0, 0, 0] }] }
  const rs = toRoutingScene({ project: custom, confirmed: true })
  const item = rs.items.find((i) => i.ports.some((p) => p.id === 'cust'))!
  const cp = item.ports.find((p) => p.id === 'cust')!
  close(cp.local_direction as Vec3, [0, 0, 1])
}

console.log('check-surface-connections: all assertions passed')
