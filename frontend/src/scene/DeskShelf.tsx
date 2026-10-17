import type { RoomConfig } from '@/types/project'
import { boxGeometry, standardMaterial } from './resources'
import { DESK_GAP } from './sceneValidation'

const WOOD = '#D6B98C'
const SHELF_EDGE = '#C9A06A'

/**
 * 书架搁板（床板下沿的「离桌高度 / 深度」可调搁板）：几何口径与 sceneValidation 的支撑面一致。
 *
 * - 参数化桌体（ParametricDesk）内嵌渲染；
 * - 正式模型（GLB）加载时由空间配置预览（SpacePreview3D）单独叠加——模型自带的是上层四格
 *   固定书架，与这块可调搁板不是同一件东西，配置层的搁板始终以本几何反馈。
 */
export function DeskShelf({ room }: { room: RoomConfig }) {
  if (!room.shelf.enabled) return null
  const desk = room.desk
  return (
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
          material={standardMaterial(SHELF_EDGE, { roughness: 0.7 })}
        />
      ))}
    </group>
  )
}
