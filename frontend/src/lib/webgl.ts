/**
 * WebGL 可用性检测（工作台与方案交付页共用的降级入口）。
 * 在无 WebGL 的环境中三维视图不可用，调用方需给出可操作的降级说明。
 */
export function detectWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
  } catch {
    return false
  }
}
