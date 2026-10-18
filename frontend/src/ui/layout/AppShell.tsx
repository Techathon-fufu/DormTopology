import { Dropdown } from '@/ui/kit/dropdown'
import { ArrowUpRight, HelpCircle } from 'lucide-react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { LogoMark } from '@/ui/brand/LogoMark'
import { DemoTour } from '@/ui/tour/DemoTour'
import { HomeHeader } from '@/ui/home/HomeHeader'
import { useAppTheme, type AppTheme } from '@/ui/theme/useAppTheme'
import { ThemeToggle } from '@/ui/theme/ThemeToggle'
import '@/ui/home/home.css'
import { cn } from '@/lib/utils'
import { DEMO_PROJECT_ID } from '@/data/demoProject'

function navClass({ isActive }: { isActive: boolean }) {
  return cn('app-nav-link', isActive && 'app-nav-link-active')
}

function HomeShell({ theme }: { theme: AppTheme }) {
  return (
    <div className="home-shell" data-theme={theme}>
      <HomeHeader />
      <main className="home-main"><Outlet /></main>
      <DemoTour />
    </div>
  )
}

export function AppShell() {
  const location = useLocation()
  const { theme } = useAppTheme()
  if (location.pathname === '/') return <HomeShell theme={theme} />

  return (
    <div className="app-shell flex min-h-dvh flex-col" data-theme={theme}>
      <header className="app-header sticky top-0 z-40 print:hidden">
        <div className="app-header-inner mx-auto flex h-16 max-w-7xl items-center gap-6 px-8">
          <Link to="/" className="app-brand flex shrink-0 items-center gap-2.5" aria-label="寝空拓扑首页"><span className="app-brand-mark flex h-9 w-9 items-center justify-center"><LogoMark className="h-6 w-6" /></span><span className="flex flex-col text-sm font-semibold tracking-tight">寝空拓扑<span className="mt-0.5 text-[10px] font-normal tracking-wider text-muted-foreground">DORMTOPOLOGY 3D</span></span></Link>
          <nav aria-label="主导航" className="flex items-center gap-1"><NavLink to="/" className={navClass} end>我的空间</NavLink><NavLink to="/projects/new" className={navClass}>创建项目</NavLink></nav>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Link to={`/projects/${DEMO_PROJECT_ID}/workspace`} className="flex items-center gap-1 rounded-lg px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted">示例工作台<ArrowUpRight className="h-3.5 w-3.5" /></Link>
            <Dropdown className="group relative">
              <summary className="app-icon-button flex h-9 w-9 cursor-pointer list-none items-center justify-center [&::-webkit-details-marker]:hidden" aria-label="使用帮助" title="使用帮助"><HelpCircle className="h-4 w-4" /></summary>
              <div className="app-popover absolute right-0 top-12 w-72 max-w-[calc(100vw-32px)] p-5">
                <h2 className="text-sm font-semibold">三步开始整理</h2>
                <ol className="mt-3 space-y-2 text-xs leading-6 text-muted-foreground">
                  <li>1. 创建项目，确认空间与物品。</li>
                  <li>2. 在工作台调整整理与理线方案。</li>
                  <li>3. 跟随动画，在现实场景中完成整理。</li>
                </ol>
                <p className="mt-3 border-t border-border pt-3 text-xs leading-6 text-muted-foreground">尺寸需要实际测量。简化模型与演示结果会单独标注。</p>
                <Link to={`/projects/${DEMO_PROJECT_ID}/workspace`} className="mt-3 flex items-center gap-1 text-xs font-medium text-primary">先看看示例<ArrowUpRight className="h-3 w-3" /></Link>
              </div>
            </Dropdown>
            <ThemeToggle ariaLabel="全站外观" />
          </div>
        </div>
      </header>
      <main className="app-main mx-auto w-full max-w-7xl flex-1 px-8 py-10"><Outlet /></main>
      <footer className="app-footer py-5 print:hidden"><div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-8"><span className="text-xs text-muted-foreground">寝空拓扑 · 为顺手的宿舍空间而设计</span><span className="text-xs text-muted-foreground">演示内容会在页面中明确标注</span></div></footer>
      <DemoTour />
    </div>
  )
}
