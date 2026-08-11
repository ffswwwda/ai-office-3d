import type { Agent } from '@/types/agent'

let pendingVisits: Array<{ visitor: number; host: number; message: string }> = []
let isPending = false

export function hasPendingVisitQueue(): boolean {
  return pendingVisits.length > 0 || isPending
}

export function enqueueDeskVisit(visitor: number, host: number, message: string) {
  pendingVisits.push({ visitor, host, message })
}

export function notifyVisitMissionActivity(_agents: Agent[]) {
  // 简化版：略
}

export function drainQueueIfNeeded(_agents: Agent[]): boolean {
  if (pendingVisits.length === 0) return false
  isPending = true
  // 标记已在外部消费
  return true
}
