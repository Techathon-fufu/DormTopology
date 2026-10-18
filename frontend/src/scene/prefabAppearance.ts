import { Color, Float32BufferAttribute, Mesh, MeshStandardMaterial, type Object3D } from 'three'

const COLORS: Record<string, string> = {
  charger: '#3D4852', cup: '#4F887D', stainless_bottle: '#4F7180',
  tissue_box: '#C7A36E', phone: '#253844', mousepad: '#5E7770', books_stack: '#8F6E54',
}
const LAPTOP_COLORS: Record<string, string> = {
  base: '#7F909D', keyboard_deck: '#263640', trackpad: '#566B78', screen: '#101B23',
}

/** Color only the library's known untextured grey models; keep authored keyboard/mouse materials. */
export function preparePrefabAppearance(root: Object3D, id: string): void {
  root.traverse(node => {
    if (!(node instanceof Mesh) || Array.isArray(node.material) || !(node.material instanceof MeshStandardMaterial) || node.material.map) return
    const color = id === 'laptop_extend' ? LAPTOP_COLORS[node.name] : id === 'monitor' ? '#28343D' : COLORS[id]
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
      const casing = new Color('#28343D'), screen = new Color('#101B23')
      const panelBottom = box.min.y + (box.max.y - box.min.y) * 0.28
      for (let i = 0; i < position.count; i++) {
        const c = normal.getZ(i) > 0.8 && position.getY(i) > panelBottom ? screen : casing
        colors.push(c.r, c.g, c.b)
      }
      node.geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
      node.material.vertexColors = true
    }
  })
}
