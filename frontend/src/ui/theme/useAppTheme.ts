import { useSyncExternalStore } from 'react'

export type AppTheme = 'light' | 'dark'

// Keep the established key so existing homepage choices survive the shared-theme upgrade.
const STORAGE_KEY = 'dormtopology.home-theme'
const MEDIA_QUERY = '(prefers-color-scheme: dark)'

type Listener = () => void
type StoredTheme = { available: boolean; value: AppTheme | null }

const listeners = new Set<Listener>()
let snapshot: AppTheme = 'light'
let manual = false
let writeFailed = false
let started = false
let media: MediaQueryList | null = null
let mediaBound = false

function applyDocumentTheme(theme: AppTheme) {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.appTheme = theme
  document.documentElement.style.colorScheme = theme
}

function systemTheme(): AppTheme {
  try {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      return window.matchMedia(MEDIA_QUERY).matches ? 'dark' : 'light'
    }
  } catch {
    // Browsers without matchMedia use the light theme.
  }
  return 'light'
}

function readStored(): StoredTheme {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return { available: false, value: null }
    }
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return { available: true, value: raw === 'light' || raw === 'dark' ? raw : null }
  } catch {
    return { available: false, value: null }
  }
}

function publish(next: AppTheme) {
  applyDocumentTheme(next)
  if (next === snapshot) return
  snapshot = next
  for (const listener of listeners) listener()
}

function sync() {
  const stored = readStored()
  if (!stored.available) {
    publish(manual ? snapshot : systemTheme())
    return
  }
  if (stored.value) {
    manual = true
    writeFailed = false
    publish(stored.value)
    return
  }
  if (writeFailed) {
    applyDocumentTheme(snapshot)
    return
  }
  manual = false
  publish(systemTheme())
}

function onMediaChange(event: MediaQueryListEvent) {
  if (!manual) publish(event.matches ? 'dark' : 'light')
}

function onStorage(event: StorageEvent) {
  if (event.key === null || event.key === STORAGE_KEY) sync()
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
  const query = ensureMedia()
  if (!query || mediaBound) return
  if (typeof query.addEventListener === 'function') query.addEventListener('change', onMediaChange)
  else if (typeof query.addListener === 'function') query.addListener(onMediaChange)
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
  sync()
  window.addEventListener('storage', onStorage)
  document.addEventListener('visibilitychange', onVisibility)
  bindMedia()
}

function detach() {
  if (!started || typeof window === 'undefined') return
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

function getSnapshot(): AppTheme {
  return snapshot
}

function getServerSnapshot(): AppTheme {
  return 'light'
}

function setTheme(theme: AppTheme) {
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

if (typeof window !== 'undefined') sync()

export function useAppTheme(): { theme: AppTheme; setTheme: (theme: AppTheme) => void } {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  return { theme, setTheme }
}
