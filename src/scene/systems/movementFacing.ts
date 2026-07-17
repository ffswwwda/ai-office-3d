import type { ChibiFacing } from '@/types/agent'

/** 根据位移方向解算四向 facing */
export function resolveWalkViewFacing(dx: number, dy: number): ChibiFacing {
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx >= 0 ? 'right' : 'left'
  }
  return dy >= 0 ? 'front' : 'back'
}

export function viewFacingToLR(facing: ChibiFacing): 1 | -1 {
  if (facing === 'left') return -1
  return 1
}

/** 从当前位置朝向目标方向 */
export function talkFacingToward(
  x: number, y: number,
  tx: number, ty: number,
): { viewFacing: ChibiFacing; facing: 1 | -1 } {
  const dx = tx - x
  const dy = ty - y
  const vf = resolveWalkViewFacing(dx, dy)
  return { viewFacing: vf, facing: viewFacingToLR(vf) }
}
