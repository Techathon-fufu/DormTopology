import { useMemo } from 'react'
import { Line } from '@react-three/drei'
import type { Project, CableConnection } from '@/types/project'
import { CABLE_KIND_META } from '@/types/project'
import { useOrganizeStore } from '@/state/organizeStore'
import { usePlansStore } from '@/state/plansStore'
import { useRoutingPreviewStore, isValidRoute, isCandidateCurrent } from './routingPreview'

/**
 * 走线候选预览层（走线模式下与 CablesLayer 并列挂载）：
 * - 仅在候选与当前项目签名 / 基线一致、且未处于整理预览时渲染；
 * - 仅渲染算法验证通过的有效路径（>= 2 个点，smooth=false，不重新拟合曲线）；
 * - 颜色沿用 CABLE_KIND_META，透明度 0.7；
 * - 指针/射线禁用，无编辑能力；失败路径不绘制。
 */

export function RoutingPreviewLayer({ project }: { project: Project }) {
  const candidate = useRoutingPreviewStore((s) => s.candidate)
  const organizeActive = useOrganizeStore((s) => s.plan !== null || s.applying)

  const baselineId = usePlansStore(s => s.baselines[project.id]?.id)

  const cables = useMemo<CableConnection[]>(() => {
    if (!candidate) return []
    if (candidate.projectId !== project.id) return []
    if (organizeActive || !isCandidateCurrent(candidate,project)) return []
    return candidate.result.cables.filter((cable) => isValidRoute(cable) && cable.route.points.length >= 2)
  }, [candidate, project, organizeActive, baselineId])

  if (cables.length === 0) {
    return null
  }

  return (
    <group raycast={() => null}>
      {cables.map((cable) => (
        <Line
          key={cable.id}
          points={cable.route.points}
          color={CABLE_KIND_META[cable.kind].color}
          lineWidth={2}
          dashed
          dashSize={0.02}
          gapSize={0.012}
          transparent
          opacity={0.7}
          raycast={() => null}
        />
      ))}
    </group>
  )
}
