# 桌体 GLB 资产放置目录

桌体资产源文件在 `Prefabmodel/dormdesk_parts/dormdesk_body.glb`，复制到本目录后生效：

    frontend/public/models/dormdesk_body.glb

- 开发环境访问路径：`/models/dormdesk_body.glb`；生产构建会原样复制到 `dist/models/`，
  代码通过 `import.meta.env.BASE_URL` 解析（子路径部署同样正确）。
- 单位 / 朝向 / 命名锚点建议与归一化配置：见 `frontend/docs/desk-model.md`。
- **不改变原点**：该文件 `x` 最小与 `y` 最小均为 0，已符合数据契约第 1 节原点，加载时
  不做水平居中；抽屉是与桌体共用原点的独立绝对坐标文件，居中桌体会使两者错位。
- 文件缺失时工作台会自动回退到参数化简化桌体（ParametricDesk），并在视口右下角给出
  可读提示与「重试」入口——不会中断演示与其余功能。
