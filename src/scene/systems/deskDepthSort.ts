import type { Desk } from '@/types/agent'

export function computeDeskLayerZ(desk: Desk, agentPositions: { x: number; y: number }[]): number {
  let z = desk.y + 20
  for (const ap of agentPositions) {
    const dx = Math.abs(ap.x - desk.x)
    const dy = Math.abs(ap.y - desk.seatY)
    if (dx < 80 && dy < 60) {
      // 坐在工位的人应渲染在显示器之前（我们看到他的背影，显示器在身后）
      z = ap.y - 1
      break
    }
  }
  return z
}

export function computeChairLayerZ(desk: Desk, agentPositions: { x: number; y: number }[], depthAhead: number): number {
  let z = desk.y + depthAhead
  for (const ap of agentPositions) {
    const dx = Math.abs(ap.x - desk.seatX)
    const dy = Math.abs(ap.y - desk.seatY)
    if (dx < 50 && dy < 40) {
      // 椅背在坐下的人身后，渲染在人之后
      z = ap.y - 0.5
      break
    }
  }
  return z
}
