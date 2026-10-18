import { useEffect } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { OUTLET_FIXED_Y_M, type Project } from '@/types/project'
import { createDemoCables, createDemoProject, createDemoSceneObjects, DEMO_PROJECT_ID, DEMO_ROOM_NOTE, DEMO_SEED_VERSION } from '@/data/demoProject'
import { cableRoutingObjectsSignature, endpointOf, invalidateCableRoutes } from '@/scene/cables'
import { resolveOrganizationPreferences } from '@/types/organization'
import { useCableStore } from './cableStore'

/**
 * 项目元数据与场景配置（localStorage 持久化）。
 * 照片与模型文件不放这里，见 src/storage/idb.ts。
 *
 * 两层版本，职责不同，不要混用：
 * - `PROJECTS_PERSIST_VERSION`：持久化 schema 版本。字段结构变化时 +1，并用 migrate 转换旧数据。
 * - `DEMO_SEED_VERSION`：内置示例项目的数据版本。示例场景内容变化时 +1，由 ensureDemo 定向迁移或归档重种。
 */
const PROJECTS_PERSIST_VERSION = 3

/** 内置示例项目是否需要按最新示例数据重种 */
export function isDemoProjectStale(project: Project | undefined): boolean {
  if (!project || project.id !== DEMO_PROJECT_ID) return false
  return (project.demoSeedVersion ?? 0) < DEMO_SEED_VERSION
}

/** Move only untouched, unconfirmed legacy ports onto their actual primitive surfaces. */
export function migrateDefaultDemoPorts(project: Project): Project {
  if (project.id !== DEMO_PROJECT_ID || project.demoSeedVersion !== DEMO_SEED_VERSION
    || project.room.furnitureModel !== 'dormdesk-v1') return project
  const oldOffsets: Record<string, [number, number, number]> = {
    'port-laptop-usbc': [.172, .03, -.06], 'port-laptop-hdmi': [.172, .05, -.01],
    'port-laptop-usba': [.172, .015, .06], 'port-monitor-pwr': [.12, .05, -.092],
    'port-monitor-hdmi': [-.12, .05, -.092], 'port-lamp-pwr': [0, .06, -.092],
  }
  const defaults = createDemoSceneObjects(project.id)
  let changed = false
  const objects = project.objects.map((object) => {
    const original = defaults.find((o) => o.id === object.id)
    if (!original || original.model.shape !== object.model.shape
      || (['width', 'height', 'depth'] as const).some((key) => original.dimensions[key] !== object.dimensions[key])) return object
    let updated = false
    const ports = object.ports.map((port) => {
      const old = oldOffsets[port.id], next = original.ports.find((p) => p.id === port.id)
      if (!old || !next || port.confirmed === true || port.type !== next.type || port.direction !== next.direction
        || !port.offset?.every((v, i) => v === old[i])) return port
      changed = updated = true
      return { ...port, offset: next.offset, confirmed: false }
    })
    return updated ? { ...object, ports } : object
  })
  return changed ? { ...project, objects, cables: invalidateCableRoutes(project.cables), updatedAt: Date.now() } : project
}

