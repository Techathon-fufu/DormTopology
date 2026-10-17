# 桌体 GLB 资产放置目录

把导出的 `dorm_desk_assembled.glb` 放在本目录：

    frontend/public/models/dorm_desk_assembled.glb

- **当前来源**：仓库根 `Prefabmodel/dormdesk.glb`（上床下桌整组固定家具，Blender 源 `objects/dormdesk.blend` 导出）。
  更新资产时从 `Prefabmodel/` 复制到本目录，并运行 `npx tsx scripts/check-desk-model.ts` 校验命名与尺寸契约。
- 开发环境访问路径：`/models/dorm_desk_assembled.glb`；生产构建会原样复制到 `dist/models/`，
  代码通过 `import.meta.env.BASE_URL` 解析（子路径部署同样正确）。
- 单位 / 朝向 / 命名锚点建议与归一化配置：见 `frontend/docs/desk-model.md`。
- 文件缺失时工作台会自动回退到参数化简化桌体（ParametricDesk），并在视口右下角给出
  可读提示与「重试」入口——不会中断演示与其余功能。
