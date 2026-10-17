import { putFile } from '@/state/storage/idb'
import { uid } from '@/lib/utils'

export interface SamplePhotoEntry {
  id: string
  name: string
  url: string
  sample: true
}

const VARIANTS = [
  { bg: '#F3EFE7', floor: '#E4DDD0', wood: '#D8BB8E', dark: '#2F3B46', screen: '#9FB7C6', label: '俯拍' },
  { bg: '#EFEAE0', floor: '#DED6C8', wood: '#CFAF7F', dark: '#3C4A55', screen: '#A8C3CE', label: '侧视角' },
] as const

function drawSample(index: number): Promise<Blob> {
  const v = VARIANTS[index % VARIANTS.length]
  const canvas = document.createElement('canvas')
  canvas.width = 640
  canvas.height = 480
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error('无法创建画布（当前浏览器不支持）'))

  // 墙面与地面
  ctx.fillStyle = v.bg
  ctx.fillRect(0, 0, 640, 480)
  ctx.fillStyle = v.floor
  ctx.fillRect(0, 320, 640, 160)

  // 桌面
  ctx.fillStyle = v.wood
  ctx.fillRect(40, 300, 560, 26)
  ctx.fillStyle = v.dark
  ctx.fillRect(70, 326, 14, 120)
  ctx.fillRect(556, 326, 14, 120)

  // 显示器
  ctx.fillStyle = v.dark
  ctx.fillRect(230, 150, 190, 128)
  ctx.fillStyle = v.screen
  ctx.fillRect(240, 160, 170, 108)
  ctx.fillStyle = v.dark
  ctx.fillRect(310, 278, 30, 22)
  ctx.fillRect(280, 296, 90, 8)

  // 笔记本（左侧，微斜示意）
  ctx.save()
  ctx.translate(120, 262)
  ctx.rotate(-0.08)
  ctx.fillStyle = v.dark
  ctx.fillRect(-60, 0, 130, 10)
  ctx.fillStyle = '#DCE3E8'
  ctx.fillRect(-55, -50, 120, 48)
  ctx.restore()

  // 台灯
  ctx.fillStyle = v.dark
  ctx.fillRect(516, 236, 8, 64)
  ctx.beginPath()
  ctx.arc(520, 230, 24, Math.PI, Math.PI * 2)
  ctx.fillStyle = '#E8B84B'
  ctx.fill()

  // 水杯
  ctx.beginPath()
  ctx.arc(460, 282, 14, 0, Math.PI * 2)
  ctx.fillStyle = '#7FA8A0'
  ctx.fill()

  // 书本
  ctx.fillStyle = '#B96E5A'
  ctx.fillRect(560, 276, 28, 24)
  ctx.fillStyle = '#4F6D7A'
  ctx.fillRect(560, 266, 28, 10)

  // 标注
  ctx.fillStyle = v.dark
  ctx.font = '16px sans-serif'
  ctx.fillText(`示例照片（演示数据） · ${v.label}`, 24, 36)
  ctx.fillStyle = '#8A8F96'
  ctx.font = '12px sans-serif'
  ctx.fillText('由本地画布生成，仅用于演示识别流程', 24, 58)

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('导出示例照片失败'))),
      'image/png',
    )
  })
}

/** 生成示例照片（演示数据）：保存到 IndexedDB photos 表并返回预览 URL */
export async function createSamplePhotos(count = 2): Promise<SamplePhotoEntry[]> {
  const out: SamplePhotoEntry[] = []
  for (let i = 0; i < count; i += 1) {
    const blob = await drawSample(i)
    const id = uid('photo')
    await putFile('photos', id, blob)
    out.push({
      id,
      name: `示例照片-${i + 1}（${VARIANTS[i % VARIANTS.length].label}）.png`,
      url: URL.createObjectURL(blob),
      sample: true,
    })
  }
  return out
}
