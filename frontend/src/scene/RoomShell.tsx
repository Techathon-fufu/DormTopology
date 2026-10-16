import { Grid } from '@react-three/drei'
import type { RoomConfig } from '@/types/project'
import { boxGeometry, standardMaterial, torusGeometry } from './resources'

const WALL = '#EFECE6'
const FLOOR = '#E9E4DB'
const METAL = '#3A3F45'
const WOOD = '#D6B98C'

/**
 * 上床下桌结构 + 地面/墙面 + 出线孔/电源标记。
 * 坐标约定：后墙位于 z = 0，房间向 +z 展开，x 以桌面中心为 0（米）。
 * 所有部件使用共享几何体 / 材质缓存（立柱、桌腿、横梁等重复件只创建一次）。
 */
export function RoomShell({
  room,
}: {
  room: RoomConfig
}) {
  const L = room.length
  const D = room.width
  const H = room.height
  const desk = room.desk
  const deskCZ = desk.depth / 2 + 0.05
  const postH = 1.68

  // 床架随立柱布置自适应（立柱即床架支点；不足四根时退回示例跨度 1.9 × 0.9）
  const postXs = room.posts.map((p) => Math.abs(p.position[0]))
  const postZs = room.posts.map((p) => p.position[2])
  const bedHalfX = postXs.length > 0 ? Math.max(...postXs) : 0.95
  const usePostSpan =
    postZs.length >= 4 && Math.max(...postZs) - Math.min(...postZs) > 0.4
  const bedZ0 = usePostSpan ? Math.min(...postZs) : 0.02
  const bedZ1 = usePostSpan ? Math.max(...postZs) : 0.88
  const bedZX = (bedZ0 + bedZ1) / 2
  const bedD = bedZ1 - bedZ0

  const wallMat = standardMaterial(WALL, { roughness: 0.95 })
  const frameMat = standardMaterial(METAL, { metalness: 0.5, roughness: 0.45 })

  return (
    <group>
      {/* 地面 / 后墙 / 左墙 */}
      <mesh
        receiveShadow
        position={[0, -0.01, D / 2]}
        geometry={boxGeometry(L, 0.02, D)}
        material={standardMaterial(FLOOR, { roughness: 0.9 })}
      />
      <mesh
        receiveShadow
        position={[0, H / 2, -0.025]}
        geometry={boxGeometry(L, H, 0.05)}
        material={wallMat}
      />
      <mesh
        receiveShadow
        position={[-L / 2 - 0.025, H / 2, D / 2]}
        geometry={boxGeometry(0.05, H, D)}
        material={wallMat}
      />
      <Grid
        position={[0, 0.004, D / 2]}
        args={[L, D]}
        cellSize={0.1}
        sectionSize={0.5}
        cellColor="#DCD6C9"
        sectionColor="#CFC7B6"
        fadeDistance={9}
        fadeStrength={1.4}
      />

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
          material={frameMat}
        />
      ))}

      {/* 书架（床板下沿的搁板） */}
      {room.shelf.enabled ? (
        <group>
          <mesh
            castShadow
            position={[0, desk.height + room.shelf.heightAboveDesk, 0.05 + room.shelf.depth / 2]}
            geometry={boxGeometry(desk.width - 0.2, 0.018, room.shelf.depth)}
            material={standardMaterial(WOOD, { roughness: 0.65 })}
          />
          {[-1, 1].map((sx) => (
            <mesh
              key={sx}
              position={[
                sx * (desk.width / 2 - 0.12),
                desk.height + room.shelf.heightAboveDesk / 2,
                0.05 + room.shelf.depth / 2,
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
          position={[post.position[0], postH / 2, post.position[2]]}
          geometry={boxGeometry(post.section, postH, post.section)}
          material={standardMaterial(METAL, { metalness: 0.55, roughness: 0.4 })}
        />
      ))}

      {/* 床架横梁（位于床板下方，跨度随立柱位置自适应） */}
      {[bedZ0 + 0.02, bedZ1 - 0.02].map((z) => (
        <mesh
          key={`beam-${z}`}
          castShadow
          position={[0, 1.62 - 0.037, z]}
          geometry={boxGeometry(bedHalfX * 2, 0.07, 0.05)}
          material={standardMaterial(METAL, { metalness: 0.55, roughness: 0.4 })}
        />
      ))}
      {[-bedHalfX, bedHalfX].map((x) => (
        <mesh
          key={`rail-${x}`}
          castShadow
          position={[x, 1.62 - 0.037, bedZX]}
          geometry={boxGeometry(0.05, 0.07, bedD)}
          material={standardMaterial(METAL, { metalness: 0.55, roughness: 0.4 })}
        />
      ))}

      {/* 床板 / 床垫 / 被子 / 护栏（随床架自适应） */}
      <mesh
        castShadow
        receiveShadow
        position={[0, 1.62, bedZX]}
        geometry={boxGeometry(bedHalfX * 2, 0.045, bedD)}
        material={standardMaterial('#C9A06A', { roughness: 0.7 })}
      />
      <mesh
        castShadow
        position={[0, 1.72, bedZX]}
        geometry={boxGeometry(Math.max(0.6, bedHalfX * 2 - 0.06), 0.14, Math.max(0.5, bedD - 0.06))}
        material={standardMaterial('#EDE8DC', { roughness: 0.9 })}
      />
      <mesh
        castShadow
        position={[bedHalfX * 0.35, 1.78, bedZX]}
        geometry={boxGeometry(Math.max(0.5, bedHalfX - 0.05), 0.08, Math.max(0.4, bedD - 0.1))}
        material={standardMaterial('#C9DED8', { roughness: 0.95 })}
      />
      <mesh
        castShadow
        position={[0, 1.88, bedZ1 - 0.015]}
        geometry={boxGeometry(bedHalfX * 2, 0.2, 0.025)}
        material={standardMaterial(METAL, { metalness: 0.5, roughness: 0.45 })}
      />

      {/* 梯子（挂在床架外侧） */}
      {[bedZX - 0.12, bedZX + 0.12].map((z) => (
        <mesh
          key={`ladder-${z}`}
          castShadow
          position={[bedHalfX + 0.09, postH / 2, z]}
          geometry={boxGeometry(0.025, postH, 0.025)}
          material={frameMat}
        />
      ))}
      {[0.35, 0.75, 1.15, 1.55].map((y) => (
        <mesh
          key={`rung-${y}`}
          castShadow
          position={[bedHalfX + 0.09, y, bedZX]}
          geometry={boxGeometry(0.03, 0.03, 0.26)}
          material={frameMat}
        />
      ))}

      {/* 桌面出线孔 */}
      {room.cableHoles.map((hole) => (
        <mesh
          key={hole.id}
          rotation={[-Math.PI / 2, 0, 0]}
          position={hole.position}
          geometry={torusGeometry(hole.diameter / 2, 0.004, 10, 24)}
          material={standardMaterial(METAL, { metalness: 0.4, roughness: 0.5 })}
        />
      ))}

      {/* 墙面电源插座 */}
      {room.outlets.map((outlet) => (
        <group key={outlet.id} position={outlet.position}>
          <mesh
            castShadow
            geometry={boxGeometry(0.086, 0.086, 0.018)}
            material={standardMaterial('#F5F2EC', { roughness: 0.6 })}
          />
          {[-0.02, 0.02].map((dx) => (
            <mesh
              key={dx}
              position={[dx, 0, 0.012]}
              geometry={boxGeometry(0.014, 0.022, 0.004)}
              material={standardMaterial('#4A5560')}
            />
          ))}
        </group>
      ))}
    </group>
  )
}
