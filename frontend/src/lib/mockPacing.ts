/**
 * 模拟服务的节奏控制（演示用，仅影响 mock 服务的本地等待时长）：
 * - 默认：按各模拟服务的阶段延时播放，便于观察「等待 / 分析中」状态；
 * - 「跳过等待」（演示加速）开启后：所有进行中的等待立即完成，之后的等待不再计时；
 * - 真实服务接入（VITE_SERVICE_MODE=service）后不经过本模块，行为不受影响。
 */
let fastForward = false
const pending = new Set<() => void>()

export function isFastForward(): boolean {
  return fastForward
}

export function setFastForward(value: boolean): void {
  fastForward = value
  if (value) {
    for (const wake of [...pending]) wake()
  }
}

/** 模拟等待：可被「跳过等待」立即唤醒（用于替换模拟服务内的 sleep） */
export function mockSleep(ms: number): Promise<void> {
  if (fastForward || ms <= 0) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const wake = () => {
      clearTimeout(timer)
      pending.delete(wake)
      resolve()
    }
    const timer = setTimeout(wake, ms)
    pending.add(wake)
  })
}
