import type { Agent } from '@/types/agent'

let currentAgents: Agent[] = []
let listeners: Array<(agents: Agent[]) => void> = []

export function getOfficeAgents(): Agent[] {
  return currentAgents.map((a) => ({ ...a }))
}

export function setOfficeAgents(agents: Agent[]) {
  currentAgents = agents
  for (const fn of listeners) fn(currentAgents)
}

export function subscribeOfficeAgents(fn: (agents: Agent[]) => void) {
  listeners.push(fn)
  return () => { listeners = listeners.filter((l) => l !== fn) }
}
