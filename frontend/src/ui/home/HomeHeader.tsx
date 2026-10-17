import { Link } from 'react-router-dom'
import { HelpCircle, Moon, Sun } from 'lucide-react'
import { LogoMark } from '@/ui/brand/LogoMark'
import { Dropdown } from '@/ui/kit/dropdown'
import { useHomeTheme } from '@/ui/home/useHomeTheme'

/** 首页顶部栏：品牌、我的空间、帮助、日夜外观。所有颜色来自 .home-shell 的作用域令牌。 */
export function HomeHeader() {
  const { theme, setTheme } = useHomeTheme()

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
            我的空间
          </Link>
        </nav>

        <div className="home-header-actions">
          <span className="home-divider" aria-hidden="true" />
          <Dropdown className="home-help">
            <summary aria-label="使用帮助" title="使用帮助">
              <HelpCircle className="h-[18px] w-[18px]" aria-hidden="true" />
            </summary>
            <div className="home-help-panel">
              <h2 className="home-help-title">从照片到整理指南</h2>
              <ol className="home-help-steps">
                <li>1. 确认桌面尺寸与收纳区域。</li>
                <li>2. 上传照片，检查物品清单。</li>
                <li>3. 在工作台预览整理与走线。</li>
                <li>4. 接受方案，查看与导出指南。</li>
              </ol>
              <p className="home-help-note">尺寸需要实际测量。简化模型与演示结果会单独标注。</p>
              <div className="home-help-links">
                <Link to="/algorithm-lab">算法实验</Link>
                <Link to="/workflow">整理工作台</Link>
              </div>
            </div>
          </Dropdown>

          <div className="home-theme-toggle" role="group" aria-label="首页外观">
            <button
              type="button"
              className="home-theme-choice"
              aria-pressed={theme === 'light'}
              aria-label="日间模式"
              title="日间模式"
              onClick={() => setTheme('light')}
            >
              <Sun className="h-[18px] w-[18px]" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="home-theme-choice"
              aria-pressed={theme === 'dark'}
              aria-label="深夜模式"
              title="深夜模式"
              onClick={() => setTheme('dark')}
            >
              <Moon className="h-[18px] w-[18px]" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </header>
  )
}
