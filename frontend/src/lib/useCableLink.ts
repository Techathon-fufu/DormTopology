import { useCallback } from 'react'
import type { Project } from '@/types/project'
import { PORT_TYPE_LABELS } from '@/types/project'
import { createCableBetween } from '@/scene/cables'
import { useCableStore } from '@/state/cableStore'
import { useWorkspaceStore } from '@/state/workspaceStore'

/**
 * 接口连线交互（三维接口标记 / 左侧「设备与接口」列表 / 右侧接口编辑共用）：
 * 第一次点击选择起点接口 → 第二次点击另一个接口建立连接。
 * 操作反馈通过 cableStore.notice 呈现（页面转换为 flash 提示）。
 */
export function useCableLink() {
  return useCallback((project: Project, objectId: string, portId: string) => {
    const cableState = useCableStore.getState()
    const object = project.objects.find((o) => o.id === objectId)
    const port = object?.ports.find((p) => p.id === portId)
    if (!object || !port) {
      cableState.setNotice('接口不存在（设备或接口可能已被删除）')
      return
    }
    const label = `${object.name} · ${port.label ?? PORT_TYPE_LABELS[port.type]}`

    if (port.type === 'wireless') {
      cableState.setNotice(`「${label}」是无线接口，无需线缆连接`)
      return
    }

    const current = cableState.linkFrom
    if (!current) {
      cableState.setLinkFrom({ objectId, portId })
      cableState.setNotice(`已选择起点接口：${label}；请点击另一个接口完成连接（Esc 取消）`)
      return
    }
    if (current.objectId === objectId && current.portId === portId) {
      cableState.setLinkFrom(null)
      cableState.setNotice('已取消连线')
      return
    }

    const fromObject = project.objects.find((o) => o.id === current.objectId)
    const fromPort = fromObject?.ports.find((p) => p.id === current.portId)
    const fromLabel = fromObject
      ? `${fromObject.name} · ${fromPort?.label ?? (fromPort ? PORT_TYPE_LABELS[fromPort.type] : '接口')}`
      : '未知接口'

    const result = createCableBetween(
      project,
      current.objectId,
      current.portId,
      objectId,
      portId,
    )
    if (!result.ok) {
      cableState.setNotice(`未能建立连接：${result.reason}`)
      cableState.setLinkFrom(null)
      return
    }
    useWorkspaceStore.getState().addCable(project.id, result.cable)
    cableState.selectCable(result.cable.id)
    cableState.setLinkFrom(null)
    cableState.setNotice(`已建立连接：${fromLabel} → ${label}（可在右侧面板生成建议路径）`)
  }, [])
}
