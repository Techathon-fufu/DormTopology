import { sleep } from '@/lib/utils'
import type { ModelGenerationService } from '../types'

/**
 * 模拟模型生成：
 * - 大部分物品一次成功（产出演示占位模型，不写真实文件）
 * - 「台灯」首次必定失败（演示失败 / 重试状态），重试后成功
 */
export const mockModelGenerationService: ModelGenerationService = {
  async generateObject({ object, attempt = 0, onProgress }) {
    onProgress?.(0.1, '准备参考照片')
    await sleep(300)
    onProgress?.(0.45, '几何重建（模拟）')
    await sleep(500)

    if (object.name.includes('台灯') && attempt === 0) {
      onProgress?.(0.7, '几何重建失败')
      await sleep(300)
      throw new Error('模拟失败：参考照片不清晰，几何重建超时。可点击「重试」重新生成。')
    }

    onProgress?.(0.9, '导出模型')
    await sleep(400)
    onProgress?.(1, '完成')

    return {
      objectId: object.id,
      status: 'ready',
      note: '模拟生成：产出演示占位模型（未写入真实模型文件）。真实生成将由后端代理 Rodin 等服务。',
    }
  },
}
