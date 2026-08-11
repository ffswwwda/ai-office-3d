import type { Agent, DeskVisitMission, DeskVisitStop } from '@/types/agent'
import { AGENT_ROSTER, DESKS, pickHandoffVisitMessage } from '@/scene/layout/officeLayout'
import { MovementSystem } from '@/scene/systems/MovementSystem'
import type { AgentEntity } from '@/scene/entities/AgentEntity'
import { talkFacingToward } from '@/scene/systems/movementFacing'

export type DeskVisitMessageFn = (hostName: string, hostRosterNo: number) => string

export function agentHasActiveMission(agent: Agent): boolean {
  if (!agent.mission) return false
  if (agent.mission.kind === 'desk_visit') {
    return agent.mission.phase !== undefined
  }
  return false
}

export function buildPathTo(agent: Agent, tx: number, ty: number): { x: number; y: number }[] {
  const midY = (agent.y + ty) / 2
  return [
    { x: agent.x, y: midY + 20 },
    { x: tx, y: midY + 20 },
    { x: tx, y: ty },
  ]
}

/** 工位拜访路径 */
export function buildPathToDesk(agent: Agent, hostRosterNo: number): { x: number; y: number }[] {
  const desk = DESKS[hostRosterNo - 1]
  if (!desk) return []
  return buildPathTo(agent, desk.seatX, desk.seatY)
}

export function startDeskVisit(
  agents: Agent[],
  visitorRosterNo: number,
  hostRosterNo: number,
  message: string,
): Agent[] {
  const visitor = agents[visitorRosterNo - 1]
  const host = agents[hostRosterNo - 1]
  if (!visitor || !host || visitor.id === host.id) return agents

  const hostDesk = DESKS[hostRosterNo - 1]
  if (!hostDesk) return agents

  const path = buildPathToDesk(visitor, hostRosterNo)
  const visited: Agent[] = []

  const mission: DeskVisitMission = {
    kind: 'desk_visit',
    phase: 'goto',
    hostAgentId: host.id,
    hostDeskId: hostDesk.id,
    message,
    resumeTask: visitor.currentTask ?? '',
    talkDuration: 3,
    talkRemaining: 3,
    queue: [],
  }

  visited.push({
    ...MovementSystem.assignWalkPath(visitor, path),
    mission,
    bubbleText: message,
  })

  visited.push({
    ...host,
    // host 暂时在座位上 -> talking facing
  })

  // 合并：保留未在 visited 中的 agents
  const visitedIds = new Set(visited.map((a) => a.id))
  const remaining = agents.filter((a) => !visitedIds.has(a.id))
  return [...remaining, ...visited]
}

export function startDeskVisitTour(
  agents: Agent[],
  visitorRosterNo: number,
  hostRosterNos: number[],
  messageFn: DeskVisitMessageFn = pickHandoffVisitMessage,
): Agent[] {
  if (hostRosterNos.length === 0) return agents

  const visitor = agents[visitorRosterNo - 1]
  if (!visitor) return agents

  const firstHost = agents[hostRosterNos[0] - 1]
  if (!firstHost) return agents

  const firstDesk = DESKS[hostRosterNos[0] - 1]
  if (!firstDesk) return agents

  const queue: DeskVisitStop[] = hostRosterNos.slice(1).map((no) => {
    const h = agents[no - 1]
    const d = DESKS[no - 1]
    return {
      hostRosterNo: no,
      hostAgentId: h?.id ?? '',
      hostDeskId: d?.id ?? '',
      message: messageFn(h?.name ?? `#${no}`, no),
    }
  })

  const firstMessage = messageFn(firstHost.name, hostRosterNos[0])
  const path = buildPathToDesk(visitor, hostRosterNos[0])

  const mission: DeskVisitMission = {
    kind: 'desk_visit',
    phase: 'goto',
    hostAgentId: firstHost.id,
    hostDeskId: firstDesk.id,
    message: firstMessage,
    resumeTask: visitor.currentTask ?? '',
    talkDuration: 2.5,
    talkRemaining: 2.5,
    queue,
  }

  const visited: Agent[] = [{
    ...MovementSystem.assignWalkPath(visitor, path),
    mission,
    bubbleText: firstMessage,
  }]

  const visitedIds = new Set(visited.map((a) => a.id))
  const remaining = agents.filter((a) => !visitedIds.has(a.id))
  return [...remaining, ...visited]
}

export function processDeskVisitMissions(
  dt: number,
  agents: Agent[],
  entities: Map<string, AgentEntity>,
): Agent[] {
  return agents.map((agent) => {
    if (!agent.mission || agent.mission.kind !== 'desk_visit') return agent

    const m = agent.mission

    if (m.phase === 'goto') {
      if (agent.state !== 'walking') {
        // 已到达→进入谈话
        const hostEntity = entities.get(m.hostAgentId)
        if (hostEntity) {
          hostEntity.showBubble(m.message, m.talkDuration)
        }
        return {
          ...agent,
          mission: { ...m, phase: 'talk', talkRemaining: m.talkDuration },
          state: 'talking',
          currentTask: undefined,
          targetX: undefined, targetY: undefined,
          walkPath: undefined, walkPathIndex: undefined,
          viewFacing: 'front',
          facing: 1,
        }
      }
      return agent
    }

    if (m.phase === 'talk') {
      const remaining = (m.talkRemaining ?? m.talkDuration) - dt
      if (remaining > 0) {
        return {
          ...agent,
          mission: { ...m, talkRemaining: remaining },
        }
      }
      // 谈话结束
      if (m.queue.length > 0) {
        // 还有下一站
        const next = m.queue[0]
        const nextAgent = agents.find((a) => a.id === next.hostAgentId)
        if (!nextAgent) {
          // 找不到下一个目标，回座
          return returnToDesk(agent)
        }
        const nextDesk = DESKS.find((d) => d.id === next.hostDeskId)
        if (!nextDesk) return returnToDesk(agent)

        const path = buildPathToDesk(agent, next.hostRosterNo)
        return {
          ...MovementSystem.assignWalkPath(
            { ...agent, x: agent.x, y: agent.y },
            path,
          ),
          mission: {
            ...m,
            phase: 'goto',
            hostAgentId: next.hostAgentId,
            hostDeskId: next.hostDeskId,
            message: next.message,
            talkDuration: 2.5,
            talkRemaining: 2.5,
            queue: m.queue.slice(1),
          },
          bubbleText: next.message,
        }
      }
      // 全部完成→回座
      return returnToDesk(agent)
    }

    if (m.phase === 'return') {
      if (agent.state !== 'walking') {
        // 已回座
        return {
          ...agent,
          mission: undefined,
          state: 'working',
          currentTask: m.resumeTask,
          viewFacing: 'back',
          facing: 1,
          targetX: undefined, targetY: undefined,
          walkPath: undefined, walkPathIndex: undefined,
          bubbleText: undefined,
        }
      }
      return agent
    }

    return agent
  })
}

function returnToDesk(agent: Agent): Agent {
  const desk = DESKS.find((d) => d.id === agent.assignedDeskId)
  if (!desk) return { ...agent, mission: undefined, state: 'idle' }

  const path = buildPathTo(agent, desk.seatX, desk.seatY)
  return {
    ...MovementSystem.assignWalkPath(agent, path),
    mission: agent.mission ? { ...agent.mission, phase: 'return' } : undefined,
    bubbleText: '回去了',
  }
}
