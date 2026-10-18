import { OUTLET_FIXED_Y_M, type RoomConfig } from '@/types/project'

/** 默认空间：上床下桌标准款（单位：米） */
export function createFixedRoom(): RoomConfig {
  return {
    template: 'loft-standard',
    furnitureModel: 'dormdesk-v1',
    length: 2.6,
    width: 2.0,
    height: 2.7,
    desk: { width: 1.45, depth: 0.86, thickness: 0.025, height: 0.75 },
    shelf: { enabled: true, levels: 2, heightAboveDesk: 0.701, depth: 0.25 },
    posts: [
      { id: 'post-fl', position: [-0.97, 0, 0.03], section: 0.06 },
      { id: 'post-fr', position: [0.97, 0, 0.03], section: 0.06 },
      { id: 'post-bl', position: [-0.97, 0, 0.87], section: 0.06 },
      { id: 'post-br', position: [0.97, 0, 0.87], section: 0.06 },
    ],
    cableHoles: [],
    outlets: [
      { id: 'outlet-1', position: [0, OUTLET_FIXED_Y_M, 0.01], label: '后墙插座（双插孔 ×2）', slots: 2 },
    ],
    note: '固定 L 形床桌、四格书架及三抽屉；线缆经模型后沿长槽进入桌下',
  }
}

/** Every editable product project uses the same authored furniture. Keep room/outlet metadata. */
export function normalizeProductRoom(room: RoomConfig): RoomConfig {
  const fixed = createFixedRoom()
  const geometry = { template: fixed.template, furnitureModel: fixed.furnitureModel,
    desk: fixed.desk, shelf: fixed.shelf, posts: fixed.posts, cableHoles: fixed.cableHoles }
  if (Object.entries(geometry).every(([key, value]) => JSON.stringify(room[key as keyof RoomConfig]) === JSON.stringify(value))) return room
  return { ...room, ...geometry }
}
