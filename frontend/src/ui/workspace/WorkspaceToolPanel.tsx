import { useEffect, useState } from 'react'
import { Box, Cable, Image as ImageIcon, X } from 'lucide-react'
import type { Project, SceneObject } from '@/types/project'
import type { SceneIssue } from '@/scene/sceneValidation'
import { cn } from '@/lib/utils'
import { useOrganizeStore } from '@/state/organizeStore'
import { useWorkspaceStore, type WorkspaceMode } from '@/state/workspaceStore'
import { useCableStore } from '@/state/cableStore'
import { Button } from '@/ui/kit/button'
import { LeftPanel } from './LeftPanel'
import { RightPanel } from './RightPanel'
import { CablePanel } from './CablePanel'
import { CableListPanel } from './CableListPanel'
import { PhotoModelDraft } from './PhotoModelDraft'

/**
 * 工作台左侧工具栏面板：
 * - 顶部「物体 / 连线」模式切换（整理预览中禁用进入连线）；
 * - 物体模式：物品清单（LeftPanel）与属性面板（RightPanel），可选照片生成模型草稿视图；
 * - 连线模式：线缆列表（CableListPanel）与线缆属性（CablePanel）。
 * 仅组合既有面板，不新增领域行为。
 */
export function WorkspaceToolPanel({
  project,
  issuesById,
  routingConfirmed,
  onConfirmRouting,
  busy,
  onPlanCables,
  onOpenMarking,
  onFlash,
  onGenerateModel,
  className,
  onClose,
}: {
  project: Project
  issuesById: Map<string, SceneIssue[]>
  routingConfirmed: boolean
  onConfirmRouting: (confirmed: boolean) => void
  busy: boolean
  onPlanCables: (targetIds?: string[]) => void
  /** 打开表面描点页面（连线模式与手机端入口；桌面也可右键物品） */
  onOpenMarking?: () => void
  onFlash: (msg: string) => void
  onGenerateModel: (object: SceneObject) => void
  className?: string
  onClose?: () => void
}) {
  const mode = useWorkspaceStore((s) => s.mode)
  const setMode = useWorkspaceStore((s) => s.setMode)
  const selectedId = useWorkspaceStore((s) => s.selectedId)
  const select = useWorkspaceStore((s) => s.select)
  const selectedCableId = useCableStore((s) => s.selectedCableId)
  const selectCable = useCableStore((s) => s.selectCable)
  const previewBlocking = useOrganizeStore((s) => s.isPreviewBlocking())

  const [photoOpen, setPhotoOpen] = useState(false)

  // 项目切换时重置照片草稿视图
  useEffect(() => {
    setPhotoOpen(false)
  }, [project.id])

  const selectMode = (next: WorkspaceMode) => {
    if (next === 'cable' && previewBlocking) return
    setMode(next)
  }

  const tabs: { value: WorkspaceMode; label: string; icon: typeof Box }[] = [
    { value: 'organize', label: '物体', icon: Box },
    { value: 'cable', label: '连线', icon: Cable },
  ]

  return (
    <aside aria-label="物体与连线"
      className={cn(
        'flex min-h-0 flex-col border-border bg-surface',
        className,
      )}
    >
      <header className="border-b border-border p-3">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">物体与连线</h2>
          {onClose ? <Button variant="ghost" size="icon" aria-label="关闭物体与连线" onClick={onClose}><X className="h-4 w-4" /></Button> : null}
        </div>
        <div aria-label="工作台工具模式" className="flex rounded-lg bg-muted p-1">
          {tabs.map(({ value, label, icon: Icon }) => {
            const active = mode === value
            const disabled = value === 'cable' && previewBlocking
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                disabled={disabled}
                title={
                  disabled
                    ? '整理预览进行中，暂时无法切换到连线模式'
                    : undefined
                }
                onClick={() => selectMode(value)}
                className={cn(
                  'inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                  active
                    ? 'bg-primary-soft font-medium text-primary'
                    : 'text-muted-foreground hover:bg-muted',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            )
          })}
        </div>
      </header>

      {mode === 'organize' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {selectedId ? (
            <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[12px]"
                onClick={() => select(null)}
              >
                ← 返回物体清单
              </Button>
            </div>
          ) : null}
          {selectedId ? (
            <RightPanel
              project={project}
              issuesById={issuesById}
              onGenerateModel={onGenerateModel}
              className="min-h-0 flex-1"
            />
          ) : photoOpen ? (
            <PhotoModelDraft disabled={previewBlocking} onClose={() => setPhotoOpen(false)} />
          ) : (
            <>
              <div className="border-b border-border px-3 py-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  disabled={previewBlocking}
                  onClick={() => setPhotoOpen(true)}
                >
                  <ImageIcon className="h-3.5 w-3.5" />
                  照片生成模型
                </Button>
              </div>
              <LeftPanel
                project={project}
                issuesById={issuesById}
                className="min-h-0 flex-1"
              />
            </>
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {selectedCableId ? (
            <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[12px]"
                onClick={() => selectCable(null)}
              >
                ← 返回连线清单
              </Button>
            </div>
          ) : null}
          {selectedCableId ? (
            <CablePanel
              project={project}
              busy={busy}
              onPlanCables={onPlanCables}
              onFlash={onFlash}
              className="min-h-0 flex-1"
              showPlanningActions={false}
            />
          ) : (
            <CableListPanel
              project={project}
              routingConfirmed={routingConfirmed}
              onConfirmRouting={onConfirmRouting}
              busy={busy}
              onPlanCables={onPlanCables}
              onOpenMarking={onOpenMarking}
              onFlash={onFlash}
              className="min-h-0 flex-1"
              showPlanningActions={false}
            />
          )}
        </div>
      )}
    </aside>
  )
}
