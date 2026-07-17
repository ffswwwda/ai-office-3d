import type { Desk } from '@/types/agent'

export function computeDeskLayerZ(desk: Desk, agentPositions: { x: number; y: number }[]): number {
  let z = desk.y + 20
  for (const ap of agentPositions) {
    const dx = Math.abs(ap.x - desk.x)
    const dy = Math.abs(ap.y - desk.seatY)
    if (dx < 80 && dy < 60) {
      z = ap.y + 1
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
      z = ap.y + 0.5
      break
    }
  }
  return z
}
