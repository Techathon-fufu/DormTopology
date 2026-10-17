import { create } from 'zustand'
import { isFastForward, setFastForward } from '@/lib/mockPacing'

/**
 * 「跳过模拟等待」开关的 UI 状态（包装 @/lib/mockPacing 的模块级开关）。
 * 仅演示模式有意义；服务模式（真实后端）下相关控件不渲染。
 */
interface MockPacingState {
  fast: boolean
  setFast: (value: boolean) => void
  toggle: () => void
}

export const useMockPacingStore = create<MockPacingState>()((set, get) => ({
  fast: isFastForward(),
  setFast: (fast) => {
    setFastForward(fast)
    set({ fast })
  },
  toggle: () => get().setFast(!get().fast),
}))
