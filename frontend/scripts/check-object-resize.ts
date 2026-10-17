/* eslint-disable no-console */
import {
  clampUniformResize,
  cornerDiagonal,
  cubeCorners,
  isBottomCorner,
  projectToPixel,
  scaleFromScreenDrag,
  type ResizeCorner,
} from '../src/scene/objectResize'

let failures = 0
function check(name: string, ok: boolean): void {
  if (!ok) {
    failures += 1
    console.error(`FAIL: ${name}`)
  } else {
    console.log(`ok: ${name}`)
  }
}

const dims = { width: 0.6, height: 0.4, depth: 0.3 }

// 8 唯一角点
const corners = cubeCorners(dims)
check('cubeCorners returns 8', corners.length === 8)
const keys = new Set(corners.map((c) => (c.corner as readonly number[]).join(',')))
check('all 8 corners unique', keys.size === 8)

// 顶点位置与尺寸一致
for (const { corner, position } of corners) {
  const [sx, sy, sz] = corner as readonly [number, number, number]
  check(`pos.x matches sign ${corner.join(',')}`, position[0] === (sx * dims.width) / 2)
  check(`pos.y matches sign ${corner.join(',')}`, position[1] === (sy * dims.height) / 2)
  check(`pos.z matches sign ${corner.join(',')}`, position[2] === (sz * dims.depth) / 2)
}

// 对角符号：底面对角 y=0，顶面 y=height
for (const { corner } of corners) {
  const diag = cornerDiagonal(dims, corner)
  const [sx, sy, sz] = corner as readonly [number, number, number]
  check(`diag.x sign ${corner.join(',')}`, diag[0] === (sx * dims.width) / 2)
  check(`diag.z sign ${corner.join(',')}`, diag[2] === (sz * dims.depth) / 2)
  check(`diag.y ${corner.join(',')}`, sy > 0 ? diag[1] === dims.height : diag[1] === 0)
  check(`isBottomCorner ${corner.join(',')}`, isBottomCorner(corner) === (sy < 0))
}

// 有符号投影：沿对角方向拖拽按比例放大
const base = { width: 1, height: 1, depth: 1 }
const correctDiag = cornerDiagonal(base, [1, 1, 1] as ResizeCorner)
check('diagonal top corner', correctDiag[1] === 1)
const screenDiagDx = 100
const screenDiagDy = 50
const scale = scaleFromScreenDrag(screenDiagDx, screenDiagDy, screenDiagDx, screenDiagDy)
check('drags along diagonal gives 2x', scale !== null && Math.abs(scale - 2) < 1e-9)
const zero = scaleFromScreenDrag(0, 0, screenDiagDx, screenDiagDy)
check('zero motion gives 1x (no resize)', zero !== null && Math.abs(zero - 1) < 1e-9)
const opposite = scaleFromScreenDrag(-screenDiagDx, -screenDiagDy, screenDiagDx, screenDiagDy)
check('opposite drag gives 0x', opposite !== null && Math.abs(opposite) < 1e-9)
const degenerate = scaleFromScreenDrag(10, 10, 0, 0)
check('degenerate diagonal returns null', degenerate === null)
const nan = scaleFromScreenDrag(Number.NaN, 0, 10, 0)
check('non-finite returns null', nan === null)

// clampUniformResize
const grown = clampUniformResize(base, 2)
check('uniform grow 2x', grown.width === 2 && grown.height === 2 && grown.depth === 2)
const negative = clampUniformResize(base, -1)
check('negative clamps to min', negative.width === 0.01)
const nanScale = clampUniformResize(base, Number.NaN)
check('NaN scale returns original', nanScale.width === 1)
const huge = clampUniformResize(base, 1e6)
check('huge clamps to max', huge.width === 5)

// projectToPixel
const proj = projectToPixel((p) => ({ x: p[0], y: p[1] }), [0, 0, 0], 200, 100)
check('project center to pixel', proj !== null && proj.x === 100 && proj.y === 50)
const badVp = projectToPixel((p) => ({ x: p[0], y: p[1] }), [0, 0, 0], 0, 0)
check('invalid viewport null', badVp === null)

if (failures > 0) {
  console.error(`${failures} check(s) failed`)
  process.exit(1)
}
console.log('object resize checks passed')
