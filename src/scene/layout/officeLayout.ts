import type { Agent, AgentState, Desk } from '@/types/agent'

export const SCENE_WIDTH = 960
export const SCENE_HEIGHT = 640

export const COLORS = {
  floor: 0xffffff,
  wall: 0xe8e6e1,
  desk: 0xffffff,
  deskShadow: 0x00000014,
  monitor: 0x2a2a2a,
  chair: 0xd4d2cc,
  agentBody: 0x1a1a1a,
} as const

/** 7 个工位：前排 4 个 + 后排 3 个（左右居中） */
const FRONT_Y = 430
const BACK_Y = 230
export const SEAT_OFFSET_Y = 45

const FRONT_X = [160, 340, 520, 700]
const BACK_X = [250, 460, 670]

function buildDesks(): Desk[] {
  const desks: Desk[] = []
  let n = 0
  for (let i = 0; i < FRONT_X.length; i++) {
    const x = FRONT_X[i]; const y = FRONT_Y
    desks.push({
      id: `desk-${n}`,
      x, y,
      seatX: x, seatY: y + SEAT_OFFSET_Y,
    })
    n++
  }
  for (let i = 0; i < BACK_X.length; i++) {
    const x = BACK_X[i]; const y = BACK_Y
    desks.push({
      id: `desk-${n}`,
      x, y,
      seatX: x, seatY: y + SEAT_OFFSET_Y,
    })
    n++
  }
  return desks
}

export const DESKS: Desk[] = buildDesks()

export type AgentRosterEntry = {
  id: string
  name: string
  color: number
  task: string
}

/** 7 位模块同事 */
export const AGENT_ROSTER: AgentRosterEntry[] = [
  { id: 'voc',      name: '小灵', color: 0x00d4ff, task: 'VOC 智能打标' },
  { id: 'score',    name: '小分', color: 0xa855f7, task: '需求跳远评分' },
  { id: 'lab',      name: '小预', color: 0x4a90d9, task: '数字世界预测' },
  { id: 'dev',      name: '小创', color: 0xf5c542, task: '新品开发盲盒' },
  { id: 'idea',     name: '小设', color: 0xf97316, task: '抓金矿创意图' },
  { id: 'stress',   name: '小测', color: 0x34c759, task: '虚拟用户压力' },
  { id: 'pr',       name: '小展', color: 0x9b6dd7, task: '原理展厅画廊' },
]

export const INITIAL_AGENTS: Agent[] = AGENT_ROSTER.map((entry, i) => {
  const desk = DESKS[i]
  return {
    id: entry.id,
    name: entry.name,
    color: entry.color,
    gender: (i < 3 ? 'female' : 'male') as 'female' | 'male',
    x: desk.seatX, y: desk.seatY,
    state: 'working' as AgentState,
    currentTask: entry.task,
    assignedDeskId: desk.id,
    facing: i % 2 === 0 ? 1 : -1,
    viewFacing: 'back' as const,
  }
})

/** 自动工作流话术 */
export const HANDOFF_STATUS = {
  delivering: '交接递送中…',
  handingOff: '正在交接…',
  receiving: '接收交接中…',
  wrappingUp: '交接收尾中…',
  planning: '规划交接中…',
} as const

export const HANDOFF_VISIT_MESSAGES: ((hostName: string) => string)[] = [
  (n) => `${n}，这件事交给你了。`,
  (n) => `${n}，轮到你了，说明在工单里。`,
  (n) => `${n}，接力给你，上下文在线程里。`,
  (n) => `${n}，你队列里有最新的交接包。`,
  (n) => `${n}，工单已转给你，我这边解除了阻塞。`,
  (n) => `${n}，能从这里接手吗？`,
  (n) => `${n}，我这边交接完成，交给你了。`,
  (n) => `${n}，收到后请确认一下。`,
]

export function pickHandoffVisitMessage(hostName: string, hostRosterNo: number): string {
  const i = Math.abs(hostRosterNo - 1) % HANDOFF_VISIT_MESSAGES.length
  return HANDOFF_VISIT_MESSAGES[i]!(hostName)
}
