import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/ui/layout/AppShell'
import { ProjectsPage } from '@/ui/pages/ProjectsPage'
import { NewProjectPage } from '@/ui/pages/NewProjectPage'
import { SpaceSetupPage } from '@/ui/pages/SpaceSetupPage'
import { ImportPage } from '@/ui/pages/ImportPage'
import { WorkspacePage } from '@/ui/pages/WorkspacePage'
import { ResultPage } from '@/ui/pages/ResultPage'
import { ApiRuntime } from '@/ui/service/ApiRuntime'
import { AlgorithmLabPage } from '@/algorithm-lab/AlgorithmLabPage'
import { usePlansStore } from '@/state/plansStore'
import { useProjectsStore } from '@/state/projectsStore'
import { WorkflowPage } from '@/workflow/WorkflowPage'

export default function App() {
  const ensureDemo = useProjectsStore((s) => s.ensureDemo)

  useEffect(() => {
    // 内置示例项目：首次启动时写入本地存储，保证任意路由都能访问
    ensureDemo()
  }, [ensureDemo])

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === 'dormtopology.projects') void useProjectsStore.persist.rehydrate()
      if (event.key === 'dormtopology.plans') void usePlansStore.persist.rehydrate()
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])

  return (
    <>
      {/* 后端健康检查与长任务状态恢复查询。 */}
      <ApiRuntime />
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<ProjectsPage />} />
          <Route path="/projects/new" element={<NewProjectPage />} />
          <Route path="/projects/:id/setup" element={<SpaceSetupPage />} />
          <Route path="/projects/:id/import" element={<ImportPage />} />
        </Route>
        {/* 三维工作台与方案对比为整屏布局，不套 AppShell */}
        <Route path="/projects/:id/result" element={<ResultPage />} />
        <Route path="/projects/:id/guide" element={<ResultPage />} />
        <Route path="/projects/:id/workspace" element={<WorkspacePage />} />
        <Route path="/projects/:id/compare" element={<ResultPage />} />
        <Route path="/algorithm-lab" element={<AlgorithmLabPage />} />
        <Route path="/workflow" element={<WorkflowPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}
