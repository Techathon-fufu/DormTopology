import { ACESFilmicToneMapping, PCFSoftShadowMap, SRGBColorSpace, type WebGLRenderer } from 'three'

/** A preference for the browser's GPU selection, not a guarantee of hardware acceleration. */
export const SCENE_GL_OPTIONS = {
  powerPreference: 'high-performance',
  antialias: true,
  alpha: false,
  stencil: false,
} as const

export const SCENE_CAMERA_CLIP = { near: 0.1, far: 30 } as const
export const SCENE_BACKGROUND = '#F4F7F8'

export function sceneDpr(): [number, number] {
  return [1, 1.5]
}

export function configureSceneRenderer(gl: WebGLRenderer): void {
  gl.outputColorSpace = SRGBColorSpace
  gl.toneMapping = ACESFilmicToneMapping
  gl.toneMappingExposure = 1
  gl.shadowMap.type = PCFSoftShadowMap
}
