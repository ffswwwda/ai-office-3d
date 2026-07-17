/** 角色方向（四向） */
export type ChibiFacing = 'front' | 'back' | 'left' | 'right'

export type AgentState =
  | 'idle'
  | 'walking'
  | 'working'
  | 'talking'
  | 'thinking'
  | 'gone'

export interface DeskVisitStop {
  hostRosterNo: number
  hostAgentId: string
  hostDeskId: string
  message: string
}

export interface DeskVisitMission {
  kind: 'desk_visit'
  phase: 'goto' | 'talk' | 'return'
  hostAgentId: string
  hostDeskId: string
  message: string
  resumeTask: string
  talkDuration: number
  talkRemaining?: number
  queue: DeskVisitStop[]
}

export interface Agent {
  id: string
  name: string
  color: number
  x: number
  y: number
  targetX?: number
  targetY?: number
  walkPath?: { x: number; y: number }[]
  walkPathIndex?: number
  state: AgentState
  currentTask?: string
  assignedDeskId?: string
  bubbleText?: string
  customAnimation?: string
  facing: 1 | -1
  viewFacing?: ChibiFacing
  mission?: DeskVisitMission
}

export interface Desk {
  id: string
  x: number
  y: number
  seatX: number
  seatY: number
  occupiedBy?: string
}
