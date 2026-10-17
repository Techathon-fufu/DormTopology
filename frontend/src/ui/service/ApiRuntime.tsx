import { useEffect } from 'react'
import { isMockMode, refreshActiveRemoteJobs } from '@/api'
import { runHealthCheck } from '@/state/apiHealthStore'

/**
 * API 运行时（不渲染界面）：应用挂载时挂在 App 根部。
 *
 * - 真实模式：定时健康检查（30s / 网络恢复 / 页面重新可见）+ 非终态任务的后台状态查询
 *   （刷新页面后自动「继续查询状态」；已在本地长轮询中的任务由 core/jobs 去重）；
 * - 演示模式：不做任何网络调用；
 * - 卸载时中止在途请求（健康检查与任务查询均可取消）。
 */

const HEALTH_INTERVAL_MS = 30000
const JOBS_INTERVAL_MS = 10000

export function ApiRuntime() {
  useEffect(() => {
    if (isMockMode) return
    const controller = new AbortController()

    void runHealthCheck(controller.signal)
    const healthTimer = setInterval(() => {
      if (!document.hidden) void runHealthCheck(controller.signal)
    }, HEALTH_INTERVAL_MS)

    const onOnline = () => {
      void runHealthCheck(controller.signal)
      void refreshActiveRemoteJobs(controller.signal)
    }
    window.addEventListener('online', onOnline)

    return () => {
      controller.abort()
      clearInterval(healthTimer)
      window.removeEventListener('online', onOnline)
    }
  }, [])

  useEffect(() => {
    if (isMockMode) return
    const controller = new AbortController()

    const tick = () => void refreshActiveRemoteJobs(controller.signal)
    if (!document.hidden) tick()
    const jobsTimer = setInterval(() => {
      if (!document.hidden) tick()
    }, JOBS_INTERVAL_MS)
    const onVisibility = () => {
      if (!document.hidden) tick()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      controller.abort()
      clearInterval(jobsTimer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return null
}
