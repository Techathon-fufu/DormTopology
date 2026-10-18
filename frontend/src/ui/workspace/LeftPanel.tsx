import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  Box,
  Eye,
  EyeOff,
  Lock,
  LockOpen,
  Pin,
  Plus,
  Search,
  Star,
  Upload,
  X,
} from 'lucide-react'
import type { ObjectCategory, Project, SceneObject } from '@/types/project'
import { CATEGORY_LABELS, CATEGORY_ORDER, MODEL_STATUS_LABELS } from '@/types/project'
import type { SceneIssue } from '@/scene/sceneValidation'
import { createDemoSceneObjects } from '@/data/demoProject'
import { initialDeskPlacement } from '@/scene/geometry'
import { cn, uid } from '@/lib/utils'
import { useOrganizeStore } from '@/state/organizeStore'
import { useWorkspaceStore } from '@/state/workspaceStore'
import { Button } from '@/ui/kit/button'
import { EmptyState } from '@/ui/kit/empty-state'
import { Input } from '@/ui/kit/primitives'
import { ObjectIcon } from './objectIcons'

const STATUS_DOT: Record<SceneObject['model']['status'], string> = {
  none: '#C7C3BA',
  generating: '#0F9D8A',
  placeholder: '#D97706',
  ready: '#2F9E63',
  failed: '#D64545',
}

const CATEGORY_FILTERS: Array<ObjectCategory | 'all'> = ['all', ...CATEGORY_ORDER]

function ItemRow({
  project,
  object,
  issues,
  onAfterSelect,
}: {
  project: Project
  object: SceneObject
  issues?: SceneIssue[]
  onAfterSelect?: () => void
}) {
  const previewBlocking = useOrganizeStore((s) => s.isPreviewBlocking())
  const selectedId = useWorkspaceStore((s) => s.selectedId)
  const select = useWorkspaceStore((s) => s.select)
  const updateObject = useWorkspaceStore((s) => s.updateObject)
  const selected = selectedId === object.id
  const hasIssues = (issues?.length ?? 0) > 0

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => {
        select(object.id)
        onAfterSelect?.()
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          select(object.id)
          onAfterSelect?.()
        }
      }}
      title={hasIssues ? issues!.map((i) => i.message).join('\n') : undefined}
      className={cn(
        'group relative flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors',
        selected ? 'bg-primary-soft' : 'hover:bg-muted',
        !object.visible && 'opacity-55',
      )}
    >
      <span className={cn('shrink-0', selected ? 'text-primary' : 'text-muted-foreground')}>
        <ObjectIcon shape={object.model.shape} category={object.category} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5">
          <span className={cn('truncate text-[13px]', selected && 'font-medium text-primary')}>
            {object.name}
          </span>
          {object.quantity > 1 ? (
            <span className="text-[11px] tabular-nums text-faint">×{object.quantity}</span>
          ) : null}
          {object.fixed ? (
            <span title="固定摆放（整理方案中保持位置）" className="shrink-0 text-faint">
              <Pin className="h-3 w-3" />
            </span>
          ) : null}
          {object.frequent ? (
            <span title="常用物品（空间整理时优先放在易取位置）" className="shrink-0 text-warning">
              <Star className="h-3 w-3 fill-current" />
            </span>
          ) : null}
          {hasIssues ? (
            <span title={issues!.map((i) => i.message).join('\n')} className="shrink-0 text-warning">
              <AlertTriangle className="h-3 w-3" />
            </span>
          ) : null}
        </span>
        {!object.visible ? (
          <span className="text-[11px] text-faint">已隐藏（点击眼睛图标恢复）</span>
        ) : object.locked ? (
          <span className="text-[11px] text-warning">已锁定位置（禁止拖拽 / 旋转）</span>
        ) : object.source === 'recognized' && object.recognition ? (
          <span className="text-[11px] text-faint">
            识别置信度 {Math.round(object.recognition.confidence * 100)}%
          </span>
        ) : null}
      </span>

      {/* 显示 / 隐藏、锁定按钮（悬停显现；处于隐藏 / 锁定状态时始终可见） */}
      <span className="absolute right-4 top-1/2 flex -translate-y-1/2 items-center gap-0.5 rounded-md bg-surface opacity-0 shadow-xs transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <button
          type="button"
          disabled={previewBlocking}
          title={object.visible ? '隐藏物品（保留在列表中）' : '恢复显示'}
          className={cn(
            'rounded p-0.5 hover:bg-muted hover:text-foreground',
            object.visible
              ? 'text-muted-foreground'
              : 'text-warning',
          )}
          onClick={(e) => {
            e.stopPropagation()
            updateObject(project.id, object.id, { visible: !object.visible }, false)
          }}
        >
          {object.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          disabled={previewBlocking}
          title={object.locked ? '解锁位置（解锁后可拖拽 / 旋转）' : '锁定位置（禁止拖拽 / 旋转）'}
          className={cn(
            'rounded p-0.5 hover:bg-muted hover:text-foreground',
            object.locked
              ? 'text-warning'
              : 'text-muted-foreground',
          )}
          onClick={(e) => {
            e.stopPropagation()
            updateObject(project.id, object.id, { locked: !object.locked }, false)
          }}
        >
          {object.locked ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
        </button>
      </span>

      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ background: STATUS_DOT[object.model.status] }}
        title={`模型状态：${MODEL_STATUS_LABELS[object.model.status]}`}
      />
    </div>
  )
}

