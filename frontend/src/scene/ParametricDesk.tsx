import { useEffect, useLayoutEffect, useMemo } from 'react'
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import { useDrawerOffsets, useDrawerStore } from '@/state/drawerStore'
import { drawerIdForPart, type DrawerSlotId } from './dormDeskDrawers'
import { useWorkspaceStore } from '@/state/workspaceStore'
import { useOrganizeStore } from '@/state/organizeStore'
import type { RoomConfig } from '@/types/project'
import { furnitureBoxes, hasFixedFurniture } from './fixedFurniture'
import { DeskShelf } from './DeskShelf'
import { boxGeometry, standardMaterial, torusGeometry } from './resources'
import { prepareFurnitureAppearance } from './furnitureAppearance'
import { disposeObject3D } from './modelLoader'
import {
  DESK_BEAM_DEPTH,
  DESK_BEAM_INSET,
  DESK_BEAM_SECTION,
  DESK_BEAM_Z,
  DESK_GAP,
  deskBeamTopY,
} from './sceneValidation'
import { DORM_DESK_BED_NODE_PREFIXES } from './deskModel'

const METAL = '#46515A'
const WOOD = '#D1AA72'
/** 立柱高度（米）：与床架横梁 / 床板标定一致（RoomShell 梯子亦使用 1.68） */
const POST_H = 1.68

/**
 * 回退几何材质名：与 dormdesk_body.glb 的材质分配一致（核验见 frontend/docs/desk-model.md），
 * 颜色统一由 furnitureAppearance 的浅色调色板上色。
 */
const BODY_MATERIALS: Array<[RegExp, string]> = [
  [/^(Bed_Base_Board|Cabinet_Back_Wall_Outer|Desk_Back_Baffle)$/, 'Mat_Pine_Natural'],
  [/^Cabinet_Base_Kickboard$/, 'Mat_Dark_Wood'],
]
/** 抽屉分离件的材质名口径与 drawer_*.glb 一致（判定见 scripts/check-desk-model.ts） */
const DRAWER_MATERIALS: Array<[RegExp, string]> = [
  [/^(floor|wall_)/, 'Mat_Pine_Natural'],
  [/^(pull|lock_keyhole)$/, 'Mat_Dark_Wood'],
  [/^(?:rail_.*|lock_plate)$/, 'Mat_Metal_Hardware'],
]

/** 床体 / 护栏 / 爬梯：与正式模型同一剖切口径（前缀见 scene/deskModel.ts） */
function isCutawayPart(partName: string): boolean {
  const lower = partName.toLowerCase()
  return DORM_DESK_BED_NODE_PREFIXES.some((prefix) => lower.startsWith(prefix))
}

/** 回退几何材质名：桌面与板材按 GLB 同名规则，抽屉按分离件规则 */
function furnitureMaterialName(partName: string): string {
  if (partName.includes(':')) {
    const local = partName.slice(partName.lastIndexOf(':') + 1)
    return DRAWER_MATERIALS.find(([pattern]) => pattern.test(local))?.[1] ?? 'Mat_Warm_Oak'
  }
  return BODY_MATERIALS.find(([pattern]) => pattern.test(partName))?.[1] ?? 'Mat_Warm_Oak'
}

interface FixedDeskParts {
  root: Group
  /** 俯视剖切只隐藏本组（床体 / 护栏 / 爬梯） */
  cutaway: Group
  /** 三只抽屉各自成组，按统一 DrawerOffsets 平移 */
  drawers: Array<{ id: DrawerSlotId; group: Group }>
}

/** 预制箱体清单 → 回退网格（实心预制桌面按模型原样显示，不叠加第二层桌面） */
function buildFixedDesk(room: RoomConfig): FixedDeskParts {
  const root = new Group()
  const body = new Group()
  const cutaway = new Group()
  const drawers: FixedDeskParts['drawers'] = []
  const drawerGroups = new Map<DrawerSlotId, Group>()
  const materials = new Map<string, MeshStandardMaterial>()
  root.add(body, cutaway)
  for (const part of furnitureBoxes(room)) {
    const drawerId = drawerIdForPart(part.name)
    let parent = drawerId ? drawerGroups.get(drawerId) : undefined
    if (drawerId && !parent) {
      parent = new Group()
      parent.name = `drawers:${drawerId}`
      drawerGroups.set(drawerId, parent)
      drawers.push({ id: drawerId, group: parent })
      root.add(parent)
    }
    if (!parent) parent = isCutawayPart(part.name) ? cutaway : body
    const materialName = furnitureMaterialName(part.name)
    let material = materials.get(materialName)
    if (!material) {
      material = new MeshStandardMaterial({ roughness: .72 })
      material.name = materialName
      materials.set(materialName, material)
    }
    const size = part.max.map((v, i) => v - part.min[i]) as [number, number, number]
    const center = part.min.map((v, i) => (v + part.max[i]) / 2) as [number, number, number]
    const mesh = new Mesh(new BoxGeometry(...size), material)
    mesh.name = part.name
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.position.set(...center)
    parent.add(mesh)
  }
  // 共面重复面按组各自裁掉：抽屉滑动、床架隐藏后都不会露出缺面
  for (const group of [body, cutaway, ...drawers.map((entry) => entry.group)]) prepareFurnitureAppearance(group)
  return { root, cutaway, drawers }
}