/** Repair only the two known seed connections; preserve saved placement and user wiring. */
export function migrateDefaultDemoWiring(project: Project): Project {
  if (project.id !== DEMO_PROJECT_ID || project.demoSeedVersion !== DEMO_SEED_VERSION
    || project.room.furnitureModel !== 'dormdesk-v1') return project
  const adapter = project.objects.find((o) => o.id === 'demo-power-adapter' && o.model.shape === 'powerAdapter')
  const strip = project.objects.find((o) => o.id === 'demo-power-strip')
  if (!adapter || !strip) return project
  const ac = adapter.ports.find((p) => p.id === 'port-adapter-ac' && p.type === 'power-ac')
  const laptopOutput = adapter.ports.find((p) => p.id === 'port-adapter-usbc' && p.type === 'usb-c')
  const phonePort = adapter.ports.find((p) => p.id === 'port-adapter-usbc-phone')
  if (!ac || !laptopOutput || (phonePort && phonePort.type !== 'usb-c')) return project
  const repairs = [
    { id: 'demo-cable-laptop', objectId: 'demo-laptop', portId: 'port-laptop-usbc', stripPort: 'port-strip-1', output: laptopOutput.id,
      note: '现状：笔记本充电线在桌面拖出松散弯折后斜跨垂落（待规划）' },
    { id: 'demo-cable-phone', objectId: 'demo-phone', portId: 'port-phone-usbc', stripPort: 'port-strip-4', output: 'port-adapter-usbc-phone',
      note: '现状：手机充电线散在桌面（默认「可见线」：规划后从桌面出线槽走线；线径默认细线）' },
  ].filter((repair) => project.cables.some((c) => c.id === repair.id
    && c.from.objectId === repair.objectId && c.from.portId === repair.portId
    && c.to.objectId === strip.id && c.to.portId === repair.stripPort
    && (c.note === repair.note || c.planSource === 'algorithm')))
  if (!repairs.length) return project
  const occupied = (objectId: string, portId: string, excluded: string[] = []) => project.cables.some((c) => !excluded.includes(c.id)
    && [c.from, c.to].some((e) => e.objectId === objectId && e.portId === portId))
  const safe = repairs.filter((r) => !occupied(adapter.id, r.output))
  if (!safe.length) return project
  const needsAc = !occupied(adapter.id, ac.id)
  if (needsAc && (!strip.ports.some((p) => p.id === 'port-strip-1' && p.type === 'power-ac')
    || occupied(strip.id, 'port-strip-1', safe.map((r) => r.id))
    || project.cables.some((c) => c.id === 'demo-cable-adapter-ac'))) return project
  const nextAdapter = safe.some((r) => r.output === 'port-adapter-usbc-phone') && !phonePort
    ? { ...adapter, ports: [...adapter.ports, { id: 'port-adapter-usbc-phone', type: 'usb-c' as const,
      label: 'USB-C 输出 2', powered: true, confirmed: false, direction: 'right' as const,
      offset: [adapter.dimensions.width / 2, adapter.dimensions.height / 2, .015] as [number, number, number] }] }
    : adapter
  const objects = project.objects.map((o) => o === adapter ? nextAdapter : o)
  const defaults = createDemoCables(objects, project.id)
  const cables = project.cables.map((c) => {
    const repair = safe.find((r) => r.id === c.id)
    if (!repair) return c
    const to = endpointOf(nextAdapter, nextAdapter.ports.find((p) => p.id === repair.output))
    return { ...c, to, note: defaults.find((d) => d.id === c.id)?.note }
  })
  if (needsAc) {
    const cable = defaults.find((c) => c.id === 'demo-cable-adapter-ac')
    if (!cable) return project
    cables.push(cable)
  }
  return { ...project, objects, cables: invalidateCableRoutes(cables), updatedAt: Date.now() }
}

interface ProjectsState {
  projects: Record<string, Project>
  ensureDemo: () => void
  /** 重新种入内置示例项目（回到凌乱初始状态，供「一键演示 / 重置重播」使用） */
  resetDemo: () => void
  upsert: (project: Project) => void
  update: (id: string, updater: (p: Project) => Project) => void
  remove: (id: string) => void
}

