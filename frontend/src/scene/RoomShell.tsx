import { Grid } from '@react-three/drei'
import type { RoomConfig } from '@/types/project'
import { ParametricDesk } from './ParametricDesk'
import { boxGeometry, standardMaterial } from './resources'

const WALL = '#EFECE6'
const FLOOR = '#E9E4DB'
const METAL = '#3A3F45'

/**
 * 房间外壳与床架结构：地面 / 墙面 / 网格 + 床架横梁 / 床板 / 梯子 + 墙面插座。
 * 坐标约定：后墙位于 z = 0，房间向 +z 展开，x 以桌面中心为 0（米）。
 * 桌体（桌面 / 桌腿 / 书架搁板 / 立柱 / 出线孔）拆分为 ParametricDesk：
 * - deskMode='parametric'（默认）：与既有一致（空间配置预览 / 交付页三维视图沿用）；
 * - deskMode='none'：工作台视口使用，桌体由 DormDeskModel 决策渲染 GLB 或回退参数化几何。
 * 所有部件使用共享几何体 / 材质缓存（横梁、梯子横档等重复件只创建一次）。
 */
export function RoomShell({
  room,
  deskMode = 'parametric',
}: {
  room: RoomConfig
  /** 'parametric' 渲染参数化桌体（默认）；'none' 不渲染桌体（由 DormDeskModel 接管） */
  deskMode?: 'parametric' | 'none'
}) {
  const L = room.length
  const D = room.width
  const H = room.height
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

      {/* 桌体（参数化简化几何）：工作台由 DormDeskModel 接管；桌面 / 桌腿 / 书架 / 立柱 / 出线孔见 ParametricDesk */}
      {deskMode === 'parametric' ? <ParametricDesk room={room} /> : null}

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
