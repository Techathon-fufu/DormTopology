import type { Project, Vec3 } from '@/types/project'
import { effectiveCableHoles, fixedFurnitureBoxes, furnitureSurfaces, hasFixedFurniture, rearCablePassage } from '@/scene/fixedFurniture'
import { portWorldPosition } from '@/scene/ports'
import { DESK_GAP } from '@/scene/sceneValidation'
import { toPackingPosition, type RoutingGraph } from './packingWire'

/** Sparse edge rails derived from the same furniture bounds as the visible GLB. */
export function buildOrthogonalRoutingGraph(project: Project): RoutingGraph {
  const { room } = project, d = room.desk
  const fixed = hasFixedFurniture(room)
  const surfaces = fixed ? furnitureSurfaces(room, false).filter(s => s.kind === 'desk').map(s => s.rect)
    : [{ x0: -d.width / 2, x1: d.width / 2, z0: DESK_GAP, z1: DESK_GAP + d.depth }]
  const baffle = fixed ? fixedFurnitureBoxes.find(b => b.name === 'Desk_Back_Baffle') : undefined
  const graph: RoutingGraph = { path_style: 'orthogonal', nodes: [], edges: [] }
  const positions = new Map<string, string>(), clearances = new Map<string, number>(), edgeKeys = new Set<string>()
  const add = (name: string, p: Vec3, kind: RoutingGraph['nodes'][number]['kind'] = 'corner', clearance = .015) => {
    const point = toPackingPosition(p, room)
    const key = point.map(v => v.toFixed(8)).join(',')
    const existing = positions.get(key)
    if (existing) return existing
    const id = `routing:${name}`
    positions.set(key, id); clearances.set(id, clearance)
    graph.nodes.push({ id, position: point, kind })
    return id
  }
  const edge = (a: string, b: string, modes: Array<'slot' | 'backboard'>, exposed = false) => {
    if (a === b) return
    const key = [a, b].sort().join('|') + modes.join(',')
    if (edgeKeys.has(key)) return
    edgeKeys.add(key)
    graph.edges.push({ id: `routing:edge:${graph.edges.length}`, from_node_id: a, to_node_id: b, modes,
      clearance_radius_m: Math.min(clearances.get(a)!, clearances.get(b)!), exposed })
  }
  const connected = new Set(project.cables.flatMap(c => [c.from.portId, c.to.portId]))
  const portXs = project.objects.flatMap(o => o.ports.filter(p => connected.has(p.id)).map(p => portWorldPosition(o, p)[0]))
  if (fixed && baffle) {
    const passage = rearCablePassage
    const midZ = (passage.min[2] + passage.max[2]) / 2
    const passageXs = [passage.min[0] + .02, (passage.min[0] + passage.max[0]) / 2, passage.max[0] - .02]
    const xs = [...new Set([baffle.min[0] + .025, baffle.max[0] - .025, ...passageXs, ...portXs].map(x => +x.toFixed(6))
      .filter(x => x >= baffle.min[0] + .015 && x <= baffle.max[0] - .015))].sort((a, b) => a - b)
    for (let lane = 0; lane < 3; lane++) {
      const topY = passage.max[1] + .012 + lane * .012
      const underY = passage.min[1] - .025 - lane * .012
      const frontZ = passage.max[2] + .012 + lane * .012
      const rearZ = baffle.min[2] - .012 - lane * .012
      const lowY = baffle.min[1] - .015 - lane * .012
      let previous: string[] | undefined
      for (const [i, x] of xs.entries()) {
        const name = `rear-passage:${lane}:${i}`
        const top = add(`${name}:top-rail`, [x, topY, frontZ])
        const under = add(`${name}:under-rail`, [x, underY, frontZ], 'fixing_point')
        const lowFront = add(`${name}:low-front`, [x, lowY, frontZ], 'fixing_point')
        const lowBack = add(`${name}:low-back`, [x, lowY, rearZ], 'fixing_point')
        const back = add(`${name}:back-rail`, [x, underY, rearZ], 'fixing_point')
        edge(under, lowFront, ['backboard']); edge(lowFront, lowBack, ['backboard']); edge(lowBack, back, ['backboard'])
        const row = [top, under, lowFront, lowBack, back]
        if (previous) row.forEach((id, j) => edge(previous![j], id, ['backboard'], j === 0))
        previous = row
        if (x > passage.min[0] + .01 && x < passage.max[0] - .01) {
          const clearance = (passage.max[2] - passage.min[2]) / 2 - .001
          const entry = add(`${name}:entry`, [x, topY, midZ], 'corner', clearance)
          const exit = add(`${name}:exit`, [x, underY, midZ], 'fixing_point', clearance)
          edge(top, entry, ['backboard']); edge(entry, exit, ['backboard']); edge(exit, under, ['backboard'])
        }
      }
    }
    return graph
  }
  for (const [surfaceIndex, rect] of surfaces.entries()) {
    const left = rect.x0 + .025, right = rect.x1 - .025
    const xs = [...new Set([left, right, (left + right) / 2, ...portXs,
      ...effectiveCableHoles(room).map(h => h.position[0])].filter(x => x >= left && x <= right))].sort((a, b) => a - b)
    const frontZ = Math.max(rect.z0, baffle?.max[2] ?? rect.z0)
    const rearFace = baffle?.min[2] ?? rect.z0
    for (let lane = 0; lane < 3; lane++) {
      const topY = d.height + .012 + lane * .012
      const underY = d.height - d.thickness - .025 - lane * .012
      const z = frontZ + .012 + lane * .012
      const rearZ = rearFace - .010 - lane * .010
      const overY = (baffle?.max[1] ?? d.height) + .012 + lane * .012
      let previous: string[] | undefined
      for (const [index, x] of xs.entries()) {
        const name = `edge-rear:${surfaceIndex}:${lane}:${index}`
        const front = add(`${name}:top`, [x, topY, z])
        const under = add(`${name}:under`, [x, underY, z])
        const overFront = add(`${name}:over-front`, [x, overY, z])
        const overBack = add(`${name}:over-back`, [x, overY, rearZ], 'fixing_point')
        const rearTop = add(`${name}:back-top`, [x, topY, rearZ], 'fixing_point')
        const rearUnder = add(`${name}:back-under`, [x, underY, rearZ], 'fixing_point')
        edge(front, overFront, ['backboard'])
        edge(overFront, overBack, ['backboard'])
        edge(overBack, rearTop, ['backboard'])
        edge(rearTop, rearUnder, ['backboard'])
        const row = [front, under, overFront, overBack, rearTop, rearUnder]
        if (previous) row.forEach((id, layer) => edge(previous![layer], id, layer < 2 ? ['slot', 'backboard'] : ['backboard']))
        previous = row
        // Short parallel branches reach the opening; only slot routes can
        // enter them. A rear-route connector also closes this tunnel in Python.
        for (const hole of effectiveCableHoles(room).filter(h => Math.abs(h.position[0] - x) < 1e-7)) {
          const half = hole.diameter / (2 * Math.sqrt(2))
          const dz = lane === 0 ? 0 : (lane === 1 ? -1 : 1) * Math.min(.008, half / 3)
          const clearance = Math.min(.015, half - Math.abs(dz) - .002)
          if (lane && clearance < .007) continue
          const a = add(`hole:${hole.id}:${lane}:top`, [x, topY, hole.position[2] + dz], 'slot', clearance)
          const b = add(`hole:${hole.id}:${lane}:under`, [x, underY, hole.position[2] + dz], 'slot', clearance)
          edge(front, a, ['slot'], true); edge(a, b, ['slot']); edge(b, under, ['slot'])
        }
      }
    }
  }
  // Connect adjoining desk surfaces only along a common axis. No complete
  // graph, diagonal shortcuts, or fictitious passage through the L-shaped gap.
  const axis = (a: Vec3, b: Vec3) => a.reduce((n, v, i) => n + Number(Math.abs(v - b[i]) > 1e-8), 0)
  for (const a of graph.nodes) for (const b of graph.nodes) {
    if (a.id >= b.id || a.kind === 'slot' || b.kind === 'slot') continue
    if (axis(a.position, b.position) !== 1 || Math.hypot(...a.position.map((v, i) => v - b.position[i])) > .08) continue
    const back = a.kind === 'fixing_point' || b.kind === 'fixing_point' || a.id.includes(':over-') || b.id.includes(':over-')
    edge(a.id, b.id, back ? ['backboard'] : ['slot', 'backboard'])
  }
  return graph
}