/**
 * 固定家具（dormdesk-v1）回退几何：预制箱体直接建网格，保留本地浅色材质与共面裁剪，
 * 抽屉箱体按统一 DrawerOffsets 滑动并可点击开合（与 GLB 路径同一交互口径）。
 */
function FixedDesk({ room, hideBedParts }: { room: RoomConfig; hideBedParts: boolean }) {
  const offsets = useDrawerOffsets()
  const desk = useMemo(() => buildFixedDesk(room), [room])
  useLayoutEffect(() => {
    desk.cutaway.visible = !hideBedParts
  }, [desk, hideBedParts])
  useLayoutEffect(() => {
    for (const { id, group } of desk.drawers) group.position.x = offsets[id] ?? 0
  }, [desk, offsets])
  useEffect(() => () => disposeObject3D(desk.root), [desk])

  const toggleDrawer = (event: ThreeEvent<MouseEvent>) => {
    const id = drawerIdForPart(event.object.name)
    if (!id) return
    if (useWorkspaceStore.getState().mode === 'cable' || useOrganizeStore.getState().isPreviewBlocking()) return
    event.stopPropagation()
    useDrawerStore.getState().toggle(id)
  }

  return (
    <group onClick={toggleDrawer}>
      <primitive object={desk.root} dispose={null} />
    </group>
  )
}

/**
 * 简化桌体（fallback 几何）：
 * - 固定家具（`dormdesk-v1`，清单见 fixedFurniture.ts）：预制箱体 → 网格，见 FixedDesk；
 * - 旧参数化房间：桌面板 / 桌腿 / 书架搁板 / 立柱 / 桌面出线孔。
 *
 * - 尺寸严格来自 RoomConfig（吸附面 / 碰撞边界按同一组参数计算，见 sceneValidation.ts）；
 * - 工作台中由 DormDeskModel 决策渲染 GLB 还是本回退几何；GLB 加载成功时本几何不渲染；
 * - 同时用于空间配置预览（SpacePreview3D）与交付页三维视图（DeliverViewport）的完整房间渲染。
 */
export function ParametricDesk({ room, hideBedParts = false }: { room: RoomConfig; hideBedParts?: boolean }) {
  if (hasFixedFurniture(room)) return <FixedDesk room={room} hideBedParts={hideBedParts} />
  const desk = room.desk
  const deskCZ = desk.depth / 2 + DESK_GAP

  return (
    <group>
      {/* 桌面与桌腿 */}
      <mesh
        castShadow
        receiveShadow
        position={[0, desk.height - desk.thickness / 2, deskCZ]}
        geometry={boxGeometry(desk.width, desk.thickness, desk.depth)}
        material={standardMaterial(WOOD, { roughness: 0.65 })}
      />
      {[
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ].map(([sx, sz]) => (
        <mesh
          key={`${sx}${sz}`}
          castShadow
          position={[
            sx * (desk.width / 2 - 0.05),
            (desk.height - desk.thickness) / 2,
            deskCZ + sz * (desk.depth / 2 - 0.05),
          ]}
          geometry={boxGeometry(0.04, desk.height - desk.thickness, 0.04)}
          material={standardMaterial(METAL, { metalness: 0.5, roughness: 0.45 })}
        />
      ))}

      {/* 桌下横梁（排插推荐放置位）：位于桌面下方后侧，规格与 sceneValidation 的支撑面一致 */}
      <mesh
        castShadow
        position={[0, deskBeamTopY(room) - DESK_BEAM_SECTION / 2, DESK_BEAM_Z]}
        geometry={boxGeometry(desk.width - DESK_BEAM_INSET * 2, DESK_BEAM_SECTION, DESK_BEAM_DEPTH)}
        material={standardMaterial(METAL, { metalness: 0.5, roughness: 0.45 })}
      />

      {/* 书架（床板下沿的搁板）：与正式模型预览共用同一几何口径 */}
      <DeskShelf room={room} />

      {/* 四根立柱（截面相同则复用同一几何体与材质） */}
      {room.posts.map((post) => (
        <mesh
          key={post.id}
          castShadow
          position={[post.position[0], POST_H / 2, post.position[2]]}
          geometry={boxGeometry(post.section, POST_H, post.section)}
          material={standardMaterial(METAL, { metalness: 0.55, roughness: 0.4 })}
        />
      ))}

      {/* 桌面出线孔（仅旧参数化房间；固定家具 dormdesk-v1 无建模孔位，见 fixedFurniture.effectiveCableHoles） */}
      {room.cableHoles.map((hole) => (
        <mesh
          key={hole.id}
          rotation={[-Math.PI / 2, 0, 0]}
          position={hole.position}
          geometry={torusGeometry(hole.diameter / 2, 0.004, 10, 24)}
          material={standardMaterial(METAL, { metalness: 0.4, roughness: 0.5 })}
        />
      ))}
    </group>
  )
}
