import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Info, Sparkles } from 'lucide-react'
import type { Project } from '@/types/project'
import { createDemoCables, createDemoSceneObjects, createStandardRoom } from '@/data/demoProject'
import { uid } from '@/lib/utils'
import { useProjectsStore } from '@/state/projectsStore'
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
      <div>
        <h1 className="text-xl font-semibold">新建项目</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          创建项目 → 空间配置（单位 mm，实时预览）→ 照片导入 → 三维工作台。
        </p>
      </div>

      <section className="space-y-4 rounded-lg border border-border bg-surface p-4 shadow-sm">
        <div className="space-y-1">
          <Label>项目名称</Label>
          <Input
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
            将先填充固定标准空间（上床下桌标准款），可在下一步「空间配置」中调整书架、出线孔与插座位置并实时预览。
          </p>
        </div>

        <ol className="list-decimal space-y-1 pl-5 text-[13px] text-muted-foreground">
          <li>空间配置：书架 / 出线孔 / 插座（床桌、房间与立柱为固定模型），实时三维预览与冲突校验</li>
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
            创建并载入示例物品库（直达工作台）
          </Button>
        </div>
      </section>

      <p className="text-[11px] leading-relaxed text-faint">
        只想先看看效果？首页的「示例项目」内置完整物品库与现状线缆，可随时载入对比。
      </p>
    </div>
  )
}
