# 前端主题接入说明

本分支把首页已有的雾白、浅木中性色和低饱和青绿扩展为公共主题。创建页、空间配置、物品导入等套用 `AppShell` 的页面会自动获得日间/深夜外观；首页继续使用自己的布局类，但颜色来自同一组令牌。

## 组件接口

- 在需要读取或切换主题的组件中使用 `useAppTheme()`，返回 `theme` 与 `setTheme`。
- 直接复用切换控件时使用 `ThemeToggle`。它提供日间、深夜两个有可访问名称的按钮。
- `useHomeTheme` 仅作为旧导入兼容层，新代码应从 `@/ui/theme/useAppTheme` 导入。
- 用户偏好继续写入 `dormtopology.home-theme`，已有选择不会因此次升级丢失。

## 主题令牌

公共颜色定义在 `frontend/src/index.css`：

- 背景与表面：`--app-bg`、`--app-surface`、`--app-muted`、`--app-border`
- 文本：`--app-foreground`、`--app-muted-foreground`、`--app-faint`
- 品牌色：`--app-primary`、`--app-primary-hover`、`--app-primary-soft`、`--app-on-primary`
- 状态色：`--app-danger`、`--app-success`、`--app-warning`、`--app-info`
- 效果：`--app-hover`、`--app-shadow-xs`、`--app-shadow-overlay`

功能分支优先继续使用现有 Tailwind 语义类，如 `bg-surface`、`text-muted-foreground`、`text-danger`。位于 `.app-shell` 内时，这些类会映射到公共主题。全屏工作台若需要主题，应在它的根节点设置 `data-theme={theme}` 和 `.app-shell`，由对应页面负责人接入；不要复制另一套颜色常量。

## 产品入口约定

默认可见界面只说明“创建项目 → 工作台 → 跟随动画整理”。首页不再推广 `/algorithm-lab`、`/workflow` 或执行指南；底层路由暂时保留给集成分支处理兼容性。
