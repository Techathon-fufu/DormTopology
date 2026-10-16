import { openDB, type IDBPDatabase } from 'idb'

/**
 * IndexedDB：只用于存放「大文件」——照片原图与 3D 模型文件（glb/gltf 等）。
 *
 * 约定：
 * - 项目元数据、房间配置、场景对象、布局方案等小体量 JSON 走 localStorage（zustand persist）
 * - 禁止把图片/模型二进制写入 localStorage
 * - 场景对象通过 ModelRef.assetId / RecognitionMeta.photoId 引用本库中的文件
 */

export type FileStoreName = 'photos' | 'modelFiles'

const DB_NAME = 'dormtopology-files'
const DB_VERSION = 1

let dbPromise: Promise<IDBPDatabase<unknown>> | null = null

function getDb(): Promise<IDBPDatabase<unknown>> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos')
        if (!db.objectStoreNames.contains('modelFiles')) db.createObjectStore('modelFiles')
      },
    })
  }
  return dbPromise
}

export async function putFile(store: FileStoreName, id: string, blob: Blob): Promise<void> {
  const db = await getDb()
  await db.put(store, blob, id)
}

export async function getFile(store: FileStoreName, id: string): Promise<Blob | undefined> {
  const db = await getDb()
  return (await db.get(store, id)) as Blob | undefined
}

export async function deleteFile(store: FileStoreName, id: string): Promise<void> {
  const db = await getDb()
  await db.delete(store, id)
}

export async function listKeys(store: FileStoreName): Promise<string[]> {
  const db = await getDb()
  const keys = await db.getAllKeys(store)
  return keys.map((k) => String(k))
}

/** 从 IndexedDB 读取文件并生成临时预览 URL（使用方负责 revokeObjectURL） */
export async function createPreviewUrl(store: FileStoreName, id: string): Promise<string | undefined> {
  const blob = await getFile(store, id)
  if (!blob) return undefined
  return URL.createObjectURL(blob)
}