/**
 * 左侧物品面板：搜索 / 分类筛选 / 逐项显示隐藏与锁定 / 校验警示，
 * 作为工作台左侧停靠面板使用。
 */
export function LeftPanel({
  project,
  issuesById,
  className,
  onClose,
  onAfterSelect,
}: {
  project: Project
  issuesById: Map<string, SceneIssue[]>
  className?: string
  onClose?: () => void
  onAfterSelect?: () => void
}) {
  const previewBlocking = useOrganizeStore((s) => s.isPreviewBlocking())
  const navigate = useNavigate()
  const replaceObjects = useWorkspaceStore((s) => s.replaceObjects)
  const addObject = useWorkspaceStore((s) => s.addObject)
  const updateObject = useWorkspaceStore((s) => s.updateObject)

  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<ObjectCategory | 'all'>('all')

  const hiddenCount = project.objects.filter((o) => !o.visible).length
  const lockedCount = project.objects.filter((o) => o.locked).length
  const q = query.trim().toLowerCase()
  const filtered = project.objects.filter(
    (o) =>
      (category === 'all' || o.category === category) &&
      (q === '' || o.name.toLowerCase().includes(q)),
  )

  const loadDemoObjects = () => {
    if (useOrganizeStore.getState().isPreviewBlocking()) return
    const existingNames = new Set(project.objects.map((o) => o.name))
    const fresh = createDemoSceneObjects(project.id).filter((o) => !existingNames.has(o.name))
    if (fresh.length === 0) return
    replaceObjects(project.id, [...project.objects, ...fresh])
  }

  const addCustomObject = () => {
    if (useOrganizeStore.getState().isPreviewBlocking()) return
    const n = project.objects.filter((o) => o.name.startsWith('自定义物品')).length + 1
    addObject(project.id, {
      id: uid('obj'),
      projectId: project.id,
      name: `自定义物品 ${n}`,
      category: 'nonElectrical',
      dimensions: { width: 0.15, height: 0.1, depth: 0.1 },
      transform: {
        position: initialDeskPlacement(project.objects.length, project.room),
        rotationY: 0,
      },
      model: { status: 'none', source: 'demo', format: 'placeholder-box', shape: 'genericBox' },
      ports: [],
      quantity: 1,
      needsPower: false,
      fixed: false,
      locked: false,
      frequent: false,
      visible: true,
      source: 'manual',
    })
  }

  const restoreAll = () => {
    if (useOrganizeStore.getState().isPreviewBlocking()) return
    for (const o of project.objects) {
      if (!o.visible) updateObject(project.id, o.id, { visible: true }, false)
    }
  }

  return (
    <aside className={cn('flex min-h-0 flex-col border-border bg-surface', className)}>
      <div className="flex items-center justify-between px-3 pb-2 pt-3">
        <h2 className="text-sm font-semibold">场景物体</h2>
        <span className="flex items-center gap-2 text-[11px] tabular-nums text-faint">
          {project.objects.length} 件{hiddenCount > 0 ? `（隐藏 ${hiddenCount}）` : ''}
          {onClose ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              title="关闭面板"
              onClick={onClose}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </span>
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-1.5 px-3 pb-2">
        <Button variant="outline" size="sm" className="flex-1" disabled={previewBlocking} onClick={loadDemoObjects}>
          <Upload className="h-3.5 w-3.5" />
          示例物品库
        </Button>
        <Button variant="outline" size="sm" title="添加自定义物品" aria-label="添加物体" disabled={previewBlocking} onClick={addCustomObject}>
          <Plus className="h-4 w-4" />添加
        </Button>
      </div>

      <div className="px-3 pb-1.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索物品名称…"
            className="h-8 pl-7 text-[13px]"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1 px-3 pb-2">
        {CATEGORY_FILTERS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCategory(c)}
            className={cn(
              'min-h-7 rounded-full border px-2 py-0.5 text-xs transition-colors',
              category === c
                ? 'border-primary bg-primary-soft font-medium text-primary'
                : 'border-border text-muted-foreground hover:bg-muted',
            )}
          >
            {c === 'all' ? '全部' : CATEGORY_LABELS[c]}
          </button>
        ))}
      </div>

      {hiddenCount > 0 || lockedCount > 0 ? (
        <div className="flex items-center gap-3 px-3 pb-2 text-[11px]">
          {hiddenCount > 0 ? (
            <button type="button" disabled={previewBlocking} onClick={restoreAll} className="text-primary hover:underline">
              恢复全部显示（{hiddenCount}）
            </button>
          ) : null}
          {lockedCount > 0 ? (
            <span className="text-faint">已锁定 {lockedCount} 件（拖拽与旋转被禁用）</span>
          ) : null}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {project.objects.length === 0 ? (
          <EmptyState
            className="mx-1 mt-2"
            icon={<Box />}
            title="暂无物品"
            description="可在照片导入页运行识别，或载入示例物品库快速体验整理流程。"
            action={
              <>
                <Button size="sm" onClick={loadDemoObjects}>
                  载入示例物品库
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/projects/${project.id}/import`)}
                >
                  前往照片导入
                </Button>
              </>
            }
          />
        ) : filtered.length === 0 ? (
          <p className="px-2 pt-6 text-center text-xs text-faint">没有匹配的物品</p>
        ) : (
          CATEGORY_ORDER.map((cat) => {
            const items = filtered.filter((o) => o.category === cat)
            if (items.length === 0) return null
            return (
              <section key={cat}>
                <h3 className="px-2 pb-1 pt-3 text-[11px] font-medium text-faint">
                  {CATEGORY_LABELS[cat]} · {items.length}
                </h3>
                <div className="space-y-0.5">
                  {items.map((o) => (
                    <ItemRow
                      key={o.id}
                      project={project}
                      object={o}
                      issues={issuesById.get(o.id)}
                      onAfterSelect={onAfterSelect}
                    />
                  ))}
                </div>
              </section>
            )
          })
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-3 py-2 text-[11px] text-faint">
        <span>模型状态</span>
        {(['none', 'placeholder', 'failed'] as const).map((s) => (
          <span key={s} className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ background: STATUS_DOT[s] }} />
            {MODEL_STATUS_LABELS[s]}
          </span>
        ))}
      </div>
    </aside>
  )
}
