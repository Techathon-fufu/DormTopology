import { HelpCircle } from 'lucide-react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { LogoMark } from '@/ui/brand/LogoMark'
import { Button } from '@/ui/kit/button'
import { DataBadge } from '@/ui/kit/data-badge'
import { cn } from '@/lib/utils'
import { DEMO_PROJECT_ID } from '@/data/demoProject'

function navClass({ isActive }: { isActive: boolean }) {
  return cn(
    'rounded-md px-3 py-1.5 text-sm transition-colors',
    isActive ? 'bg-primary-soft font-medium text-primary' : 'text-muted-foreground hover:bg-muted',
  )
}

/** 普通页面外壳：顶部导航 + 内容区（三维工作台为整屏布局，不用此外壳） */
export function AppShell() {
  const navigate = useNavigate()

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-surface/85 backdrop-blur print:hidden">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-6">
          <Link to="/" className="flex items-center gap-2">
            <LogoMark />
            <span className="font-semibold">寝空拓扑</span>
            <span className="text-xs font-normal text-faint">DormTopology 3D</span>
          </Link>
          <nav className="flex items-center gap-1">
            <NavLink to="/" className={navClass} end>
              项目
            </NavLink>
            <NavLink to="/projects/new" className={navClass}>
              新建项目
            </NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <DataBadge kind="demo" label="演示模式" className="hidden sm:inline-flex" />
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(`/projects/${DEMO_PROJECT_ID}/workspace`)}
            >
              打开示例项目
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title="帮助文档将在后续阶段提供"
              aria-label="帮助"
            >
              <HelpCircle className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-6">
        <Outlet />
      </main>
      <footer className="border-t border-border py-4">
        <p className="mx-auto max-w-6xl px-6 text-xs text-faint">
          演示模式：识别 / 模型生成 / 规划结果均为本地模拟数据；真实能力将通过应用后端接入
        </p>
      </footer>
    </div>
  )
}
