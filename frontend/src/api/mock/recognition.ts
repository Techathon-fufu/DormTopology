import { sleep, uid } from '@/lib/utils'
import type { RecognizedItem, RecognitionService } from '../types'

const STEPS: Array<[number, string]> = [
  [0.12, '预处理照片'],
  [0.38, '检测物品区域'],
  [0.66, '分类与尺寸估计'],
  [0.9, '生成物品清单'],
]

function ports(list: Array<Partial<RecognizedItem['ports'][number]> & { type: RecognizedItem['ports'][number]['type'] }>) {
  return list.map((p) => ({
    id: uid('port'),
    powered: false,
    ...p,
  }))
}

type RawItem = Omit<RecognizedItem, 'fixed' | 'dimensionSource'> & { fixed?: boolean }

/** 模拟识别：返回与演示物品库一致的 9 项物品；其中 1 项低置信度（演示「部分成功」状态） */
export const mockRecognitionService: RecognitionService = {
  async recognize({ onProgress, simulateFailure }) {
    for (const [index, [p, label]] of STEPS.entries()) {
      onProgress?.(p, label)
      await sleep(420)
      if (simulateFailure && index === 1) {
        // 演示异常流程：分析中途失败，可重试（重试时不勾选强制失败即恢复成功）
        await sleep(300)
        throw new Error('模拟失败：照片光线不足或拍摄角度偏差较大，未能识别出物品。请重试或更换照片。（演示异常流程）')
      }
    }
    await sleep(200)
    onProgress?.(1, '完成')

    const raw: RawItem[] = [
      {
        tempId: uid('r'),
        name: '笔记本电脑',
        category: 'electrical',
        dimensions: { width: 0.34, height: 0.24, depth: 0.24 },
        quantity: 1,
        needsPower: true,
        ports: ports([{ type: 'usb-c', label: 'USB-C 供电', powered: true, maxWatt: 65 }]),
        confidence: 0.96,
      },
      {
        tempId: uid('r'),
        name: '显示器',
        category: 'electrical',
        dimensions: { width: 0.54, height: 0.46, depth: 0.18 },
        quantity: 1,
        needsPower: true,
        ports: ports([
          { type: 'power-ac', label: '电源', powered: true, maxWatt: 40 },
          { type: 'hdmi', label: 'HDMI', powered: false },
        ]),
        confidence: 0.93,
      },
      {
        tempId: uid('r'),
        name: '键盘',
        category: 'electrical',
        dimensions: { width: 0.35, height: 0.03, depth: 0.13 },
        quantity: 1,
        needsPower: false,
        ports: ports([{ type: 'usb-a', label: 'USB 数据', powered: false, maxWatt: 2.5 }]),
        confidence: 0.9,
      },
      {
        tempId: uid('r'),
        name: '鼠标',
        category: 'electrical',
        dimensions: { width: 0.07, height: 0.04, depth: 0.11 },
        quantity: 1,
        needsPower: false,
        ports: ports([{ type: 'wireless', label: '无线接收器', powered: false }]),
        confidence: 0.78,
      },
      {
        tempId: uid('r'),
        name: '台灯',
        category: 'electrical',
        dimensions: { width: 0.16, height: 0.45, depth: 0.18 },
        quantity: 1,
        needsPower: true,
        ports: ports([{ type: 'power-ac', label: '电源', powered: true, maxWatt: 8 }]),
        confidence: 0.88,
      },
      {
        tempId: uid('r'),
        name: '书本（叠放）',
        category: 'nonElectrical',
        dimensions: { width: 0.21, height: 0.14, depth: 0.15 },
        quantity: 3,
        needsPower: false,
        ports: [],
        confidence: 0.82,
      },
      {
        tempId: uid('r'),
        name: '水杯',
        category: 'nonElectrical',
        dimensions: { width: 0.07, height: 0.17, depth: 0.07 },
        quantity: 1,
        needsPower: false,
        ports: [],
        confidence: 0.7,
      },
      {
        tempId: uid('r'),
        name: '收纳盒',
        category: 'storage',
        dimensions: { width: 0.24, height: 0.12, depth: 0.18 },
        quantity: 1,
        needsPower: false,
        ports: [],
        confidence: 0.85,
      },
      {
        tempId: uid('r'),
        name: '排插',
        category: 'electrical',
        dimensions: { width: 0.21, height: 0.03, depth: 0.05 },
        quantity: 1,
        needsPower: true,
        fixed: true,
        ports: ports(
          [1, 2, 3, 4].map((n) => ({
            type: 'power-ac' as const,
            label: `排插·${n} 号口`,
            powered: true,
            maxWatt: 2500,
          })),
        ),
        confidence: 0.91,
      },
    ]

    // 识别出的尺寸一律标为「估计值」，等待用户确认或被编辑后改为「确认值」
    const items: RecognizedItem[] = raw.map((it) => ({
      ...it,
      fixed: it.fixed ?? false,
      dimensionSource: 'estimated' as const,
    }))

    const lowConfidence = items.filter((i) => i.confidence < 0.75).length
    return {
      items,
      lowConfidence,
      note: `模拟识别：共 ${items.length} 项，其中 ${lowConfidence} 项置信度较低（<75%），已标为待确认；全部尺寸为估计值，请确认关键尺寸`,
    }
  },
}
