import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Sparkles } from 'lucide-react'
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
      <PageIntro step="创建项目" title="给你的项目起个名字" description="确认空间、添加物品后，自动进入工作台。项目保存在当前浏览器。" />
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

        <p className="text-sm leading-6 text-muted-foreground">使用标准宿舍桌体，确认尺寸后添加照片或物品。</p>

        <div className="flex flex-wrap items-center gap-3">
          <Button size="lg" onClick={() => create(false)}>
            下一步：确认空间
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
