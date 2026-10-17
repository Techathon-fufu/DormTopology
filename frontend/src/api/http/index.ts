import { getFile } from '@/state/storage/idb'
import type { AppServices } from '../types'
import { ApiError } from '../core/errors'
import { runRemoteJob } from '../core/jobs'
import {
  mapCablePlanResult,
  mapLayoutPlanResult,
  mapModelGenerationResult,
  mapOrganizationResult,
  mapRecognitionResult,
  toWireItem,
  toWirePreferences,
  toWireScenePayload,
} from '../core/wire'

/**
 * 真实后端服务适配器（VITE_API_MODE=real）。
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
      async planCables({ projectId, objects, room, cables, targetIds, preferences, onProgress, signal }) {
        return runRemoteJob({
          capability: 'cable',
          projectId,
          label: targetIds && targetIds.length > 0 ? '更新走线（真实后端）' : '规划走线（真实后端）',
          body: {
            project_id: projectId,
            scene: toWireScenePayload({ projectId, objects, room, cables }),
            target_cable_ids: targetIds ?? null,
            preferences: toWirePreferences(preferences),
          },
          requestSummary: {
            objects: objects.length,
            cables: targetIds && targetIds.length > 0 ? targetIds.length : cables.length,
            preferences,
          },
          onProgress,
          signal,
          mapResult: (wire) => mapCablePlanResult(wire, { cables, room }),
        })
      },
    },

    organizationPlanning: {
      async planOrganization({ projectId, objects, room, preferences, onProgress, signal }) {
        return runRemoteJob({
          capability: 'organization',
          projectId,
          label: '生成整理方案（真实后端）',
          body: {
            project_id: projectId,
            scene: toWireScenePayload({ projectId, objects, room, cables: [] }),
            preferences: toWirePreferences(preferences),
          },
          requestSummary: { objects: objects.length, preferences },
          onProgress,
          signal,
          mapResult: (wire) => mapOrganizationResult(wire, { projectId, objects, room, preferences }),
        })
      },
    },
  }
}

/** 生产使用的真实服务实例（VITE_API_MODE=real 时由 api/index.ts 装配） */
export const httpServices: AppServices = createHttpServices()
