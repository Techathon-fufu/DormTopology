import { useEffect, useMemo, useRef } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowRight,
  ChevronRight,
  FolderOpen,
  MoreHorizontal,
  Plus,
  Trash2,
} from 'lucide-react'
import type { Project } from '@/types/project'
import { Dropdown } from '@/ui/kit/dropdown'
import { useProjectsStore } from '@/state/projectsStore'
import { useTourStore } from '@/state/tourStore'
import { DEMO_PROJECT_ID } from '@/data/demoProject'
import { formatDateTime } from '@/lib/utils'
import { formatMm } from '@/lib/units'
import { useHomeTheme } from '@/ui/home/useHomeTheme'

/**
 * 首页：首屏 + 底部“最近”单行条 + 可展开的全部项目。
 * “是否展开”只以 URL 的 spaces=all 为唯一来源，浏览器前进/后退、直达链接与头部入口保持一致。
 */
export function ProjectsPage() {
  const { theme } = useHomeTheme()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const projects = useProjectsStore((s) => s.projects)
  const spacesRef = useRef<HTMLElement | null>(null)

  const list = useMemo(
    () => Object.values(projects).sort((a, b) => b.updatedAt - a.updatedAt),
    [projects],
  )
  const recent = list.slice(0, 2)
  const expanded = searchParams.get('spaces') === 'all'

  // 展开后把列表滚到顶部栏下方；尊重减少动态效果设置。
  useEffect(() => {
    if (!expanded) return
    const node = spacesRef.current
    if (!node) return
    const reduce = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    node.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' })
  }, [expanded])

  const toggleSpaces = () => {
    const params = new URLSearchParams(searchParams)
    if (expanded) params.delete('spaces')
    else params.set('spaces', 'all')
    setSearchParams(params)
  }

  const startDemoTour = () => {
    useTourStore.getState().exit()
    navigate(`/projects/${DEMO_PROJECT_ID}/workspace`)
  }

  return (
    <div className="home-page">
      <section className="home-hero">
        <div className="home-hero-art" aria-hidden="true">
          {/* 两张场景图同时加载，只显示当前外观，切换时不出现空白帧 */}
          <img
            className="home-hero-img"
            data-active={theme === 'light'}
            src="/images/home/desk-day.webp"
            alt=""
            decoding="async"
          />
          <img
            className="home-hero-img"
            data-active={theme === 'dark'}
            src="/images/home/desk-night.webp"
            alt=""
            decoding="async"
          />
        </div>
        <div className="home-hero-copy">
          <h1 className="home-headline">
            让桌面，
            <br />
            更顺手。
          </h1>
          <p className="home-subtitle">整理与理线，一目了然。</p>
          <div className="home-hero-actions">
            <Link to="/projects/new" className="home-cta">创建项目<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
            <button type="button" className="home-cta-secondary" onClick={startDemoTour}>体验示例<ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
          </div>
        </div>
        <span className="home-scene-label">场景示意 · 非项目截图</span>
      </section>

      <section className="home-recent" aria-label="最近空间">
        <div className="home-recent-inner">
          <span className="home-recent-label">最近</span>
          <span className="home-recent-sep" aria-hidden="true" />
          {recent.length === 0 ? (
            <span className="home-recent-empty">还没有项目</span>
          ) : (
            recent.map((project) => (
              <Link
                key={project.id}
                to={projectEntry(project)}
                className="home-recent-item"
              >
                <span className="home-recent-thumb" aria-hidden="true">
                  <FolderOpen className="h-4 w-4" />
                </span>
                <span className="home-recent-name" title={project.name}>{project.name}</span>
                <ChevronRight className="home-recent-chevron h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            ))
          )}
          <span className="home-recent-spacer" />
          <button
            type="button"
            className="home-recent-more"
            aria-expanded={expanded}
            aria-controls="all-spaces"
            onClick={toggleSpaces}
          >
            全部项目
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </section>

      {expanded ? (
        <section id="all-spaces" className="home-spaces" aria-label="全部项目" ref={spacesRef}>
          <div className="home-spaces-head">
            <h2 className="home-spaces-title">
              我的项目
              <span className="home-spaces-count">{list.length} 个</span>
            </h2>
            <Link to="/projects/new" className="home-spaces-new">
              创建项目
              <Plus className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>

          {list.length === 0 ? (
            <div className="home-empty">
              <FolderOpen className="h-6 w-6" aria-hidden="true" />
              <h3>你的第一个空间，从这里开始</h3>
              <p>创建一个项目，或先体验示例中的完整整理过程。</p>
              <Link to="/projects/new" className="home-empty-action">
                <Plus className="h-4 w-4" aria-hidden="true" />
                创建项目
              </Link>
            </div>
          ) : (
            <ul className="home-space-list">
              {list.map((project) => (
                <SpaceRow key={project.id} project={project} />
              ))}
            </ul>
          )}


        </section>
      ) : null}
    </div>
  )
}

function SpaceRow({ project }: { project: Project }) {
  const navigate = useNavigate()
  const remove = useProjectsStore((s) => s.remove)

  return (
    <li className="home-space-row">
      <Link to={projectEntry(project)} className="home-space-main">
        <span className="home-space-name">
          <span className="home-space-title" title={project.name}>{project.name}</span>
          {project.isDemo ? (
            <span className="home-badge" title="内置示例项目，演示数据">示例</span>
          ) : null}
        </span>
        <span className="home-space-meta">
          <span>{formatMm(project.room.desk.width)} × {formatMm(project.room.desk.depth)}</span>
          <span>{project.objects.length} 件物品 · {project.cables.length} 条线缆</span>
          <span>{formatDateTime(project.updatedAt)}</span>
        </span>
      </Link>
      <Dropdown className="home-space-dropdown">
        <summary className="home-space-more" aria-label={`${project.name} 的更多操作`}>
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </summary>
        <div className="home-space-menu">
          <button
            type="button"
            className="home-menu-item"
            onClick={() => navigate(`/projects/${project.id}/setup`)}
          >
            空间配置
          </button>
          <button
            type="button"
            className="home-menu-item"
            onClick={() => navigate(`/projects/${project.id}/import`)}
          >
            照片与物品
          </button>
          <button
            type="button"
            className="home-menu-item"
            onClick={() => navigate(`/projects/${project.id}/result`)}
          >
            查看整理动画
          </button>
          {!project.isDemo ? (
            <button
              type="button"
              className="home-menu-item home-menu-item-danger"
              onClick={() => {
                if (window.confirm(`确定删除「${project.name}」吗？`)) remove(project.id)
              }}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              删除项目
            </button>
          ) : null}
        </div>
      </Dropdown>
    </li>
  )
}

function projectEntry(project: Project): string {
  const page = project.stage === 'space' ? 'setup' : ['photos', 'assets'].includes(project.stage) ? 'import' : 'workspace'
  return `/projects/${project.id}/${page}`
}
