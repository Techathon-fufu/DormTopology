# 运行时模型

正式桌体来源为 `Prefabmodel/dormdesk_parts/dormdesk_body.glb`，三个抽屉同目录；通过 `frontend/scripts/sync-desk-parts.ts` 同步至本目录的 `dormdesk_parts/`。物品来源为 `Prefabmodel/*.glb`，通过 `sync-prefab-items.ts` 同步至 `items/`。

禁止读取或从 `objects/` 导出资产。原桌板直接显示，不生成额外桌面或穿线孔；加载失败使用同源碰撞几何回退。

资产处理和验证命令见 [桌体接入说明](../../docs/desk-model.md)。
