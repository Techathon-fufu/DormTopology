import { Suspense, useEffect, useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Pause, Play, RotateCcw, SkipBack, SkipForward } from 'lucide-react'
import { useProject } from '@/state/projectsStore'
import { usePlansStore } from '@/state/plansStore'
import { CompareObjectMesh, CompareCables } from '@/scene/PlanCompareScene'
import { CameraRig } from '@/scene/CameraRig'
import { DormDeskModel } from '@/scene/DormDeskModel'
import { RoomShell } from '@/scene/RoomShell'
import { SceneLighting } from '@/scene/SceneLighting'
import { configureSceneRenderer, sceneDpr, SCENE_CAMERA_CLIP, SCENE_GL_OPTIONS } from '@/scene/renderProfile'
import { Button } from '@/ui/kit/button'
import { HoldCompareButton } from '@/ui/workspace/HoldCompareButton'
import { ThemeToggle } from '@/ui/theme/ThemeToggle'
import { validateScene } from '@/scene/sceneValidation'
import { hasUsableCableRoute } from '@/scene/cables'
import { replayObjects, replaySteps } from '@/features/replay/model'

export function ResultPage() {
  const { id } = useParams()
  const project = useProject(id)
  const before = usePlansStore((s) => s.baselines[id ?? '']?.scene)
  const [cursor, setCursor] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [held, setHeld] = useState(false)
  const [started, setStarted] = useState(false)
  const interference = useMemo(() => project ? validateScene(project.objects, project.room).size : 0, [project])
  const steps = useMemo(() => project && before ? replaySteps(before.objects, project.objects) : [], [project, before])
  useEffect(() => { setCursor(0); setPlaying(false); setStarted(false) }, [id, steps])
  useEffect(() => {
    if (!playing || held) return
    let frame = 0, last = performance.now()
    const tick = (now: number) => {
      const delta = Math.min(.08, (now - last) / 1000); last = now
      setCursor((value) => Math.min(steps.length, value + delta / 2.4))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, held, steps.length])
  useEffect(() => { if (cursor >= steps.length) setPlaying(false) }, [cursor, steps.length])
  if (!project) return <div className="p-8"><Link to="/">项目不存在，返回首页</Link></div>
  const done = cursor >= steps.length
  const objects = held && before ? before.objects : started && before ? replayObjects(before.objects, steps, cursor) : project.objects
  const room = held && before ? before.room : project.room
  const cables = held && before ? before.cables : !started || done ? project.cables : []
  const active = started && !done ? steps[Math.floor(cursor)] : undefined
  const play = () => { setStarted(true); if (done) setCursor(0); setPlaying(!playing || done) }
  return <div className="flex h-full min-h-0 flex-col bg-background">
    <header className="flex flex-wrap items-center gap-3 border-b border-border bg-surface px-6 py-3">
      <Link to={`/projects/${project.id}/workspace`} className="flex items-center gap-1 text-xs text-primary"><ArrowLeft className="h-4 w-4" />工作台</Link>
      <div className="min-w-0 flex-1"><h1 className="truncate text-sm font-semibold">{project.name}</h1><p className="text-xs text-muted-foreground">看一步，整理一件。</p></div>
      <HoldCompareButton onChange={setHeld} disabled={!before} />
      <ThemeToggle />
    </header>
    <main className="relative min-h-0 flex-1" aria-label="整理动画场景">
      <Canvas
        shadows
        gl={SCENE_GL_OPTIONS}
        dpr={sceneDpr()}
        camera={{ position: [1.9, 1.6, 2.6], fov: 42, ...SCENE_CAMERA_CLIP }}
        onCreated={({ gl }) => configureSceneRenderer(gl)}
      >
        <SceneLighting />
        <Suspense fallback={null}>
          <RoomShell room={room} deskMode="none" showBed={false} />
          <DormDeskModel room={room} hideBedParts respectToolbar={false} />
          {objects.map((object) => <CompareObjectMesh key={object.id} object={object} zoneTint={false} diff={object.id === active?.id} />)}
          <CompareCables cables={cables} objects={objects} diffIds={new Set()} />
        </Suspense>
        <CameraRig preset="desk" zoomOut={1.2} furnitureModel={room.furnitureModel} />
      </Canvas>
      <span className="pointer-events-none absolute left-3 top-3 rounded-lg bg-surface/95 px-3 py-2 text-xs shadow-sm">{held ? '摆放前 · 松开返回' : active ? `${active.after ? active.before ? '移动' : '放入' : '移出'}：${active.name}` : '当前摆放效果'}</span>
    </main>
    <footer className="space-y-3 border-t border-border bg-surface px-6 py-4">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 text-sm"><p className="font-medium">{!before ? '还没有摆放前记录' : !steps.length ? '暂时没有需要演示的调整' : active ? active.name : started ? '演示已结束' : '跟着动画整理'}</p><p className="mt-1 text-xs text-muted-foreground">{steps.length ? `第 ${Math.min(steps.length, Math.floor(cursor) + 1)} / ${steps.length} 步 · 可随时暂停` : '返回工作台调整摆放后，再来看效果。'}</p></div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" aria-label="上一步" disabled={!started || cursor <= 0} onClick={() => { setPlaying(false); setCursor(Math.max(0, Math.ceil(cursor) - 1)) }}><SkipBack className="h-4 w-4" /></Button>
          <Button disabled={!steps.length || held} onClick={play}>{playing ? <Pause className="h-4 w-4" /> : done && started ? <RotateCcw className="h-4 w-4" /> : <Play className="h-4 w-4" />}{playing ? '暂停' : done && started ? '重新播放' : started ? '继续播放' : '播放整理动画'}</Button>
          <Button variant="ghost" size="icon" aria-label="下一步" disabled={!steps.length || done} onClick={() => { setStarted(true); setPlaying(false); setCursor(Math.min(steps.length, Math.floor(cursor) + 1)) }}><SkipForward className="h-4 w-4" /></Button>
        </div>
      </div>
      {(interference > 0 || project.cables.some((c) => !hasUsableCableRoute(c))) && <p className="mx-auto max-w-3xl text-xs text-warning">{interference > 0 ? `${interference} 件物品需调整摆放。` : ''}{project.cables.some((c) => !hasUsableCableRoute(c)) ? '部分线缆待规划，暂不展示无效路径。' : ''}可返回工作台处理。</p>}
      {steps.length > 0 && <progress aria-label="整理动画进度" className="playback-progress mx-auto block h-1 w-full max-w-3xl" max={steps.length} value={cursor} />}
    </footer>
  </div>
}
