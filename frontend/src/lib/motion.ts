import { useEffect, useState } from 'react'

/**
 * 系统「减少动态效果」偏好（prefers-reduced-motion）：
 * - prefersReducedMotion()：非响应式读取（供 store / 服务层调用，SSR / Node 环境返回 false）；
 * - usePrefersReducedMotion()：组件内订阅，偏好变化时自动重渲染。
 *
 * 行为约定：整理动画与线缆收拢动画在开启该偏好时直接显示末态（不做分批 / 插值动画），
 * 相关面板会就地提示。
 */
const QUERY = '(prefers-reduced-motion: reduce)'

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(QUERY).matches
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(QUERY)
    const onChange = () => setReduced(mql.matches)
    onChange()
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    }
    // 旧浏览器（Safari < 14）兼容
    mql.addListener(onChange)
    return () => mql.removeListener(onChange)
  }, [])
  return reduced
}
