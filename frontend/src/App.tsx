import { useEffect, type ReactNode } from 'react'
import { Navigate, Route, Routes, useParams } from 'react-router-dom'
import { AppShell } from '@/ui/layout/AppShell'
import { ProjectsPage } from '@/ui/pages/ProjectsPage'
import { NewProjectPage } from '@/ui/pages/NewProjectPage'
import { SpaceSetupPage } from '@/ui/pages/SpaceSetupPage'
import { ImportPage } from '@/ui/pages/ImportPage'
import { WorkspacePage } from '@/ui/pages/WorkspacePage'
import { ObjectPortsPage } from '@/features/connections/ObjectPortsPage'
import { ResultPage } from '@/ui/pages/ResultPage'
import { ApiRuntime } from '@/ui/service/ApiRuntime'
import { AlgorithmLabPage } from '@/algorithm-lab/AlgorithmLabPage'
import { usePlansStore } from '@/state/plansStore'
import { useProject, useProjectsStore } from '@/state/projectsStore'
import { WorkflowPage } from '@/workflow/WorkflowPage'
import { RoutingDemoPage } from '@/routing-demo/RoutingDemoPage'
import { projectCreationPath } from '@/ui/create/projectCreation'
import { useAppTheme } from '@/ui/theme/useAppTheme'

/** 执行指南 / 方案对比已由整理动画结果页取代：旧地址按项目重定向，保留兼容。 */
function LegacyResultRedirect() {
  const { id } = useParams<{ id: string }>()
  return <Navigate to={id ? `/projects/${encodeURIComponent(id)}/result` : '/'} replace />
}

/**
 * 整屏页面统一主题边界：全屏工作台 / 结果页不走 AppShell，
 * 这里复用 AppShell 的 .app-shell 语义色映射与同一持久化主题偏好。
 */
function FullscreenThemeBoundary({ children }: { children: ReactNode }) {
  const { theme } = useAppTheme()
  return (
    <div className="app-shell h-dvh w-full" data-theme={theme}>
      {children}
    </div>
  )
}

/** 创建中的草稿项目不进入工作台，送回创建流程对应步骤。 */
function ProjectWorkspaceGate() {
  const { id } = useParams<{ id: string }>()
  const project = useProject(id)
  const isCreating = useProjectsStore((s) => Boolean(id && s.creationDrafts[id]))
  if (project && isCreating) {
    return <Navigate to={projectCreationPath(project)} replace />
  }
  return <WorkspacePage />
}

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
        {/* 三维工作台与结果页为整屏布局，不套 AppShell，改用共享主题边界补齐语义色 */}
        <Route path="/projects/:id" element={<FullscreenThemeBoundary><ProjectWorkspaceGate /></FullscreenThemeBoundary>}>
          <Route path="workspace" />
          <Route path="objects/:objectId/ports" element={<ObjectPortsPage />} />
        </Route>
        <Route path="/projects/:id/result" element={<FullscreenThemeBoundary><ResultPage /></FullscreenThemeBoundary>} />
        {/* 旧的执行指南 / 方案对比地址退场：保留兼容跳转到结果页，不留死链 */}
        <Route path="/projects/:id/guide" element={<LegacyResultRedirect />} />
        <Route path="/projects/:id/compare" element={<LegacyResultRedirect />} />
        <Route path="/algorithm-lab" element={<AlgorithmLabPage />} />
        <Route path="/routing-demo" element={<RoutingDemoPage />} />
        <Route path="/workflow" element={<WorkflowPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}
