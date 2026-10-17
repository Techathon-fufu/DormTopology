import { useState } from 'react'
import type { Project, CableConnection } from '@/types/project'
import { CABLE_KIND_META } from '@/types/project'
import { endpointLabel } from '@/scene/cables'
import { usePlansStore } from '@/state/plansStore'
import { useOrganizeStore } from '@/state/organizeStore'
import { useCableStore } from '@/state/cableStore'
import {
  useRoutingPreviewStore,
  acceptRoutingPreview,
  isValidRoute,
  candidateFreshness,
  type RoutingCandidate,
} from './routingPreview'

/**
 * 走线候选预览面板：
 * - 只展示与当前项目匹配的候选；
 * - 计算过期（签名 + 基线）、有效 / 失败数量；
 * - 每条线缆显示端点标签、成功路径长度与预留（或实际失败原因）；
 * - 全场景未选中项仅在此说明，不做整场景传输；
 * - 接受 / 丢弃按钮；错误用 role="alert" 提示，不伪造成功。
 */

export function RoutingPreviewPanel({ project }: { project: Project }) {
  const candidate = useRoutingPreviewStore((s) => s.candidate)
  const discard = useRoutingPreviewStore((s) => s.discard)
  const applying = useOrganizeStore((s) => s.applying)
  const hasOrganizePlan = useOrganizeStore((s) => s.plan !== null)
  const setNotice = useCableStore((s) => s.setNotice)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [accepted, setAccepted] = useState(false)

  const matching = candidate && candidate.projectId === project.id ? candidate : null
  usePlansStore(s => s.baselines[project.id]?.id)
  const stale = matching ? candidateFreshness(matching, project) === 'stale' : false

  if (!matching) return null

  const { result, validation } = matching
  const organizeBlocked = applying || hasOrganizePlan
  const canAccept = !stale && validation.validCount > 0 && !organizeBlocked && !busy

  const handleAccept = async () => {
    if (!canAccept) return
    setError(null)
    setBusy(true)
    try {
      const summary = await acceptRoutingPreview(project, matching.baselineId)
      setAccepted(true)
      setNotice(
        `已接受理线方案：应用 ${summary.applied} 条有效路径` +
          `${summary.skipped > 0 ? `，${summary.skipped} 条失败线路保持原状（需重新规划）` : ''}` +
          '（可撤销）。仅保存到本机；当前接口尚不提供方案应用到服务端。',
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : '接受理线方案失败。')
    } finally {
      setBusy(false)
    }
  }

  const handleDiscard = () => {
    setError(null)
    setAccepted(false)
    discard()
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface/95 p-3 text-xs shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">理线方案预览（本地）</span>
        <span className="text-muted-foreground">
          有效 {validation.validCount} · 失败 {validation.failedCount}
        </span>
      </div>

      <p className="text-[11px] leading-snug text-muted-foreground">
        接受后只应用有效路径，失败线路保持原状；结果保存到本机，当前接口尚不提供方案应用到服务端。
      </p>

      {stale ? (
        <p className="text-[11px] leading-snug text-warning">
          项目内容或整理前基线已变化，预览已过期，请重新规划。
        </p>
      ) : null}

      {organizeBlocked ? (
        <p className="text-[11px] leading-snug text-warning">
          整理预览或应用进行中，暂不能接受理线方案。
        </p>
      ) : null}

      {result.warnings && result.warnings.length > 0 ? (
        <ul className="list-disc pl-4 text-[11px] leading-snug text-warning">
          {result.warnings.slice(0, 4).map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      ) : null}

      {result.notes && result.notes.length > 0 ? (
        <ul className="list-disc pl-4 text-[11px] leading-snug text-muted-foreground">
          {result.notes.slice(0, 4).map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      ) : null}

      <ul className="flex flex-col gap-1">
        {result.cables.map((cable) => (
          <RoutingPreviewLine key={cable.id} cable={cable} project={project} />
        ))}
      </ul>

      <p className="text-[11px] leading-snug text-muted-foreground">
        已提交全场物品与全部已确认连接；虚线为待接受的建议路径。
      </p>

      {error ? (
        <p role="alert" className="text-[11px] leading-snug text-danger">
          {error}
        </p>
      ) : null}

      {accepted ? (
        <p className="text-[11px] leading-snug text-success">
          理线方案已接受到本机。
        </p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="button"
          className="flex-1 rounded border border-border px-2 py-1 text-[11px] disabled:opacity-50"
          onClick={handleAccept}
          disabled={!canAccept}
        >
          {busy ? '接受中…' : '接受理线方案'}
        </button>
        <button
          type="button"
          className="flex-1 rounded border border-border px-2 py-1 text-[11px]"
          onClick={handleDiscard}
        >
          丢弃理线预览
        </button>
      </div>
    </div>
  )
}

function RoutingPreviewLine({ cable, project }: { cable: CableConnection; project: Project }) {
  const from = endpointLabel(project.objects, cable.from)
  const to = endpointLabel(project.objects, cable.to)
  const kind = CABLE_KIND_META[cable.kind]
  const valid = isValidRoute(cable)
  const reserve = cable.reserveLengthM
  const pathLength = cable.route.pathLengthM

  return (
    <li className="flex flex-col gap-0.5 border-t border-border/50 pt-1 first:border-t-0 first:pt-0">
      <div className="flex items-center gap-1">
        <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: kind.color }} />
        <span className="font-medium">{from.objectName} · {from.portLabel} → {to.objectName} · {to.portLabel}</span>
        <span className="text-muted-foreground">
          {valid ? '有效' : '失败'}
        </span>
      </div>
      {valid ? (
        <span className="text-[11px] leading-snug text-muted-foreground">
          路径长度 {typeof pathLength === 'number' ? pathLength.toFixed(3) : '—'} m
          {`，所需备线 ${((pathLength ?? 0) + (reserve ?? 0)).toFixed(3)} m（含预留）`}
        </span>
      ) : (
        <span className="text-[11px] leading-snug text-danger">
          {cable.note ?? '真实算法未给出可用路径。'}
        </span>
      )}
    </li>
  )
}

export type { RoutingCandidate }
