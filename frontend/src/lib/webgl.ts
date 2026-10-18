/**
 * WebGL 可用性检测（工作台与方案交付页共用的降级入口）。
 * 在无 WebGL 的环境中三维视图不可用，调用方需给出可操作的降级说明。
 */
let supported: boolean | undefined

export function detectWebGL(): boolean {
  if (supported !== undefined) return supported
  try {
    const canvas = document.createElement('canvas')
    // Three r169 requires WebGL2. Release the probe rather than leaking a context
    // every time the user switches between previews.
    const context = canvas.getContext('webgl2', { powerPreference: 'high-performance' })
    supported = Boolean(context)
    context?.getExtension('WEBGL_lose_context')?.loseContext()
    return supported
  } catch {
    return false
  }
}
