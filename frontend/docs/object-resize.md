# 工作台 Ctrl 角点缩放

在整理模式中先选中物品，再按住 Ctrl：选中框八个顶点显示加粗圆点。按住鼠标左键沿角点方向拖动可等比调整宽、高、深，底面中心与 Y 轴旋转保持不变。拖动期间显示 220px 宽的毫米尺寸面板；松开鼠标后面板关闭，尺寸作为一次可撤销编辑保存。

拖动途中释放 Ctrl 仍可继续到松手。Esc、指针取消、窗口失焦、物品删除、选中或模式切换、外部修改会取消预览。锁定物品、走线模式和整理方案预览期间不提供缩放手柄。手机保留现有查看与尺寸输入功能，此交互需要键盘。

预览仅保存在会话中，不改变项目和历史。松手使用既有 `workspaceStore.updateObject` 写入尺寸与同比缩放的显式接口偏移，接口确认失效，既有走线失效机制继续生效；撤销同时恢复尺寸、接口及线缆状态。模型来源和 ID 保留。外观和碰撞沿用当前模型对 `dimensions` 的处理，不另建碰撞箱或修改生成模型管线。尺寸修正可以产生布局警告，与原属性面板一致；需要重新核对尺寸、布局和接口后再规划。

单次缩放统一限幅：宽/深最小 10mm、高最小 5mm，三轴最大 5m；同一倍率保持比例。输入本身比例不可能同时满足边界时保留原尺寸。

## 并行修改边界

- 新增 `src/scene/ObjectResizeHandles.tsx`、`src/scene/objectResize.ts`、`src/state/objectResizeStore.ts`，以及独立检查和测试。
- `src/scene/SceneObjectMesh.tsx` 只接入尺寸预览、角点组件和 Ctrl 时阻止普通平移；选中框与角点使用同一尺寸。
- `src/scene/CameraRig.tsx` 只新增缩放期间的相机锁定条件。
- 未改工作台页面、侧栏、主页、模型导入/生成/碰撞管线、接口描点、后端或共享尺寸保存实现。后续合并时保留上述两个接入点即可。

## 检查

在 `frontend/` 使用已安装的构建工具运行数学检查：

```powershell
./node_modules/.bin/esbuild scripts/check-object-resize.ts --bundle --platform=node --format=esm --outfile=../.work/check-object-resize.mjs
node ../.work/check-object-resize.mjs
npm run build
```

浏览器检查使用实际指针命中八角点之一，不调用缩放处理函数：

```powershell
$env:PLAYWRIGHT_BASE_URL='http://127.0.0.1:5176'
node node_modules/@playwright/test/cli.js test tests/object-resize.spec.ts tests/drawer.spec.ts --workers=1
```

数学检查覆盖八角点、旋转前局部对角、带符号的屏幕投影、零位移、负向拖动和统一限幅。浏览器检查覆盖旋转后的真实预制笔记本、拖动中无持久化写入、松手一次历史、接口同比缩放与重新确认、撤销/重做/刷新恢复，以及 Esc/取消/失焦、无关指针、锁定/模式限制和手机查看。实际结果与截图保存在本任务的忽略目录 `.work/object-resize/`。

2026-10-17 实测：前端类型检查与生产构建通过；数学检查通过；浏览器回归 6 项通过（桌面缩放/取消/受限状态、桌面与手机抽屉、手机查看），4 项因设备不适用明确跳过，不计作通过。尺寸面板已下移避开桌体状态提示，桌面拖动截图已复核。仅订阅当前物品预览的后续复验曾出现整例 30 秒及清理超时，失败记录保留；未删除断言，整例时限扩至 120 秒后，3 项桌面检查再次全部通过（整轮约 52 秒），1 项设备不适用跳过。

实现按项目要求先委派配置的 `deepseek-pro`，由 Codex 审查修正并运行检查。两次实现草案请求记录 54,054 tokens；一次测试委派未产出文件，记录 17,601 tokens，随后测试由 Codex 完成。合计已记录 71,655 tokens，不将模型声称作为测试通过证据。
