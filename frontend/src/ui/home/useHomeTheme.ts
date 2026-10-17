import { useSyncExternalStore } from 'react'

/**
 * 首页日夜外观（仅首页使用，不改变工作台与其余页面的颜色）。
 *
 * 优先级：本机已保存的手动选择 > 系统外观 > 默认日间。
 * 存储被禁用时退化为「本次会话内存中的手动选择」，不会因为读不到存储就跳回系统外观。
 * 订阅在离开首页时完全释放，重新进入时重新对齐存储与系统外观。
 */

export type HomeTheme = 'light' | 'dark'

const STORAGE_KEY = 'dormtopology.home-theme'
const MEDIA_QUERY = '(prefers-color-scheme: dark)'

type Listener = () => void
type StoredTheme = { available: boolean; value: HomeTheme | null }

const listeners = new Set<Listener>()

let snapshot: HomeTheme = 'light'
/** 手动选择优先于系统外观（含上一次会话保存的选择） */
let manual = false
/** 写入存储失败时，内存中的选择不能被随后的同步覆盖 */
let writeFailed = false
let started = false
let media: MediaQueryList | null = null
let mediaBound = false

function systemTheme(): HomeTheme {
  try {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      return window.matchMedia(MEDIA_QUERY).matches ? 'dark' : 'light'
    }
  } catch {
    /* matchMedia 不可用：按日间处理 */
  }
  return 'light'
}

/** available=false 表示存储被禁用，此时「读不到」不等于「用户没选过」 */
function readStored(): StoredTheme {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return { available: false, value: null }
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return { available: true, value: raw === 'light' || raw === 'dark' ? raw : null }
  } catch {
    return { available: false, value: null }
  }
}

function publish(next: HomeTheme) {
  if (next === snapshot) return
  snapshot = next
  for (const listener of listeners) listener()
}

function sync() {
  const stored = readStored()
  // 存储被禁用：手动选择留在内存里，没手动选过才跟随系统。
  if (!stored.available) {
    if (!manual) publish(systemTheme())
    return
  }
  if (stored.value) {
    // 本地已有明确选择：以它为准，同时解除此前写入失败的锁定。
    manual = true
    writeFailed = false
    publish(stored.value)
    return
  }
  // 读得到但没有值：若是本会话写入失败导致，保留内存选择；否则回到系统外观。
  if (writeFailed) return
  manual = false
  publish(systemTheme())
}

function onMediaChange(event: MediaQueryListEvent) {
  if (manual) return
  publish(event.matches ? 'dark' : 'light')
}

function onStorage(event: StorageEvent) {
  if (event.key !== null && event.key !== STORAGE_KEY) return
  sync()
}

function onVisibility() {
  if (document.visibilityState === 'visible') sync()
}

function ensureMedia(): MediaQueryList | null {
  if (media) return media
  try {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      media = window.matchMedia(MEDIA_QUERY)
    }
  } catch {
    media = null
  }
  return media
}

function bindMedia() {
  const mql = ensureMedia()
  if (!mql || mediaBound) return
  if (typeof mql.addEventListener === 'function') mql.addEventListener('change', onMediaChange)
  else if (typeof mql.addListener === 'function') mql.addListener(onMediaChange)
  mediaBound = true
}

function unbindMedia() {
  if (!media || !mediaBound) return
  if (typeof media.removeEventListener === 'function') media.removeEventListener('change', onMediaChange)
  else if (typeof media.removeListener === 'function') media.removeListener(onMediaChange)
  mediaBound = false
}

function attach() {
  if (started || typeof window === 'undefined') return
  started = true
  // 重新进入首页时重新对齐：其他标签页或系统可能在此期间改过外观。
  sync()
  window.addEventListener('storage', onStorage)
  document.addEventListener('visibilitychange', onVisibility)
  bindMedia()
}

function detach() {
  if (!started) return
  started = false
  window.removeEventListener('storage', onStorage)
  document.removeEventListener('visibilitychange', onVisibility)
  unbindMedia()
}

function subscribe(listener: Listener) {
  listeners.add(listener)
  attach()
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) detach()
  }
}

function getSnapshot(): HomeTheme {
  return snapshot
}

function getServerSnapshot(): HomeTheme {
  return 'light'
}

function setTheme(theme: HomeTheme) {
  if (theme !== 'light' && theme !== 'dark') return
  manual = true
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY, theme)
      writeFailed = false
    } else {
      writeFailed = true
    }
  } catch {
    writeFailed = true
  }
  publish(theme)
}

// 模块加载即对齐一次，首帧就使用正确外观，避免先画浅色再切换。
if (typeof window !== 'undefined') sync()

export function useHomeTheme(): { theme: HomeTheme; setTheme: (theme: HomeTheme) => void } {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  return { theme, setTheme }
}
