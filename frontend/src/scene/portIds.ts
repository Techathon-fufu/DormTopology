import type { CableEndpoint, Project } from '@/types/project'
import { invalidateCableRoutes } from './cables'

/** Repair legacy recognition templates without changing valid IDs or geometry. */
export function repairDuplicatePortIds<T extends Pick<Project, 'objects' | 'cables'>>(scene: T): T {
  const reserved = new Set([
    ...scene.objects.map((object) => object.id),
    ...scene.cables.map((cable) => cable.id),
    ...scene.objects.flatMap((object) => object.ports.map((port) => port.id)),
  ])
  const seen = new Set([...scene.objects.map((object) => object.id), ...scene.cables.map((cable) => cable.id)])
  const replacements = new Map<string, Map<string, string>>()
  let changed = false
  const objects = scene.objects.map((object) => {
    const ownIds = new Set<string>()
    let objectChanged = false
    const ports = object.ports.map((port, index) => {
      const repeatedWithinObject = ownIds.has(port.id)
      ownIds.add(port.id)
      if (!seen.has(port.id)) { seen.add(port.id); return port }
      const base = `port:${encodeURIComponent(object.id)}:${encodeURIComponent(port.id)}:${index}`
      let id = base, suffix = 1
      while (reserved.has(id)) id = `${base}:${suffix++}`
      reserved.add(id)
      seen.add(id)
      // Endpoints include the owner. For malformed duplicates within one owner,
      // retain their existing first-port reference rather than guessing a target.
      if (!repeatedWithinObject) {
        const mapping = replacements.get(object.id) ?? new Map<string, string>()
        mapping.set(port.id, id)
        replacements.set(object.id, mapping)
      }
      changed = objectChanged = true
      return { ...port, id }
    })
    return objectChanged ? { ...object, ports } : object
  })
  if (!changed) return scene
  const endpoint = (value: CableEndpoint): CableEndpoint => {
    const portId = value.portId && replacements.get(value.objectId)?.get(value.portId)
    return portId ? { ...value, portId } : value
  }
  return { ...scene, objects, cables: invalidateCableRoutes(scene.cables.map((cable) => ({
    ...cable, from: endpoint(cable.from), to: endpoint(cable.to),
  }))) }
}
