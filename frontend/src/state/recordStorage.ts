import type { StateStorage } from 'zustand/middleware'

/** Persist only locally changed record keys; an old tab must not erase other projects. */
export function recordStorage(fields: string[], storage: Storage = localStorage): StateStorage {
  const seen = new Map<string, string | null>()
  const parse = (value: string | null) => {
    try { return value ? JSON.parse(value) : null } catch { return null }
  }
  return {
    getItem(name) {
      const value = storage.getItem(name)
      seen.set(name, value)
      return value
    },
    setItem(name, value) {
      const incoming = parse(value), previous = parse(seen.get(name) ?? null)
      const remote = parse(storage.getItem(name))
      let merged = incoming
      if (incoming?.state && remote?.state && remote.version === incoming.version) {
        merged = { ...incoming, state: { ...incoming.state } }
        for (const field of fields) {
          const old = previous?.state?.[field] ?? {}, next = incoming.state[field] ?? {}
          const records = { ...remote.state[field] }
          for (const key of new Set([...Object.keys(old), ...Object.keys(next)])) {
            if (JSON.stringify(old[key]) === JSON.stringify(next[key])) continue
            if (key in next) records[key] = next[key]
            else delete records[key]
          }
          merged.state[field] = records
        }
      }
      storage.setItem(name, JSON.stringify(merged))
      seen.set(name, value)
    },
    removeItem(name) { seen.delete(name); storage.removeItem(name) },
  }
}
