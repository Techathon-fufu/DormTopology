import { Dropdown } from '@/ui/kit/dropdown'
import { ArrowUpRight, HelpCircle, Plus, ChevronDown } from 'lucide-react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { isMockMode } from '@/api'
import { LogoMark } from '@/ui/brand/LogoMark'
import { ServiceStatusCluster } from '@/ui/service/ServiceStatusCluster'
import { DemoTour } from '@/ui/tour/DemoTour'
import { cn } from '@/lib/utils'
import { DEMO_PROJECT_ID } from '@/data/demoProject'

function navClass({ isActive }: { isActive: boolean }) {
  return cn('rounded-lg px-3 py-2 text-[13px] transition-colors', isActive ? 'bg-primary-soft font-medium text-primary' : 'text-muted-foreground hover:bg-muted')
}

export function AppShell() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-surface print:hidden">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:gap-6 sm:px-8">
          <Link to="/" className="flex shrink-0 items-center gap-2.5"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-soft"><LogoMark className="h-6 w-6" /></span><span className="text-sm font-semibold tracking-tight">寝空拓扑<span className="mt-0.5 hidden text-[10px] font-normal tracking-wider text-muted-foreground sm:block">DORMTOPOLOGY 3D</span></span></Link>
          <nav aria-label="主导航" className="hidden items-center gap-1 md:flex"><NavLink to="/" className={navClass} end>我的空间</NavLink><NavLink to="/projects/new" className={navClass}>新建项目</NavLink></nav>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <ServiceStatusCluster placement="down" className="hidden lg:flex" />
            <Link to={`/projects/${DEMO_PROJECT_ID}/workspace`} className="hidden items-center gap-1 rounded-lg px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted sm:flex">示例工作台<ArrowUpRight className="h-3.5 w-3.5" /></Link>
            <Link to="/projects/new" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium hover:bg-muted md:hidden"><Plus className="h-3.5 w-3.5" />新建</Link>
            <Dropdown className="group relative">
              <summary className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-lg text-muted-foreground hover:bg-muted [&::-webkit-details-marker]:hidden" aria-label="使用帮助" title="使用帮助"><HelpCircle className="h-4 w-4" /></summary>
              <div className="absolute right-0 top-12 w-72 max-w-[calc(100vw-32px)] rounded-xl border border-border bg-surface p-5 shadow-overlay">
                <h2 className="text-sm font-semibold">从照片到整理指南</h2><ol className="mt-3 space-y-2 text-xs leading-6 text-muted-foreground"><li>1. 确认桌面尺寸与收纳区域。</li><li>2. 上传照片，检查物品清单。</li><li>3. 在工作台预览整理与走线。</li><li>4. 接受方案，查看与导出指南。</li></ol><p className="mt-3 border-t border-border pt-3 text-xs leading-6 text-muted-foreground">尺寸需要实际测量。简化模型与演示结果会单独标注。</p><Link to={`/projects/${DEMO_PROJECT_ID}/workspace`} className="mt-3 flex items-center gap-1 text-xs font-medium text-primary">先看看示例<ArrowUpRight className="h-3 w-3" /></Link>
              </div>
            </Dropdown>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-7 sm:px-8 sm:py-10"><Outlet /></main>
      <footer className="border-t border-border bg-surface/50 py-5 print:hidden"><div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 sm:px-8"><span className="text-xs text-muted-foreground">寝空拓扑 · 为顺手的宿舍空间而设计</span><details className="group max-w-xl text-xs text-muted-foreground"><summary className="flex cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden"><span className="h-1.5 w-1.5 rounded-full bg-primary" />整理与理线使用后端算法<ChevronDown className="h-3 w-3 group-open:rotate-180" /></summary><p className="mt-2 leading-6">{isMockMode ? '照片识别与外观生成仍使用模拟数据，并在对应步骤单独标注。' : '识别与外观生成请求应用后端；失败和数据来源会在对应步骤显示。'}</p></details></div></footer>
      <DemoTour />
    </div>
  )
}
