import { getFile } from '@/state/storage/idb'
import type { AppServices } from '../types'
import { ApiError, isApiError } from '../core/errors'
import { runRemoteJob } from '../core/jobs'
import { requestJson } from '../core/client'
import { canonicalScene, organizationInputSignature, packingBaseline, sceneRef, toPackingScene, type PackingScene } from '../core/packingWire'
import { knownOrganizationScene, rememberOrganizationScene, withOrganizationSceneLock } from '../core/organizationScenes'
import { synchronizeScene } from '../core/sceneSync'
import { assertRecommendedScenePlacement } from '@/lib/organizationValidation'
import { invalidateCableRoutes } from '@/scene/cables'
import { useProjectsStore } from '@/state/projectsStore'
import { useCableStore } from '@/state/cableStore'
import { cablePlanningInputSignature, mapRoutingResult, routingBaseline, toRoutingScene } from '../core/routingWire'
import {
  mapLayoutPlanResult,
  mapModelGenerationResult,
  mapOrganizationResult,
  mapRecognitionResult,
  toWireItem,
  toWireScenePayload,
} from '../core/wire'

/**
 * 后端服务适配器；规划固定使用，供应商能力由构建配置启用。
 *
 * - 所有调用统一经 core/client（超时 / 网络 / 非 2xx / JSON 异常）与 core/jobs（jobId 轮询）；
 * - 返回结果经 core/wire 本地校验后再交给界面（见 docs/api-integration.md 契约与字段缺口）；
 * - 前端不持有任何服务密钥：第三方（Rodin 等）由后端代理。
 */

/** 照片二进制读取（默认为 IndexedDB photos 表；冒烟测试可注入替身） */
export type PhotoFileLoader = (photoId: string) => Promise<Blob | undefined>

export interface HttpServiceDeps {
  loadPhotoFile?: PhotoFileLoader
}

function photoExt(blob: Blob): string {
  const type = blob.type
  if (type.includes('png')) return 'png'
  if (type.includes('webp')) return 'webp'
  if (type.includes('heic') || type.includes('heif')) return 'heic'
  return 'jpg'
}

