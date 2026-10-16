import { useEffect, useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Download, Minus, Plus, RotateCcw } from 'lucide-react'
import type { Project } from '@/types/project'
import {
  ACCESSORY_CAPABILITY,
  ACCESSORY_KIND_LABELS,
  ACCESSORY_LIMITS,
  ACCESSORY_NOTES,
  accessoryDimSpecs,
  buildAccessoryGroup,
  disposeAccessoryGroup,
  exportAccessoryToGlb,
  type AccessoryKind,
  type AccessoryParams,
  type AccessorySpec,
} from '@/scene/accessoryGeometry'
import type { GuideAccessory } from '@/lib/guide'
import { detectWebGL } from '@/lib/webgl'
import { formatMm, mToMm } from '@/lib/units'
import { Badge } from '@/ui/kit/badge'
import { Button } from '@/ui/kit/button'
import { DataBadge } from '@/ui/kit/data-badge'
import { MmInput } from '@/ui/kit/mm-input'
import { Segmented } from '@/ui/kit/segmented'

/**
 * 配件参数预览面板：
 * - 输入线径 / 容纳数量 / 桌板厚度或立柱截面，实时生成参数化几何预览；
 * - 明确标注「外观预览 vs 可打印几何体」；GLB 导出已实现，STL 未接入（禁用 + 标注）；
 * - 方案建议数量来自交付页的本地估算（@/lib/guide.ts buildAccessories）。
 */

function formatSpecValue(spec: AccessorySpec): string {
  if (spec.text) return spec.text
  if (spec.valueM !== undefined) {
    return spec.valueM < 0.01 ? `${mToMm(spec.valueM).toFixed(1)} mm` : formatMm(spec.valueM)
  }
  return '—'
}

function AccessoryPreview({ params }: { params: AccessoryParams }) {
  const group = useMemo(() => buildAccessoryGroup(params), [params])
  useEffect(() => () => disposeAccessoryGroup(group), [group])
  const webglOk = useMemo(detectWebGL, [])

  if (!webglOk) {
    return (
      <div className="flex h-56 items-center justify-center rounded-md border border-dashed border-border bg-muted/30 px-6 text-center text-xs leading-relaxed text-muted-foreground print:hidden">
        当前环境不支持 WebGL，无法显示参数化几何预览；规格数值仍可正常计算与导出。
      </div>
    )
  }

  return (
    <div className="h-56 overflow-hidden rounded-md border border-border bg-[#F3F1EC] print:hidden">
      <Canvas dpr={[1, 1.75]} camera={{ position: [0.14, 0.11, 0.18], fov: 42 }}>
        <color attach="background" args={['#F3F1EC']} />
        <ambientLight intensity={0.7} />
        <hemisphereLight args={['#FFF8EC', '#C9BFAC', 0.5]} />
        <directionalLight position={[0.3, 0.5, 0.45]} intensity={1.2} />
        <directionalLight position={[-0.35, 0.2, -0.3]} intensity={0.35} />
        <primitive object={group} dispose={null} />
        <OrbitControls
          makeDefault
          enablePan={false}
          autoRotate
          autoRotateSpeed={1.6}
          minDistance={0.07}
          maxDistance={0.6}
          target={[0, -0.005, 0.01]}
        />
      </Canvas>
    </div>
  )
}

