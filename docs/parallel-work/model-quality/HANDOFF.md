# 模型稳定显示、杯底修复与物品配色交接

状态：功能与专项回归已完成，等待 integration 选择性合入。

- 共同基线：`e3de759ad223f2c541617924ae45d61c70d3cf33`
- 分支：`codex/model-quality`
- 本次启动只提交任务说明，没有实现产品改动。

## 实际改动

功能提交：`9d886ba fix(frontend): stabilize imported model rendering`

- 杯体根因是 `Mug_Body` 闭合壳体整体朝内：192 个三角形需要翻向；不是重复三角面或全局阴影问题。`ObjectModel` 现将 `cup`（以及同样朝内的保温杯）纳入逐闭合组件修复，开放杯口/内壁、非流形和歧义表面仍保持原样。手机、鼠标垫和显示器底座原有修复保留。
- `ObjectModel` 现在实际消费 `ModelRef.assetUrl` 与 IndexedDB `assetId`，仅在 `ready + glb/gltf` 时加载；失败稳定回退语义占位几何。显示副本保留原材质、贴图、透明设置和动画片段，骨骼模型使用 `SkeletonUtils.clone`，Blob URL 在切换/卸载时释放。
- 导入显示修复只改变显示副本的闭合壳体索引与法线，不写源资产，也不改变物品尺寸、碰撞或接口。模板缓存对 `assetId` 使用稳定键，避免每次 Blob URL 变化重复累积模板。
- 固定家具直接显示 GLB 自带的两块实心桌板；删除“隐藏原桌板 + 参数化桌板叠加”的旧路径。桌板现在参与既有共面所有权清理，抽屉交互和动画保持现状。
- 加深物品和家具配色并降低过强环境光：深色键鼠/显示屏、适中杯体与收纳色、暖浅木家具；带贴图的模型不覆盖贴图。
- 保留高性能 GPU 请求、按需绘制、桌面 DPR 上限、PCF 阴影、几何合批、书本姿态和 Ctrl 缩放链路。

修改文件：

- `frontend/src/scene/ObjectModel.tsx`
- `frontend/src/scene/importModel.ts`
- `frontend/src/scene/prefabModelGeometry.ts`
- `frontend/src/scene/prefabAppearance.ts`
- `frontend/src/scene/furnitureAppearance.ts`
- `frontend/src/scene/DormDeskModel.tsx`
- `frontend/src/scene/ParametricDesk.tsx`
- `frontend/src/scene/SceneLighting.tsx`
- `frontend/src/scene/renderProfile.ts`
- `frontend/scripts/check-parallel-model-quality-geometry.ts`
- `frontend/tests/parallel-model-quality.spec.ts`

DeepSeek-Worker 完成一次只读诊断，返回模型 `deepseek-pro`，总用量 8454 tokens；未修改工作区。Codex 以本地 GLB 几何审计推翻其“更可能共面重复”的初判，并据实实现闭壳修复。

## 验证证据

- `npm run typecheck`：通过。
- `npm run build`：通过；仅保留既有大 chunk 警告。
- `node --experimental-strip-types scripts/check-parallel-model-quality-geometry.ts`：通过。杯体修复前顶向射线错误命中 `y=0`，修复后命中 `y≈0.005m`；开放平面负向对照保持原几何；手机 `0.007m`、鼠标垫 `0.001m`，保温杯同类反向壳体也被识别。
- `npx --yes tsx scripts/check-scene-rendering.ts`：通过。桌体 279 处同向共面重叠清理为 0；4 个家具文件轮廓/边界保持；键盘 93→5 meshes，鼠标 31→5 meshes。
- `npx --yes tsx scripts/check-desk-model.ts`：通过。桌体、三抽屉、锚点、行程和缓动契约保持。
- `PLAYWRIGHT_BASE_URL=http://127.0.0.1:5205 npx playwright test parallel-model-quality --project=desktop-chromium`：通过。预制杯、URL 导入杯、IndexedDB 本地杯、手机、1mm 鼠标垫、显示器底座在 4 个相机位置下命中正确上表面；场景中只有 GLB 的两块 `Desk_Top_*`，没有叠加桌板。截图位于该轮 `frontend/test-results/.../contact-view-*.png`（测试产物不提交）。
- `PLAYWRIGHT_BASE_URL=http://127.0.0.1:5205 npx playwright test thin-contact object-resize book-organization drawer --project=desktop-chromium`：6 通过、2 跳过；手机/鼠标垫/显示器、Ctrl 缩放、抽屉开合和抽屉内物品坐标通过。书本真实后端用例及仓库废弃的 mobile 用例按测试自身条件跳过。
- 手动浏览器检查 `1440×1000`：工作台场景非空，实心桌板、深色物品和暖木家具可见，桌面视角无控件遮挡。

## 跨分支接口与整合提示

- 工作台/创建流程只需继续写现有 `ModelRef.assetUrl` 或 `assetId`、`status='ready'`、`format='glb'|'gltf'`；无需新增 state 字段。`assetId` 必须对应 IndexedDB `modelFiles` 中的 Blob。
- `ObjectModel` 的加载失败仍回退现有 `PrimitiveModel`。若 workspace-simple 需要把具体加载错误显示给用户，应在其拥有的面板中依据任务/模型状态补提示，不要复制第二套 GLTF 加载器。
- integration 合入远程家具改动时，保留本分支 `DormDeskModel` 的实心桌板路径和 `prepareFurnitureAppearance`；不要恢复 `Desk_Top_* visible=false` 或 `<ParametricDesk desktopOnly />` 叠层。
- 本分支没有移植远程需要新增非归属依赖的 `placementEditing/backboardMount/drawerContents` 整套状态协议；当前基线已有抽屉显示偏移、拖拽射线、碰撞和动画且回归通过。integration 若合入远程完整状态协议，应一次性合入其调用方，避免两套抽屉偏移或动画驱动。

## 限制与确认

- 闭壳修复只处理拓扑可安全判断、体积为负的闭合组件；开放/非流形/零体积坏模型明确保持原样并回退现有显示，不承诺修复任意损坏资产。
- 浏览器回归使用 Playwright SwiftShader，只证明渲染正确性，不作为真实硬件 GPU 性能证据。
- 未修改 `backend/`、`algorithm/`、`vlm/`、`frontend/src/api/` 或后端理线 API；未覆盖其他分支修改，未推送。
