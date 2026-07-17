import { AGENT_ROSTER } from '@/scene/layout/officeLayout'
import type { Agent } from '@/types/agent'

export const APP_NAME = 'AI 办公全景'

export const QUICK_TOOLS = [
  { icon: '📊', label: 'VOC看板' },
  { icon: '📝', label: '新品开发' },
  { icon: '🎨', label: '创意生成' },
  { icon: '🔬', label: '压力测试' },
]

export const OFFICE_ACTIONS_URL = 'http://localhost:8765/actions'

export const AGENT_LABEL_MAP: Record<string, { emoji: string }> = {}
AGENT_ROSTER.forEach((r) => {
  AGENT_LABEL_MAP[r.id] = { emoji: '🧑‍💼' }
})