export const useProjectsStore = create<ProjectsState>()(
  persist(
    (set, get) => ({
      projects: {},
      ensureDemo() {
        let existing = get().projects[DEMO_PROJECT_ID]
        // v6 → v7 只移除演示书本，保留用户对其余物品、接口和房间的编辑。
        if (DEMO_SEED_VERSION >= 7 && existing?.demoSeedVersion === 6) {
          get().update(DEMO_PROJECT_ID, (p) => {
            const removedIds = new Set(p.objects
              .filter((o) => o.id === 'demo-books' || o.id.startsWith('demo-book-'))
              .map((o) => o.id))
            return { ...p, demoSeedVersion: 7,
              objects: p.objects.filter((o) => !removedIds.has(o.id)),
              cables: p.cables.filter((c) => !removedIds.has(c.from.objectId) && !removedIds.has(c.to.objectId)),
            }
          })
          existing = get().projects[DEMO_PROJECT_ID]
        }
        // 不存在，或仍是旧种子版本的示例场景：按最新示例数据重种。
        // 仅作用于内置示例项目，用户自建项目不受影响。
        if (!existing || isDemoProjectStale(existing)) {
          // Preserve the previous desktop and edits when the built-in furniture changes.
          const archiveId = existing ? `${DEMO_PROJECT_ID}-seed-${existing.demoSeedVersion ?? 0}-${Date.now()}` : null
          const archive = existing && archiveId ? { ...existing, id: archiveId, isDemo: false,
            name: `${existing.name}（旧家具保留）`,
            objects: existing.objects.map((o) => ({ ...o, projectId: archiveId })),
            cables: invalidateCableRoutes((existing.cables ?? []).map((c) => ({ ...c, projectId: archiveId }))),
          } : null
          set((s) => ({ projects: { ...s.projects, ...(archive && archiveId ? { [archiveId]: archive } : {}), [DEMO_PROJECT_ID]: createDemoProject() } }))
        } else {
          const migrated = migrateDefaultDemoWiring(migrateDefaultDemoPorts(existing))
          if (migrated !== existing) {
            useCableStore.getState().resetAnim()
            set((s) => ({ projects: { ...s.projects, [DEMO_PROJECT_ID]: migrated } }))
          }
        }
      },
      resetDemo() {
        set((s) => ({
          projects: { ...s.projects, [DEMO_PROJECT_ID]: createDemoProject() },
        }))
      },
      upsert(project) {
        set((s) => ({
          projects: { ...s.projects, [project.id]: { ...project, updatedAt: Date.now() } },
        }))
      },
      update(id, updater) {
        const p = get().projects[id]
        if (!p) return
        const next = updater(p)
        const routingChanged = JSON.stringify(p.room) !== JSON.stringify(next.room)
          || JSON.stringify(resolveOrganizationPreferences(p)) !== JSON.stringify(resolveOrganizationPreferences(next))
          || cableRoutingObjectsSignature(p.objects) !== cableRoutingObjectsSignature(next.objects)
        if (routingChanged) useCableStore.getState().resetAnim()
        set((s) => ({
          projects: { ...s.projects, [id]: { ...next,
            cables: routingChanged ? invalidateCableRoutes(next.cables) : next.cables,
            updatedAt: Date.now() } },
        }))
      },
      remove(id) {
        if (id === DEMO_PROJECT_ID) return // 内置示例项目不可删除
        set((s) => {
          const next = { ...s.projects }
          delete next[id]
          return { projects: next }
        })
      },
    }),
    {
      name: 'dormtopology.projects',
      version: PROJECTS_PERSIST_VERSION,
      /**
       * 迁移历史（两轮改动合并后的口径）：
       * v1 → v2：早期版本把旧示例场景写进了本地存储，示例数据更新后不生效；迁移时按种子版本重种内置示例项目。
       * v2 → v3（0.9.0）：墙面插座收敛为一块「双插孔 ×2」面板（合并历史左右两个独立插座）；
       *   示例项目同时按最新示例数据重种，用户自建项目仅归一插座，其余字段原样保留。
       */
      migrate: (persisted, from) => {
        const state = persisted as Partial<ProjectsState> | undefined
        if (!state?.projects) return persisted as ProjectsState
        const projects = { ...state.projects }
        if (from < 3) {
          for (const [id, p] of Object.entries(projects)) {
            if (!p?.room) continue
            projects[id] = {
              ...p,
              cables: invalidateCableRoutes(p.cables ?? []),
              room: {
                ...p.room,
                outlets: [mergeOutletPanel(p.room.outlets?.[0])],
                note: id === DEMO_PROJECT_ID ? DEMO_ROOM_NOTE : p.room.note,
              },
            }
          }
        }
        // ensureDemo archives the previous seed after hydration, including schema migrations.
        return { ...state, projects } as ProjectsState
      },
    },
  ),
)

/** 把旧的「左 / 右两个独立插座」合并为一块面板（保留第一个插座的 id 与左右位置） */
function mergeOutletPanel(first: Project['room']['outlets'][number] | undefined): Project['room']['outlets'][number] {
  return {
    id: first?.id ?? 'outlet-1',
    position: [first?.position?.[0] ?? 0, OUTLET_FIXED_Y_M, first?.position?.[2] ?? 0.01],
    label: '后墙插座（双插孔 ×2）',
    slots: 2,
  }
}

/** 页面级读取项目；确保内置示例项目存在（任意深链都能进入同一示例项目） */
export function useProject(id: string | undefined): Project | undefined {
  const ensureDemo = useProjectsStore((s) => s.ensureDemo)
  const project = useProjectsStore((s) => (id ? s.projects[id] : undefined))
  useEffect(() => {
    ensureDemo()
  }, [ensureDemo])
  return project
}

export function readProject(id: string): Project | undefined {
  return useProjectsStore.getState().projects[id]
}
