import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Info, Sparkles } from 'lucide-react'
import type { Project } from '@/types/project'
import { createDemoCables, createDemoSceneObjects, createStandardRoom } from '@/data/demoProject'
import { uid } from '@/lib/utils'
import { useProjectsStore } from '@/state/projectsStore'
import { PageIntro } from '@/ui/layout/PageIntro'
import { DeskIllustration } from '@/ui/brand/DeskIllustration'
import { Button } from '@/ui/kit/button'
import { Input, Label } from '@/ui/kit/primitives'

/**
 * 新建项目：只填写名称并创建，空间细节在「空间配置」页编辑
 * （表单单位 mm、实时三维预览、结构冲突校验）。
 */
export function NewProjectPage() {
  const navigate = useNavigate()
  const upsert = useProjectsStore((s) => s.upsert)
  const [name, setName] = useState('我的宿舍书桌')

  const create = (withDemoObjects: boolean) => {
    const id = uid('proj')
    const now = Date.now()
    const room = createStandardRoom()
    const objects = withDemoObjects ? createDemoSceneObjects(id) : []
    const project: Project = {
      id,
      name: name.trim() || '我的宿舍书桌',
      isDemo: false,
      source: 'user',
      createdAt: now,
      updatedAt: now,
      room,
      objects,
      cables: withDemoObjects ? createDemoCables(objects, id) : [],
      stage: withDemoObjects ? 'organize' : 'space',
    }
    upsert(project)
    navigate(withDemoObjects ? `/projects/${id}/workspace` : `/projects/${id}/setup`)
  }

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <PageIntro step="新的开始" title="给你的空间起个名字" description="先创建项目，再确认桌面尺寸。照片、物品和整理方案会保存在当前浏览器。" />
      <div className="mx-auto max-w-xs rounded-xl bg-[#EEF2EB] px-6"><DeskIllustration /></div>

      <section className="space-y-5 rounded-xl border border-border bg-surface p-6 shadow-xs">
        <div className="space-y-1">
          <Label htmlFor="project-name">项目名称</Label>
          <Input
            id="project-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：3 号楼 502 书桌"
            onKeyDown={(e) => {
              if (e.key === 'Enter') create(false)
            }}
          />
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[13px] leading-relaxed text-warning">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            将先填充示例空间（桌面 <span className="font-semibold">1200 × 600 × 750 mm</span>
            ，仅为演示默认值），可在下一步「空间配置」中按实际测量修改并实时预览。
          </p>
        </div>

        <ol className="list-decimal space-y-1 pl-5 text-[13px] text-muted-foreground">
          <li>空间配置：桌面 / 房间 / 书架 / 立柱 / 出线孔与电源，实时三维预览与冲突校验</li>
          <li>照片与物品：上传或使用示例照片，确认识别物品（可编辑、可补充、可删除误识别）</li>
          <li>三维工作台：空间整理（分区归位）、规划走线、输出执行指南</li>
        </ol>

        <div className="flex flex-wrap items-center gap-3">
          <Button size="lg" onClick={() => create(false)}>
            创建并配置空间
            <ArrowRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="lg" onClick={() => create(true)}>
            <Sparkles className="h-4 w-4" />
            使用示例物品开始
          </Button>
        </div>
      </section>

      <p className="text-xs leading-relaxed text-faint">
        只想先看看效果？首页的「示例项目」内置完整物品库与现状线缆，可随时载入对比。
      </p>
    </div>
  )
}