export function AccessoryPanel({
  project,
  params,
  accessories,
  onChange,
}: {
  project: Project
  params: AccessoryParams
  accessories: GuideAccessory[]
  onChange: (patch: Partial<AccessoryParams>) => void
}) {
  const [exporting, setExporting] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const specs = useMemo(() => accessoryDimSpecs(params), [params])
  const suggestion = accessories.find(
    (a) => a.id === (params.kind === 'desk-clip' ? 'clip' : 'hook'),
  )

  const clampCapacity = (n: number) =>
    Math.min(ACCESSORY_LIMITS.capacity.max, Math.max(ACCESSORY_LIMITS.capacity.min, Math.round(n)))

  const resetToRoom = () => {
    if (params.kind === 'desk-clip') onChange({ deskThickness: project.room.desk.thickness })
    else onChange({ postSection: project.room.posts[0]?.section ?? 0.04 })
  }

  const handleExportGlb = async () => {
    setExporting(true)
    setMessage(null)
    try {
      const buffer = await exportAccessoryToGlb(params)
      const blob = new Blob([buffer], { type: 'model/gltf-binary' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${ACCESSORY_KIND_LABELS[params.kind]}-外观预览.glb`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1500)
      setMessage({ tone: 'ok', text: '已导出 GLB：外观预览模型（非打印级几何）' })
    } catch (error) {
      setMessage({
        tone: 'error',
        text: `GLB 导出失败：${error instanceof Error ? error.message : '未知错误'}`,
      })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented<AccessoryKind>
          size="sm"
          value={params.kind}
          onChange={(kind) => onChange({ kind })}
          options={[
            { value: 'desk-clip', label: ACCESSORY_KIND_LABELS['desk-clip'] },
            { value: 'post-hook', label: ACCESSORY_KIND_LABELS['post-hook'] },
          ]}
        />
        <Badge variant="primary">外观预览</Badge>
        {suggestion ? (
          <span className="text-xs text-muted-foreground">
            方案建议：
            <span className="font-semibold tabular-nums text-foreground">×{suggestion.count}</span>
            （本地估算，见配件清单）
          </span>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">线径（单根线缆外径）</label>
            <MmInput
              className="mt-1"
              value={params.cableDiameter}
              min={mToMm(ACCESSORY_LIMITS.cableDiameter.min)}
              max={mToMm(ACCESSORY_LIMITS.cableDiameter.max)}
              onChange={(v) => onChange({ cableDiameter: v })}
            />
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">容纳线缆数量</span>
            <div className="flex items-center gap-1.5">
              <Button
                size="icon"
                variant="outline"
                aria-label="减少数量"
                disabled={params.capacity <= ACCESSORY_LIMITS.capacity.min}
                onClick={() => onChange({ capacity: clampCapacity(params.capacity - 1) })}
              >
                <Minus className="h-3.5 w-3.5" />
              </Button>
              <span className="w-8 text-center text-sm font-semibold tabular-nums">
                {params.capacity}
              </span>
              <Button
                size="icon"
                variant="outline"
                aria-label="增加数量"
                disabled={params.capacity >= ACCESSORY_LIMITS.capacity.max}
                onClick={() => onChange({ capacity: clampCapacity(params.capacity + 1) })}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs text-muted-foreground">
                {params.kind === 'desk-clip' ? '桌板厚度' : '立柱截面边长'}
              </label>
              <button
                type="button"
                onClick={resetToRoom}
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <RotateCcw className="h-3 w-3" />
                按桌体尺寸
              </button>
            </div>
            {params.kind === 'desk-clip' ? (
              <MmInput
                className="mt-1"
                value={params.deskThickness}
                min={mToMm(ACCESSORY_LIMITS.deskThickness.min)}
                max={mToMm(ACCESSORY_LIMITS.deskThickness.max)}
                onChange={(v) => onChange({ deskThickness: v })}
              />
            ) : (
              <MmInput
                className="mt-1"
                value={params.postSection}
                min={mToMm(ACCESSORY_LIMITS.postSection.min)}
                max={mToMm(ACCESSORY_LIMITS.postSection.max)}
                onChange={(v) => onChange({ postSection: v })}
              />
            )}
          </div>

          <dl className="space-y-1.5 rounded-md border border-border bg-muted/30 p-3 text-[13px]">
            {specs.map((spec) => (
              <div key={spec.label} className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">{spec.label}</dt>
                <dd className="tabular-nums">{formatSpecValue(spec)}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="space-y-3">
          <AccessoryPreview params={params} />
          <div className="space-y-2 rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={handleExportGlb} disabled={exporting}>
                <Download className="h-3.5 w-3.5" />
                {exporting ? '导出中…' : '导出 GLB'}
              </Button>
              {ACCESSORY_CAPABILITY.glbExport ? null : <DataBadge kind="unavailable" />}
              <span className="inline-flex items-center gap-1.5">
                <Button size="sm" variant="outline" disabled title={ACCESSORY_NOTES.stl}>
                  导出 STL
                </Button>
                {ACCESSORY_CAPABILITY.stlExport ? null : <DataBadge kind="unavailable" />}
              </span>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {ACCESSORY_NOTES.appearance}
            </p>
            <p className="text-xs leading-relaxed text-faint">
              {ACCESSORY_NOTES.glb}
              {ACCESSORY_NOTES.stl}
            </p>
            {message ? (
              <p className={message.tone === 'ok' ? 'text-xs text-success' : 'text-xs text-danger'}>
                {message.text}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
