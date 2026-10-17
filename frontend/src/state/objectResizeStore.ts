import { create } from 'zustand'
import type { ObjectDimensions } from '@/types/project'

/**
 * 等比缩放拖拽的会话预览（不持久化、不进历史）。
 * 拖拽期间只写 preview；松手时一次性提交到 project 存储。
 */
export interface ResizePreview {
  projectId: string
  objectId: string
  dimensions: ObjectDimensions
}

interface ObjectResizeState {
  preview: ResizePreview | null
  setPreview: (preview: ResizePreview | null) => void
}

export const useObjectResizeStore = create<ObjectResizeState>()((set) => ({
  preview: null,
  setPreview: (preview) => set({ preview }),
}))
