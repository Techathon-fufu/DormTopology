import type { SceneObject } from '@/types/project'
import type { OrganizationPreferences } from '@/types/organization'

/** Physical floor support does not make the floor a suitable organization target. */
export function allowsFloorPlacement(object: SceneObject, preferences: OrganizationPreferences): boolean {
  const shape = object.model.shape
  if (shape === 'computerTower') return true
  if (object.frequent || preferences.preferredStorageZone !== 'underDesk' || object.powerStrip) return false
  if (shape === 'storageBox') return true
  if (shape && shape !== 'genericBox') return false
  return object.category === 'storage'
}