export function createHttpServices(deps: HttpServiceDeps = {}): AppServices {
  const loadPhotoFile = deps.loadPhotoFile ?? ((id: string) => getFile('photos', id))

  return {
    mode: 'real',
    meta: {
      label: '真实后端模式',
      description:
        '识别 / 模型生成 / 规划均调用应用后端（VITE_API_MODE=real）；第三方密钥只在后端持有，前端不配置任何密钥',
    },

    recognition: {
      async recognize({ projectId, photoIds, onProgress, signal }) {
        if (photoIds.length === 0) {
          throw new ApiError('真实识别需要至少 1 张照片：请先上传照片或使用示例照片', { kind: 'input' })
        }
        const form = new FormData()
        form.append('project_id', projectId)
        for (const [index, photoId] of photoIds.entries()) {
          const blob = await loadPhotoFile(photoId)
          if (!blob) {
            throw new ApiError(`第 ${index + 1} 张照片不在本地存储中（可能已被清理），请重新上传后再识别`, {
              kind: 'input',
            })
          }
          form.append('photos', blob, `photo_${index + 1}.${photoExt(blob)}`)
        }
        return runRemoteJob({
          capability: 'recognition',
          projectId,
          label: '照片识别（真实后端）',
          form,
          requestSummary: { photos: photoIds.length },
          onProgress,
          signal,
          mapResult: (wire) => mapRecognitionResult(wire),
        })
      },
    },

    modelGeneration: {
      async generateObject({ projectId, object, attempt = 0, onProgress, signal }) {
        const res = await runRemoteJob({
          capability: 'model',
          projectId,
          label: `生成模型：${object.name}（真实后端）`,
          body: {
            project_id: projectId,
            object: toWireItem(object),
            attempt,
            photo_id: object.recognition?.photoId ?? null,
          },
          requestSummary: { object_id: object.id, attempt },
          onProgress,
          signal,
          mapResult: (wire) => mapModelGenerationResult(wire, object.id),
        })
        if (res.status === 'failed') {
          throw new ApiError(res.error ?? '后端任务报告生成失败', { kind: 'job' })
        }
        return res
      },
    },

    layoutPlanning: {
      async planLayout({ projectId, objects, room, onProgress, signal }) {
        return runRemoteJob({
          capability: 'layout',
          projectId,
          label: '布局规划（真实后端）',
          body: {
            project_id: projectId,
            scene: toWireScenePayload({ projectId, objects, room, cables: [] }),
          },
          requestSummary: { objects: objects.length },
          onProgress,
          signal,
          mapResult: (wire) => mapLayoutPlanResult(wire, { projectId, objects, room }),
        })
      },
    },

    cablePlanning: {
      async planCables({ projectId, project, baseline, confirmed = false, targetIds, onProgress, signal }) {
        if (!project || project.id !== projectId || !baseline) throw new ApiError('真实走线需要当前项目及完整整理前快照，请重新进入工作台', { kind: 'input' })
        if (targetIds && (!targetIds.length || new Set(targetIds).size !== targetIds.length || targetIds.some((id) => !project.cables.some((cable) => cable.id === id)))) throw new ApiError('待规划线缆列表包含重复或未知连接', { kind: 'input' })
        return withOrganizationSceneLock(projectId, async () => {
          const signature = cablePlanningInputSignature(project)
          const known = knownOrganizationScene(projectId)
          const scene = toRoutingScene({ project, confirmed, ref: known })
          const canonical = await synchronizeScene({ projectId, scene, baseline: routingBaseline(baseline, project, known), baselineSourceId: baseline.id, known, signal })
          const ref = sceneRef(canonical)
          rememberOrganizationScene(projectId, { ...ref, baselineSourceId: baseline.id })
          return runRemoteJob({
            capability: 'cable', projectId,
            label: targetIds ? '更新走线（真实后端）' : '规划走线（真实后端）',
            body: { scene_id: ref.sceneId, scene_revision: ref.sceneRevision, ...(targetIds ? { target_ids: targetIds } : {}) },
            requestSummary: { objects: project.objects.length, cables: project.cables.length, target_ids: targetIds ?? null, scene_revision: ref.sceneRevision },
            onProgress, signal,
            mapResult: async (wire) => {
              if (cablePlanningInputSignature(project) !== signature) throw new ApiError('走线期间场景发生变化，请重新规划', { kind: 'input' })
              const current = await requestJson<PackingScene>(`/projects/${encodeURIComponent(projectId)}/scene`, { signal })
              canonicalScene(current, canonical, ref)
              return mapRoutingResult(wire, { scene: canonical, project })
            },
          })
        })
      },
    },

    organizationPlanning: {
      async planOrganization({ projectId, objects, room, preferences, baseline, confirmed, onProgress, signal }) {
        if (!confirmed) throw new ApiError('请先核对并确认物品尺寸及整理前位置', { kind: 'input' })
        return withOrganizationSceneLock(projectId, async () => {
          const known = knownOrganizationScene(projectId)
          const input = { projectId, objects, room, preferences, confirmed, ref: known }
          const scene = toPackingScene(input)
          const baselineScene = packingBaseline(baseline, input)
          // This write replaces routing inputs and may commit even if its response is lost.
          const currentProject = useProjectsStore.getState().projects[projectId]
          if (currentProject?.cables.some((cable) => cable.route.verification)) {
            useProjectsStore.getState().update(projectId, (current) => ({
              ...current, cables: invalidateCableRoutes(current.cables),
            }))
            useCableStore.getState().resetAnim()
          }
          const canonical = await synchronizeScene({ projectId, scene, baseline: baselineScene, baselineSourceId: baseline.id, known, signal })
          const ref = sceneRef(canonical)
          rememberOrganizationScene(projectId, { ...ref, baselineSourceId: baseline.id })
          let jobId = ''
          return runRemoteJob({
            capability: 'organization',
            projectId,
            label: '生成整理方案（真实后端）',
            body: { scene_id: ref.sceneId, scene_revision: ref.sceneRevision },
            requestSummary: { objects: objects.length, preferences },
            onProgress,
            signal,
            onAccepted: (id) => { jobId = id },
            mapResult: (wire) => mapOrganizationResult(wire, { projectId, objects, room, preferences, scene: canonical, jobId }),
          })
        })
      },
      async applyOrganization({ projectId, plan, objects, room, preferences }) {
        return withOrganizationSceneLock(projectId, async () => {
          const known = knownOrganizationScene(projectId)
          const meta = plan.serviceMeta
          if (plan.projectId !== projectId || !meta || !meta.applicable || meta.status === 'infeasible' || !meta.jobId || !known || known.sceneId !== meta.sceneId || known.sceneRevision !== meta.sceneRevision || organizationInputSignature({ objects, room, preferences }) !== meta.inputSignature) throw new ApiError('整理结果已失效或不可应用，请重新生成', { kind: 'input' })
          const assignments = new Map(plan.assignments.map((a) => [a.objectId, a]))
          if (assignments.size !== objects.length || plan.assignments.length !== objects.length) throw new ApiError('整理结果物品不完整', { kind: 'input' })
          const targets = objects.map((object) => {
            const target = assignments.get(object.id)
            if (!target) throw new ApiError('整理结果引用错误', { kind: 'input' })
            return { ...object, visible: true, transform: { ...object.transform, position: target.position, rotationY: target.rotationY, bookPose: target.bookPose ?? object.transform.bookPose } }
          })
          assertRecommendedScenePlacement(targets, room, objects)
          const expected = toPackingScene({ projectId, objects: targets, room, preferences, confirmed: true, ref: known })
          const nextRef = { ...known, sceneRevision: known.sceneRevision + 1 }
          let canonical: PackingScene
          try {
            const raw = await requestJson<PackingScene>(`/jobs/${encodeURIComponent(meta.jobId)}/apply`, {
              method: 'POST', body: { scene_id: known.sceneId, scene_revision: known.sceneRevision },
            })
            canonical = canonicalScene(raw, expected, nextRef)
          } catch (error) {
            if (!isApiError(error) || !(error.kind === 'network' || error.kind === 'timeout' || error.status === 409)) throw error
            try {
              // A committed transaction can outlive a lost response. Recover only this consumed job.
              const job = await requestJson<Record<string, unknown>>(`/jobs/${encodeURIComponent(meta.jobId)}`)
              if (job.job_id !== meta.jobId || job.status !== 'succeeded' || job.applied !== true || job.scene_id !== known.sceneId || job.scene_revision !== known.sceneRevision || job.applied_scene_revision !== nextRef.sceneRevision) throw error
              const saved = await requestJson<PackingScene>(`/projects/${encodeURIComponent(projectId)}/scene`)
              canonical = canonicalScene(saved, expected, nextRef)
            } catch { throw error }
          }
          const ref = sceneRef(canonical)
          rememberOrganizationScene(projectId, { ...ref, baselineSourceId: known.baselineSourceId })
          return ref
        })
      },
    },
  }
}

/** 由 api/index.ts 装配的后端服务实例。 */
export const httpServices: AppServices = createHttpServices()
