import { useDrawerOffsets, useDrawerStore } from '@/state/drawerStore'
import { drawerIdForPart } from './dormDeskDrawers'
import { useWorkspaceStore } from '@/state/workspaceStore'
import { useOrganizeStore } from '@/state/organizeStore'
import type { RoomConfig } from '@/types/project'
import { furnitureBoxes } from './fixedFurniture'
import { boxGeometry, standardMaterial } from './resources'

const METAL = '#3A3F45'
const WOOD = '#D6B98C'
/** Temporary loading/error appearance generated from the only supported model's geometry. */
export function ParametricDesk({ room, hideBedParts = false }: { room: RoomConfig; hideBedParts?: boolean }) {
  const offsets = useDrawerOffsets()
  return <group>{furnitureBoxes(room, offsets)
    .filter((p) => (!hideBedParts || !/^(Bed_|Guardrail_|Ladder_)/.test(p.name)))
    .map((p) => <mesh key={p.name} castShadow receiveShadow onClick={(e) => {
      const id = drawerIdForPart(p.name)
      if (id && useWorkspaceStore.getState().mode !== 'cable' && !useOrganizeStore.getState().isPreviewBlocking()) {
        e.stopPropagation(); useDrawerStore.getState().toggle(id)
      }
    }}
      position={p.min.map((v, i) => (v + p.max[i]) / 2) as [number, number, number]}
      geometry={boxGeometry(p.max[0] - p.min[0], p.max[1] - p.min[1], p.max[2] - p.min[2])}
      material={standardMaterial(/^(Bed_|Guardrail_|Ladder_|Pillar_)/.test(p.name) ? METAL : WOOD, { roughness: .65 })} />)}</group>
}
