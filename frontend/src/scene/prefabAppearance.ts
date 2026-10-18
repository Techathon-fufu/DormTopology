import { Color, Float32BufferAttribute, Mesh, MeshStandardMaterial, type Object3D } from 'three'

const COLORS: Record<string, string> = {
  charger: '#45535E', cup: '#8FBDAF', stainless_bottle: '#729AA6',
  tissue_box: '#EFE5D2', phone: '#354B58', mousepad: '#96AEA6',
}
const LAPTOP_COLORS: Record<string, string> = {
  base: '#AFBDC8', keyboard_deck: '#3A4C59', trackpad: '#7C909E', screen: '#304E63',
}

/** Color only the library's known untextured grey models; keep authored keyboard/mouse materials. */
export function preparePrefabAppearance(root: Object3D, id: string): void {
  root.traverse(node => {
    if (!(node instanceof Mesh) || Array.isArray(node.material) || !(node.material instanceof MeshStandardMaterial) || node.material.map) return
    const color = id === 'laptop_extend' ? LAPTOP_COLORS[node.name] : id === 'monitor' ? '#DDE5EB' : COLORS[id]
    if (!color) return
    node.material = node.material.clone()
    node.material.color.set(color)
    node.material.roughness = id === 'stainless_bottle' ? 0.4 : 0.65
    node.material.metalness = id === 'stainless_bottle' ? 0.35 : id === 'laptop_extend' ? 0.2 : 0
    if (id === 'monitor') {
      // The imported monitor has one grey material for both casing and display.
      // Tint its forward-facing panel vertices without adding any overlay surface.
      node.geometry = node.geometry.clone()
      node.geometry.computeBoundingBox()
      const box = node.geometry.boundingBox!
      const position = node.geometry.getAttribute('position')
      if (!node.geometry.getAttribute('normal')) node.geometry.computeVertexNormals()
      const normal = node.geometry.getAttribute('normal')
      const colors: number[] = []
      const white = new Color('#FFFFFF'), screen = new Color('#304E63')
      const panelBottom = box.min.y + (box.max.y - box.min.y) * 0.28
      for (let i = 0; i < position.count; i++) {
        const c = normal.getZ(i) > 0.8 && position.getY(i) > panelBottom ? screen : white
        colors.push(c.r, c.g, c.b)
      }
      node.geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
      node.material.vertexColors = true
    }
  })
}
