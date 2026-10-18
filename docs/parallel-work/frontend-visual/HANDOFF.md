# 统一全站视觉与主题交接

状态：功能实现和独立验证已完成，等待 integration 选择性合并。

- 共同基线：`e3de759ad223f2c541617924ae45d61c70d3cf33`
- 分支：`codex/frontend-visual`
- 功能提交：`3d3ba23`（统一公共主题、精简默认入口、增加桌面验证）
- 本分支没有修改路由定义、工作台业务页面、三维模型或后端文件。

## 已交付

1. 公共 `useAppTheme` 与 `ThemeToggle`：首页及 `AppShell` 页面共享日间/深夜偏好，沿用原存储键。
2. `index.css` 提供公共主题令牌、焦点、表单和现有 Tailwind 语义类的主题映射；首页颜色改为引用公共令牌。
3. 普通页面外壳与首页使用一致的品牌、圆角、表面和青绿色；深色状态色与错误提示保持清晰。
4. 帮助说明精简为“创建项目 → 工作台 → 跟随动画整理”，首页隐藏算法实验、内部工作流和执行指南操作。
5. 接入细节见 [THEME.md](THEME.md)。工作台等全屏页面由其所有者根据文档接入，避免本分支越界修改。

## 验证证据

- `npm run typecheck`：通过。
- `npm run build`：通过；仅保留原有大包体积提示。
- `PLAYWRIGHT_BASE_URL=http://127.0.0.1:5201 playwright test tests/parallel-frontend-visual.spec.ts --project=desktop-chromium`：4 项通过。
- 1440×1000 截图：`.work/frontend-visual/shots/home-light-1440x1000.png`、`home-dark-1440x1000.png`、`create-light-1440x1000.png`、`create-dark-1440x1000.png`。

## 集成提示

- creation 分支若改写 `AppShell` 或首页 CTA 文案，保留 `useAppTheme`、`ThemeToggle`、`.app-shell` 与三步帮助文案。
- workspace/result 分支可在全屏根节点调用 `useAppTheme` 并使用 `.app-shell`，无需复制主题状态。
- 路由仍存在只是未在默认 UI 推广；最终删除旧 guide 模块及兼容跳转仍归 integration/result 分支。
- DeepSeek worker 收到请求但返回了不符合单一 JSON 契约的响应，候选补丁未应用；本地实现已由 Codex 审查并用真实构建、浏览器验证。
- 已确认未改动后端理线 API、未覆盖其他分支修改、未推送远程。
