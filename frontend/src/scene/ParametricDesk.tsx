import { useEffect, useMemo } from 'react'
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three'
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

const METAL = '#64727B'
const WOOD = '#DFC7A3'
/** 立柱高度（米）：与床架横梁 / 床板标定一致（RoomShell 梯子亦使用 1.68） */
const POST_H = 1.68

/**
 * 参数化简化桌体（fallback 几何）：桌面板 / 桌腿 / 书架搁板 / 立柱 / 桌面出线孔。
 *
 * - 尺寸严格来自 RoomConfig（吸附面 / 碰撞边界按同一组参数计算，见 sceneValidation.ts）；
 * - 工作台中由 DormDeskModel 决策渲染 GLB 还是本回退几何；GLB 加载成功时本几何不渲染；
 * - 同时用于空间配置预览（SpacePreview3D）与交付页三维视图（DeliverViewport）的完整房间渲染。
 */
function FixedDesk({ room, hideBedParts, desktopOnly }: { room: RoomConfig; hideBedParts: boolean; desktopOnly: boolean }) {
  const group = useMemo(() => {
    const root = new Group()
    const materials = new Map<string, MeshStandardMaterial>()
    for (const part of furnitureBoxes(room)) {
      if ((desktopOnly && !part.name.startsWith('Desk_Top_')) || (hideBedParts && /^(Bed_|Guardrail_|Ladder_)/.test(part.name))) continue
      const materialName = part.name.startsWith('Desk_Top_') ? 'Mat_Pine_Natural' : 'Mat_Warm_Oak'
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
      mesh.position.set(...center)
      root.add(mesh)
    }
    prepareFurnitureAppearance(root)
    return root
  }, [room, hideBedParts, desktopOnly])
  useEffect(() => () => disposeObject3D(group), [group])
  return <primitive object={group} dispose={null} />
}

export function ParametricDesk({ room, hideBedParts = false, desktopOnly = false }: { room: RoomConfig; hideBedParts?: boolean; desktopOnly?: boolean }) {
  if (hasFixedFurniture(room)) return <FixedDesk room={room} hideBedParts={hideBedParts} desktopOnly={desktopOnly} />
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

      {/* 桌面出线孔（参数化标记；GLB 自带孔位时随模型一并替换） */}
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
