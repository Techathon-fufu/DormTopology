import { Link } from 'react-router-dom'
import { HelpCircle } from 'lucide-react'
import { LogoMark } from '@/ui/brand/LogoMark'
import { Dropdown } from '@/ui/kit/dropdown'
import { ThemeToggle } from '@/ui/theme/ThemeToggle'

/** 首页顶部栏：品牌、我的空间、帮助与共享日夜主题。 */
export function HomeHeader() {
  return (
    <header className="home-header print:hidden">
      <div className="home-header-inner">
        <Link to="/" className="home-brand" aria-label="寝空拓扑首页">
          <span className="home-brand-mark">
            <LogoMark className="h-[26px] w-[26px]" />
          </span>
          <span className="home-brand-name">寝空拓扑</span>
        </Link>

        <nav className="home-nav" aria-label="主导航">
          <Link to="/?spaces=all#all-spaces" className="home-nav-link">
            我的项目
          </Link>
        </nav>

        <div className="home-header-actions">
          <span className="home-divider" aria-hidden="true" />
          <Dropdown className="home-help">
            <summary aria-label="使用帮助" title="使用帮助">
              <HelpCircle className="h-[18px] w-[18px]" aria-hidden="true" />
            </summary>
            <div className="home-help-panel">
              <h2 className="home-help-title">三步开始整理</h2>
              <ol className="home-help-steps">
                <li>1. 创建项目，确认空间与物品。</li>
                <li>2. 在工作台调整整理与理线方案。</li>
                <li>3. 跟随动画，在现实场景中完成整理。</li>
              </ol>
              <p className="home-help-note">尺寸需要实际测量。简化模型与演示结果会单独标注。</p>
            </div>
          </Dropdown>

          <ThemeToggle className="home-theme-toggle" choiceClassName="home-theme-choice" ariaLabel="全站外观" />
        </div>
      </div>
    </header>
  )
}
