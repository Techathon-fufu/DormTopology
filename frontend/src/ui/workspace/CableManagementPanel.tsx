import { useMemo, useState } from 'react'
import { Check, Cable, Plus, Trash2 } from 'lucide-react'
import type { Project } from '@/types/project'
import { CABLE_MANAGEMENT_PRESET_LABELS, type CableManagementConfig, type CableManagementPreset } from '@/types/cableManagement'
import { cableMountVolume, createCableManagementPreset, currentCableTrayAnalysis, resolveCableManagement } from '@/scene/cableManagement'
import { formatMm } from '@/lib/units'
import { useWorkspaceStore } from '@/state/workspaceStore'
import { Badge } from '@/ui/kit/badge'
import { Button } from '@/ui/kit/button'
import { MmInput } from '@/ui/kit/mm-input'

export function CableManagementPanel({ project, busy, onFlash }: { project: Project; busy: boolean; onFlash: (message: string) => void }) {
  const [preset, setPreset] = useState<CableManagementPreset>('rear-clips')
  const config = resolveCableManagement(project.room)
  const options = useMemo(() => Object.keys(CABLE_MANAGEMENT_PRESET_LABELS).map((key) => {
    const value = key as CableManagementPreset
    return { value, mounts: createCableManagementPreset(project.room, value) }
  }), [project.room])
  const proposed = options.find((option) => option.value === preset)!.mounts
  const alreadyAdded = proposed.length > 0 && proposed.every((mount) => config.mounts.some((current) => current.id === mount.id))
  const validIds = new Set(config.mounts.filter((mount) => cableMountVolume(project.room, mount)).map((mount) => mount.id))
  const installed = config.mounts.filter((mount) => mount.installed && validIds.has(mount.id)).length
  const analysis = currentCableTrayAnalysis(project)
  const update = (next: CableManagementConfig) => {
    try {
      useWorkspaceStore.getState().updateCableManagement(project.id, next)
    } catch (error) {
      onFlash(error instanceof Error ? error.message : '配件配置未能保存')
    }
  }

  return <section className="space-y-2 border-t border-border pt-3" data-testid="cable-management-panel" data-mount-count={config.mounts.length}>
    <div className="flex items-center justify-between gap-2">
      <h3 className="flex items-center gap-1.5 text-[13px] font-medium"><Cable className="h-3.5 w-3.5 text-primary" />理线配件</h3>
      <span className="text-[11px] text-muted-foreground">已安装 {installed} / {config.mounts.length}</span>
    </div>
    <div className="flex items-center gap-1.5">
      <select aria-label="理线配件预设" className="h-8 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-xs"
        value={preset} disabled={busy} onChange={(event) => setPreset(event.target.value as CableManagementPreset)}>
        {options.map((option) => <option key={option.value} value={option.value}>{CABLE_MANAGEMENT_PRESET_LABELS[option.value]}（{option.mounts.length} {option.value === 'underside-tray' ? '段' : '个'}）</option>)}
      </select>
      <Button size="icon" variant="outline" className="h-8 w-8 shrink-0" title={alreadyAdded ? '该组配件已添加' : '添加配件建议'}
        aria-label="添加配件建议" disabled={busy || !proposed.length || alreadyAdded} onClick={() => {
          const mounts = [...config.mounts, ...proposed.filter((mount) => !config.mounts.some((current) => current.id === mount.id))]
          update({ ...config, mounts })
        }}><Plus className="h-3.5 w-3.5" /></Button>
    </div>
    {config.mounts.length > 0 && <div className="divide-y divide-border">
      {config.mounts.map((mount) => {
        const valid = validIds.has(mount.id)
        return <div key={mount.id} className="flex items-center gap-1.5 py-2" data-testid="cable-mount-row">
          <div className="min-w-0 flex-1">
            <span className="block break-words text-xs font-medium">{mount.label}</span>
            <Badge className="mt-1" variant={!valid ? 'danger' : mount.installed ? 'success' : 'warning'}>{!valid ? '安装位置已失效' : mount.installed ? '已确认安装' : '待安装建议'}</Badge>
          </div>
          <label className="flex shrink-0 items-center gap-1 text-[11px]">
            <input type="checkbox" className="accent-[#0F9D8A]" checked={mount.installed}
              disabled={busy || (!valid && !mount.installed)} aria-label={`确认已安装 ${mount.label}`}
              onChange={(event) => update({ ...config, mounts: config.mounts.map((current) => current.id === mount.id ? { ...current, installed: event.target.checked } : current) })} />
            已安装
          </label>
          <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0 text-muted-foreground" title={`删除 ${mount.label}`} aria-label={`删除 ${mount.label}`} disabled={busy}
            onClick={() => update({ ...config, mounts: config.mounts.filter((current) => current.id !== mount.id) })}><Trash2 className="h-3.5 w-3.5" /></Button>
        </div>
      })}
    </div>}
    <label className="flex items-center gap-2 py-1 text-xs">
      <input type="checkbox" className="accent-[#0F9D8A]" checked={config.verifySupport} disabled={busy}
        onChange={(event) => update({ ...config, verifySupport: event.target.checked })} />
      复核已安装配件的支撑跨距
      {config.verifySupport && <Check className="h-3 w-3 text-primary" />}
    </label>
    {config.verifySupport && <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
      <span className="min-w-0">最大悬空跨距</span>
      <MmInput label="最大悬空跨距" className="w-28 shrink-0" value={config.maxUnsupportedSpanM} min={50} max={2000} disabled={busy}
        onChange={(value) => update({ ...config, maxUnsupportedSpanM: value })} />
    </div>}
    {!!analysis?.optimizations.length && <div className="space-y-2 border-t border-border pt-2" data-testid="tray-analysis">
      <h4 className="text-xs font-medium">集线槽复查</h4>
      {analysis.optimizations.map((optimization) => <div key={optimization.id} className="space-y-1 text-[11px]">
        <div className="flex flex-wrap items-center justify-between gap-1">
          <span className="font-medium">{config.mounts.find((mount) => mount.id === (optimization.support_id ?? optimization.id))?.label ?? '桌下集线槽'}</span>
          <Badge variant={optimization.status === 'verified' ? 'success' : optimization.status === 'recommended' ? 'warning' : 'outline'}>
            {optimization.status === 'verified' ? '已验证汇聚' : optimization.status === 'recommended' ? '建议安装' : '未采用'}
          </Badge>
        </div>
        <p className="text-muted-foreground">{optimization.cable_ids.length} 根线 · 共享走向 {formatMm(optimization.shared_length_m)}</p>
        {optimization.cable_ids.map((id) => {
          const cable = project.cables.find((current) => current.id === id)
          return cable ? <p key={id} className="break-words text-faint">{project.objects.find((object) => object.id === cable.from.objectId)?.name ?? '设备'} → {project.objects.find((object) => object.id === cable.to.objectId)?.name ?? '设备'}</p> : null
        })}
        {optimization.reason_code && <p className="break-words text-warning">{optimization.reason_code === 'insufficient_width'
          ? optimization.occupied_width_m > 0
            ? `槽宽不足：线束 ${formatMm(optimization.occupied_width_m)} / 槽宽 ${optimization.available_width_m === null ? '未知' : formatMm(optimization.available_width_m)}`
            : `该安装位置容纳不下当前并排走向${optimization.available_width_m === null ? '' : `（槽宽 ${formatMm(optimization.available_width_m)}）`}`
          : optimization.reason_code === 'no_compatible_routes' ? '没有可并入该槽的共同走向' : '安装支撑尚未复核'}</p>}
      </div>)}
    </div>}
  </section>
}
