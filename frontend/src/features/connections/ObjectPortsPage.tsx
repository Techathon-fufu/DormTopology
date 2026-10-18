import { useNavigate, useParams } from 'react-router-dom'
import { useProject } from '@/state/projectsStore'
import { Button } from '@/ui/kit/button'
import { EmptyState } from '@/ui/kit/empty-state'
import { MarkingPage } from './MarkingPage'

/** 路由参数只定位物品，查看模型不会写入新的位姿或尺寸。 */
export function ObjectPortsPage() {
  const { id, objectId } = useParams<{ id: string; objectId: string }>()
  const project = useProject(id)
  const navigate = useNavigate()
  const workspace = `/projects/${encodeURIComponent(id ?? '')}/workspace`
  const object = project?.objects.find((entry) => entry.id === objectId)
  if (!project || !object) return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <EmptyState title="物品不存在或已被删除" description="返回工作台，选择需要标记接口的物品。"
        action={<Button onClick={() => navigate(workspace, { replace: true })}>返回工作台</Button>} />
    </div>
  )
  return <MarkingPage
    project={project}
    objectId={object.id}
    onExit={() => navigate(workspace, { replace: true })}
    onObjectChange={(next) => navigate(`/projects/${encodeURIComponent(project.id)}/objects/${encodeURIComponent(next)}/ports`, { replace: true })}
  />
}
