import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProjectsStore } from '@/state/projectsStore'
import { beginProjectCreation, projectCreationPath } from '@/ui/create/projectCreation'
import { PageIntro } from '@/ui/layout/PageIntro'

export function NewProjectPage() {
  const navigate = useNavigate()
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    const state = useProjectsStore.getState()
    const { project, created } = beginProjectCreation(state.projects, state.creationDrafts)
    if (created) state.upsert(project)
    state.markCreationDraft(project.id)
    navigate(projectCreationPath(project), { replace: true })
  }, [navigate])

  return (
    <div className="mx-auto max-w-xl">
      <PageIntro step="创建项目" title="正在打开项目草稿" description="已确认的空间和物品会保存在草稿中，可以随时返回继续。" />
    </div>
  )
}
