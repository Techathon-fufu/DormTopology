import { useEffect, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Check, ChevronLeft, ChevronRight, RotateCcw, Sparkles, X } from 'lucide-react'
import { useProject } from '@/state/projectsStore'
import { DEMO_TOUR_STEPS, useTourStore } from '@/state/tourStore'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/kit/button'
import { DataBadge } from '@/ui/kit/data-badge'
import { FastForwardToggle } from '@/ui/kit/fast-forward'

/**
 * 「一键演示」导览卡片：
 * - 固定 6 步（查看凌乱桌面 → 确认识别物品 → 自动整理 → 规划走线 → 对比前后 → 查看执行指南）；
 * - 步骤切换时自动导航到对应页面；完成后打勾（点击「下一步」即视为完成，演示可跳过）；
 * - 「重置并重播」重新种入示例项目并清空关联状态，可重复播放；
 * - 卡片常驻「演示模式」标识；核心流程全部本地模拟，不依赖实时外部 API。
 */
export function DemoTour({ className }: { className?: string }) {
  const navigate = useNavigate()
  const location = useLocation()

  const active = useTourStore((s) => s.active)
  const tourProjectId = useTourStore((s) => s.projectId)
  const stepIndex = useTourStore((s) => s.stepIndex)
  const done = useTourStore((s) => s.done)

  const project = useProject(tourProjectId ?? undefined)
  const step = DEMO_TOUR_STEPS[Math.min(stepIndex, DEMO_TOUR_STEPS.length - 1)]

  // 数据可推导步骤的完成度兜底检测（例：全部线缆已由演示规则规划）
  const detected = useMemo(() => {
    const out: Record<string, boolean> = {}
    if (
      project &&
      project.cables.length > 0 &&
      project.cables.every((c) => c.planSource === 'demo-rule')
    ) {
      out.cables = true
    }
    return out
  }, [project])

  const isDone = (id: string) => Boolean(done[id] || detected[id])
  const doneCount = DEMO_TOUR_STEPS.filter((s) => isDone(s.id)).length
  const allDone = doneCount === DEMO_TOUR_STEPS.length
  const lastStep = stepIndex === DEMO_TOUR_STEPS.length - 1

  // 跟随步骤自动导航（只在步骤 / 激活状态变化时触发，不干扰用户主动跳去其它页面）
  useEffect(() => {
    if (!active || !tourProjectId) return
    const target = `/projects/${tourProjectId}/${DEMO_TOUR_STEPS[stepIndex]?.path ?? 'workspace'}`
    if (location.pathname !== target) navigate(target)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, tourProjectId, stepIndex, navigate])

  if (!active || !step) return null

  const restart = () => {
    useTourStore.getState().reset()
    navigate(`/projects/${tourProjectId ?? ''}/workspace`)
  }

  return (
    <aside
      aria-label="演示导览"
      className={cn(
        'fixed bottom-4 right-4 z-40 w-[340px] max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-surface/95 shadow-lg backdrop-blur print:hidden',
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Sparkles className="h-4 w-4 shrink-0 text-primary" />
        <span className="text-[13px] font-semibold">演示导览</span>
        <DataBadge kind="demo" label="演示模式" />
        <span className="ml-auto text-[11px] tabular-nums text-faint">
          {Math.min(stepIndex + 1, DEMO_TOUR_STEPS.length)}/{DEMO_TOUR_STEPS.length} · 已完成{' '}
          {doneCount}
        </span>
        <button
          type="button"
          title="退出导览（不重置数据）"
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          onClick={() => useTourStore.getState().exit()}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {!project ? (
        <div className="space-y-2 px-3 py-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            示例项目不存在或已被删除。可重置回内置示例项目继续演示。
          </p>
          <Button size="sm" onClick={restart}>
            <RotateCcw className="h-3.5 w-3.5" />
            重置并重播
          </Button>
        </div>
      ) : (
        <>
          <div className="space-y-2 px-3 py-2.5">
            <ol className="flex flex-wrap gap-1">
              {DEMO_TOUR_STEPS.map((s, i) => {
                const current = i === stepIndex
                const complete = isDone(s.id)
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      title={`${i + 1}. ${s.title}`}
                      onClick={() => useTourStore.getState().goTo(i)}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                        current
                          ? 'border-primary/50 bg-primary-soft font-medium text-primary'
                          : complete
                            ? 'border-success/40 text-success hover:bg-success/10'
                            : 'border-border text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {complete && !current ? (
                        <Check className="h-3 w-3" />
                      ) : (
                        <span className="tabular-nums">{i + 1}</span>
                      )}
                      <span className="max-w-[96px] truncate">{s.title}</span>
                    </button>
                  </li>
                )
              })}
            </ol>

            <div className="rounded-md border border-border bg-muted/40 px-2.5 py-2">
              <p className="text-[13px] font-medium">
                {step.title}
                {isDone(step.id) ? <span className="ml-1.5 text-[11px] text-success">已完成 ✓</span> : null}
              </p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{step.hint}</p>
            </div>

            {allDone ? (
              <p className="rounded-md bg-success/10 px-2.5 py-1.5 text-[12px] text-success">
                演示完成 🎉 可「重置并重播」再走一遍，或退出继续自由探索。
              </p>
            ) : null}
          </div>

          <div className="flex items-center gap-1.5 border-t border-border px-3 py-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[12px]"
              disabled={stepIndex === 0}
              onClick={() => useTourStore.getState().prev()}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              上一步
            </Button>
            {!allDone ? (
              <Button size="sm" className="h-7 flex-1 text-[12px]" onClick={() => useTourStore.getState().next()}>
                {lastStep ? '完成演示' : '下一步'}
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button size="sm" className="h-7 flex-1 text-[12px]" onClick={restart}>
                <RotateCcw className="h-3.5 w-3.5" />
                重置并重播
              </Button>
            )}
          </div>

          <div className="flex items-center justify-between gap-1.5 border-t border-border px-3 py-1.5">
            {!allDone ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px]"
                onClick={restart}
                title="重置示例项目数据并回到第一步"
              >
                <RotateCcw className="h-3 w-3" />
                重置并重播
              </Button>
            ) : (
              <span className="text-[11px] text-faint">导览结束</span>
            )}
            <FastForwardToggle compact />
          </div>
        </>
      )}
    </aside>
  )
}
