import type { CableKind, ObjectCategory, Project } from '@/types/project'
import { ACCESSORY_LABELS, CABLE_CHANNEL_LABELS, CABLE_KIND_META } from '@/types/project'
import { cableDisplayPoints } from '@/scene/cables'
import { estimateCableLength } from '@/scene/cableRoute'
import { formatMeters, mToMm } from '@/lib/units'

export interface GuideStep {
  title: string
  detail: string
}

export interface CableStep {
  id: string
  kind: CableKind
  kindLabel: string
  fromLabel: string
  toLabel: string
  lengthText: string
  channelsText: string
  accessoriesText?: string
}

export interface AccessorySuggestion {
  label: string
  count: number
  reason: string
}

function namesOf(project: Project, category: ObjectCategory): string {
  return project.objects
    .filter((o) => o.category === category)
    .map((o) => o.name)
    .slice(0, 4)
    .join('、')
}

/**
 * 整理步骤：基于当前场景对象的「模板化建议」（演示阶段模板，后续由布局规划服务生成真实步骤）。
 */
export function buildOrganizeSteps(project: Project): GuideStep[] {
  const electrical = namesOf(project, 'electrical')
  const nonElectrical = namesOf(project, 'nonElectrical')
  const storage = namesOf(project, 'storage')
  const hole = project.room.cableHoles[0]

  const steps: GuideStep[] = [
    {
      title: '清空桌面',
      detail: `把桌面上的 ${project.objects.length} 件物品临时移到床面，保留桌下地面排插位置不动。`,
    },
  ]

  if (storage) {
    steps.push({
      title: '收纳容器归位',
      detail: `把「${storage}」放到桌面一侧（前缘留出约 60 mm 通道），作为零碎物品的固定落点。`,
    })
  }

  if (electrical) {
    steps.push({
      title: '大件电气设备靠后',
      detail: `把「${electrical}」贴后墙一侧摆放，屏幕面向座位，为键盘与鼠标留出前排空间。`,
    })
  }

  steps.push({
    title: '常用物品放前排',
    detail: `键盘、鼠标放在显示器前方；注意和桌面前缘保持至少 50 mm，避免悬空掉落。`,
  })

  if (nonElectrical) {
    steps.push({
      title: '非电气物品靠边',
      detail: `把「${nonElectrical}」放在桌面左前方或书架层，远离插排与电源接口（防泼溅）。`,
    })
  }

  steps.push({
    title: '预留走线通道',
    detail: hole
      ? `出线孔（直径 ${Math.round(mToMm(hole.diameter))} mm）与桌后缘保持通畅，不要把物品压在走线通道上。`
      : '桌后缘预留约 40 mm 走线通道，不要把物品紧贴后缘。',
  })

  return steps
}

export function buildCableSteps(project: Project): CableStep[] {
  const byId = new Map(project.objects.map((o) => [o.id, o]))
  return project.cables.map((cable) => {
    const from = byId.get(cable.from.objectId)?.name ?? '未知设备'
    const to = byId.get(cable.to.objectId)?.name ?? '未知设备'
    const accessoriesText = cable.accessories
      .map((a) => `${ACCESSORY_LABELS[a.type]} ×${a.count}`)
      .join(' + ')
    return {
      id: cable.id,
      kind: cable.kind,
      kindLabel: CABLE_KIND_META[cable.kind].label,
      fromLabel: from,
      toLabel: to,
      lengthText: formatMeters(estimateCableLength(cableDisplayPoints(cable, project.objects, 'suggested'))),
      channelsText: cable.route.channels.map((ch) => CABLE_CHANNEL_LABELS[ch]).join(' → '),
      accessoriesText: accessoriesText || undefined,
    }
  })
}

/**
 * 配件建议：数量由本地规则计算（计算值），品类为演示阶段固定建议（标注「模拟建议」）。
 */
export function buildAccessories(project: Project): AccessorySuggestion[] {
  const cableCount = project.cables.length
  const clipsFromPlan = project.cables.reduce(
    (sum, c) => sum + (c.accessories.find((a) => a.type === 'clip')?.count ?? 0),
    0,
  )
  const clips = clipsFromPlan > 0 ? clipsFromPlan : Math.max(6, cableCount * 3)

  const suggestions: AccessorySuggestion[] = [
    {
      label: ACCESSORY_LABELS.clip,
      count: clips,
      reason: '沿桌底与立柱每约 300 mm 固定一处，防止线缆下垂晃动（由当前线缆长度估算）。',
    },
    {
      label: ACCESSORY_LABELS.velcro,
      count: Math.max(2, cableCount),
      reason: '收束并线处使用，方便日后增减小设备（按线缆条数建议）。',
    },
  ]
  if (project.cables.length >= 3) {
    suggestions.push({
      label: ACCESSORY_LABELS.tray,
      count: 1,
      reason: '线缆 ≥3 条时建议桌底加装理线槽，长期更整洁（演示阶段固定建议）。',
    })
  }
  return suggestions
}

export function totalCableLength(project: Project): number {
  return project.cables.reduce(
    (sum, c) => sum + estimateCableLength(cableDisplayPoints(c, project.objects, 'suggested')),
    0,
  )
}
