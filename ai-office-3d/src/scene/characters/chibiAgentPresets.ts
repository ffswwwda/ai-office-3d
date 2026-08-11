import type { AgentState } from '@/types/agent'

/** 无 Spine 简化版 - 所有角色用 fallback 程序绘制，此文件保留接口兼容 */
export type ChibiFacing = 'front' | 'back' | 'left' | 'right'

export function resolveChibiPresetAnim(_agentId: string, _state: AgentState): string | undefined {
  return undefined
}
