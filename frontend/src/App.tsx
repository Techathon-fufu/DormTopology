import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/ui/layout/AppShell'
import { ProjectsPage } from '@/ui/pages/ProjectsPage'
import { NewProjectPage } from '@/ui/pages/NewProjectPage'
import { SpaceSetupPage } from '@/ui/pages/SpaceSetupPage'
import { ImportPage } from '@/ui/pages/ImportPage'
import { WorkspacePage } from '@/ui/pages/WorkspacePage'
import { PlanComparePage } from '@/ui/pages/PlanComparePage'
import { GuidePage } from '@/ui/pages/GuidePage'
import { ApiRuntime } from '@/ui/service/ApiRuntime'
import { AlgorithmLabPage } from '@/algorithm-lab/AlgorithmLabPage'
import { useProjectsStore } from '@/state/projectsStore'

export default function App() {
  const ensureDemo = useProjectsStore((s) => s.ensureDemo)

  useEffect(() => {
    // 内置示例项目：首次启动时写入本地存储，保证任意路由都能访问
    ensureDemo()
  }, [ensureDemo])

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
          <Route path="/projects/:id/guide" element={<GuidePage />} />
        </Route>
        {/* 三维工作台与方案对比为整屏布局，不套 AppShell */}
        <Route path="/projects/:id/workspace" element={<WorkspacePage />} />
        <Route path="/projects/:id/compare" element={<PlanComparePage />} />
        <Route path="/algorithm-lab" element={<AlgorithmLabPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}
