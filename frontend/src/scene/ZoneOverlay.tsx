import { useMemo } from 'react'
import { Html } from '@react-three/drei'
import type { RoomConfig } from '@/types/project'
import { computeOrganizationZones, type ZoneRect } from '@/scene/organizationZones'
import { ZONE_COLORS, type OrganizationPreferences } from '@/types/organization'
import { basicMaterial, planeGeometry } from './resources'

/**
 * 空间整理分区参考线（三维叠加）：
 * 桌面常用区 / 打字活动区 / 水杯活动区 / 书架收纳区 / 桌下隐藏区。
 * 与规则式布局算法共用 computeOrganizationZones 的几何，保证「看到的区域 = 计算的区域」。
 */

function ZonePlane({
  rect,
  y,
  color,
  opacity,
}: {
  rect: ZoneRect
  y: number
  color: string
  opacity: number
}) {
  const w = rect.x1 - rect.x0
  const d = rect.z1 - rect.z0
  if (w <= 0.001 || d <= 0.001) return null
  return (
    <mesh
      position={[(rect.x0 + rect.x1) / 2, y, (rect.z0 + rect.z1) / 2]}
      rotation={[-Math.PI / 2, 0, 0]}
      geometry={planeGeometry(w, d)}
      material={basicMaterial(color, { opacity, doubleSide: true })}
    />
  )
}

function ZoneLabel({
  x,
  y,
  z,
  text,
  color,
}: {
  x: number
  y: number
  z: number
  text: string
  color: string
}) {
  return (
    <Html
      position={[x, y, z]}
      center
      zIndexRange={[5, 0]}
      style={{ pointerEvents: 'none' }}
    >
      <span
        className="whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[11px] font-medium shadow-xs"
        style={{ borderColor: color, color: '#26221B', background: 'rgba(255, 253, 248, 0.9)' }}
      >
        {text}
      </span>
    </Html>
  )
}

export function ZoneOverlay({
  room,
  preferences,
}: {
  room: RoomConfig
  preferences: OrganizationPreferences
}) {
  const zones = useMemo(() => computeOrganizationZones(room, preferences), [room, preferences])
  const deskColor = ZONE_COLORS.desk

  return (
    <group>
      {/* 桌面常用区：整个桌面淡底 + 打字 / 水杯活动区 */}
      <ZonePlane rect={zones.deskSurface.rect} y={zones.deskSurface.y + 0.002} color={deskColor} opacity={0.05} />
      <ZonePlane rect={zones.typing.rect} y={zones.deskSurface.y + 0.003} color={deskColor} opacity={0.16} />
      <ZoneLabel
        x={(zones.typing.rect.x0 + zones.typing.rect.x1) / 2}
        y={zones.typing.y + 0.03}
        z={(zones.typing.rect.z0 + zones.typing.rect.z1) / 2}
        text="打字活动区"
        color={deskColor}
      />
      <ZonePlane rect={zones.cup.rect} y={zones.deskSurface.y + 0.003} color="#F59E0B" opacity={0.2} />
      <ZoneLabel
        x={(zones.cup.rect.x0 + zones.cup.rect.x1) / 2}
        y={zones.cup.y + 0.03}
        z={(zones.cup.rect.z0 + zones.cup.rect.z1) / 2}
        text="水杯活动区"
        color="#F59E0B"
      />

      {/* 书架收纳区 */}
      {zones.shelf ? (
        <>
          <ZonePlane
            rect={zones.shelf.rect}
            y={zones.shelf.y + 0.002}
            color={ZONE_COLORS.shelf}
            opacity={0.14}
          />
          <ZoneLabel
            x={(zones.shelf.rect.x0 + zones.shelf.rect.x1) / 2}
            y={zones.shelf.y + 0.05}
            z={(zones.shelf.rect.z0 + zones.shelf.rect.z1) / 2}
            text="书架收纳区"
            color={ZONE_COLORS.shelf}
          />
        </>
      ) : null}

      {/* 桌下隐藏区 */}
      <ZonePlane rect={zones.underDesk.rect} y={0.002} color={ZONE_COLORS.underDesk} opacity={0.12} />
      <ZoneLabel
        x={(zones.underDesk.rect.x0 + zones.underDesk.rect.x1) / 2}
        y={0.06}
        z={(zones.underDesk.rect.z0 + zones.underDesk.rect.z1) / 2}
        text="桌下隐藏区"
        color={ZONE_COLORS.underDesk}
      />
    </group>
  )
}
