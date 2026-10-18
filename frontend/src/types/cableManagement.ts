import type { Vec3 } from './project'
import type { UndersideTrayOptimization } from '@/algorithm-lab/contract'

export type CableMountFace = 'x_min' | 'x_max' | 'y_min' | 'y_max' | 'z_min' | 'z_max'
export type CableManagementPreset = 'rear-clips' | 'underside-ties' | 'underside-tray'

/** A configured attachment on a real furniture face, in frontend world coordinates. */
export interface CableMount {
  id: string
  label: string
  kind: 'surface' | 'cable_tie' | 'cable_tray'
  obstacleId: string
  face: CableMountFace
  /** Bounds on the face's two tangent axes, in x/y/z order. */
  boundsUvM: [number, number, number, number]
  standOffM: number
  /** False is an installation suggestion, never evidence of physical support. */
  installed: boolean
  preset?: CableManagementPreset
}

export interface CableManagementConfig {
  mounts: CableMount[]
  verifySupport: boolean
  maxUnsupportedSpanM: number
}

export interface CableMountVolume { min: Vec3; max: Vec3 }

export interface CableTrayAnalysis {
  sceneId: string
  sceneRevision: number
  optimizations: UndersideTrayOptimization[]
}

export const CABLE_MANAGEMENT_PRESET_LABELS: Record<CableManagementPreset, string> = {
  'rear-clips': '桌后理线扣',
  'underside-ties': '桌下扎带',
  'underside-tray': '桌下集线槽',
}
