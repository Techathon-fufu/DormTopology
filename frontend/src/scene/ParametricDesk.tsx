import type { RoomConfig } from '@/types/project'
import { boxGeometry, standardMaterial, torusGeometry } from './resources'
import {
  DESK_BEAM_DEPTH,
  DESK_BEAM_INSET,
  DESK_BEAM_SECTION,
  DESK_BEAM_Z,
  DESK_GAP,
  deskBeamTopY,
} from './sceneValidation'

const METAL = '#3A3F45'
const WOOD = '#D6B98C'
/** 立柱高度（米）：与床架横梁 / 床板标定一致（RoomShell 梯子亦使用 1.68） */
const POST_H = 1.68

/**
 * 参数化简化桌体（fallback 几何）：桌面板 / 桌腿 / 书架搁板 / 立柱 / 桌面出线孔。
 *
 * - 尺寸严格来自 RoomConfig（吸附面 / 碰撞边界按同一组参数计算，见 sceneValidation.ts）；
 * - 工作台中由 DormDeskModel 决策渲染 GLB 还是本回退几何；GLB 加载成功时本几何不渲染；
 * - 同时用于空间配置预览（SpacePreview3D）与交付页三维视图（DeliverViewport）的完整房间渲染。
 */
export function ParametricDesk({ room }: { room: RoomConfig }) {
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

      {/* 书架（床板下沿的搁板） */}
      {room.shelf.enabled ? (
        <group>
          <mesh
            castShadow
            position={[0, desk.height + room.shelf.heightAboveDesk, DESK_GAP + room.shelf.depth / 2]}
            geometry={boxGeometry(desk.width - 0.2, 0.018, room.shelf.depth)}
            material={standardMaterial(WOOD, { roughness: 0.65 })}
          />
          {[-1, 1].map((sx) => (
            <mesh
              key={sx}
              position={[
                sx * (desk.width / 2 - 0.12),
                desk.height + room.shelf.heightAboveDesk / 2,
                DESK_GAP + room.shelf.depth / 2,
              ]}
              geometry={boxGeometry(0.016, room.shelf.heightAboveDesk, room.shelf.depth)}
              material={standardMaterial('#C9A06A', { roughness: 0.7 })}
            />
          ))}
        </group>
      ) : null}

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
