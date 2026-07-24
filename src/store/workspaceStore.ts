/** 工作区存储：开会生成的实时项目 + LLM(BYOK) 配置
 *  与 officeStore 同范式：内存状态 + 订阅 + localStorage 持久化。
 */
import type { Agent } from '@/types/agent'

export type TaskStatus = 'todo' | 'doing' | 'done'
export type StageStatus = 'todo' | 'doing' | 'done'

/** 任务内的执行阶段：每个阶段有明确产出，进度随时间推进 */
export interface TaskStage {
  id: string
  name: string
  outputHint: string // 该阶段会输出什么
  status: StageStatus
  output?: string
  startedAt?: number
  doneAt?: number
}

export interface ProjectTask {
  id: string
  title: string
  ownerId: string // 员工 id
  status: TaskStatus
  progress?: number // 0..100，由阶段进度折算
  output?: string
  startedAt?: number
  doneAt?: number
  stages?: TaskStage[]
}

export interface LiveProject {
  id: string
  name: string
  topic: string
  purpose: string
  status: '进行中' | '已完成'
  progress: number // 0..100
  ownerId: string
  memberIds: string[]
  tasks: ProjectTask[]
  createdAt: number
  source: 'meeting'
}

/* ───────── 实时项目 ───────── */
let liveProjects: LiveProject[] = loadProjects()
let projListeners: Array<(p: LiveProject[]) => void> = []

function loadProjects(): LiveProject[] {
  try {
    const raw = localStorage.getItem('ai-office-live-projects')
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function persistProjects() {
  try {
    localStorage.setItem('ai-office-live-projects', JSON.stringify(liveProjects))
  } catch { /* ignore quota */ }
}

export function getLiveProjects(): LiveProject[] {
  return liveProjects.map((p) => ({ ...p, tasks: p.tasks.map((t) => ({ ...t })) }))
}

export function subscribeLiveProjects(fn: (p: LiveProject[]) => void) {
  projListeners.push(fn)
  return () => { projListeners = projListeners.filter((l) => l !== fn) }
}

function emitProjects() {
  for (const fn of projListeners) fn(getLiveProjects())
}

export function addLiveProject(p: LiveProject) {
  liveProjects = [p, ...liveProjects]
  persistProjects()
  emitProjects()
}

export function updateLiveProject(id: string, patch: Partial<LiveProject>) {
  liveProjects = liveProjects.map((p) => (p.id === id ? { ...p, ...patch } : p))
  persistProjects()
  emitProjects()
}

/** 由任务数组折算整体进度：优先用各任务的 progress（阶段进度），否则退回 done 计数 */
function avgTaskProgress(tasks: ProjectTask[]): number {
  if (tasks.length === 0) return 0
  const sum = tasks.reduce((s, t) => s + (t.progress ?? (t.status === 'done' ? 100 : 0)), 0)
  return Math.round(sum / tasks.length)
}

export function updateTask(projectId: string, taskId: string, patch: Partial<ProjectTask>) {
  liveProjects = liveProjects.map((p) => {
    if (p.id !== projectId) return p
    const tasks = p.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t))
    const progress = avgTaskProgress(tasks)
    const status: LiveProject['status'] = progress >= 100 ? '已完成' : '进行中'
    return { ...p, tasks, progress, status }
  })
  persistProjects()
  emitProjects()
}

/** 更新某个任务内的单个阶段，并联动刷新任务与项目进度 */
export function updateStage(
  projectId: string, taskId: string, stageId: string, patch: Partial<TaskStage>,
) {
  liveProjects = liveProjects.map((p) => {
    if (p.id !== projectId) return p
    const tasks = p.tasks.map((t) => {
      if (t.id !== taskId) return t
      const stages = (t.stages ?? []).map((s) => (s.id === stageId ? { ...s, ...patch } : s))
      const done = stages.filter((s) => s.status === 'done').length
      const progress = stages.length
        ? Math.round((done / stages.length) * 100)
        : (t.status === 'done' ? 100 : 0)
      const status: TaskStatus = progress >= 100
        ? 'done'
        : (stages.some((s) => s.status === 'doing') ? 'doing' : 'todo')
      return { ...t, stages, progress, status }
    })
    const progress = avgTaskProgress(tasks)
    const status: LiveProject['status'] = progress >= 100 ? '已完成' : '进行中'
    return { ...p, tasks, progress, status }
  })
  persistProjects()
  emitProjects()
}

export function clearLiveProjects() {
  liveProjects = []
  persistProjects()
  emitProjects()
}

export function deleteLiveProject(id: string) {
  liveProjects = liveProjects.filter((p) => p.id !== id)
  persistProjects()
  emitProjects()
}

/* ───────── LLM(BYOK) 配置 ───────── */
export interface LLMConfig {
  key: string
  baseURL: string
  model: string
}

const LLM_KEY = 'ai-office-llm'

export function getLLMConfig(): LLMConfig {
  try {
    const raw = localStorage.getItem(LLM_KEY)
    if (raw) return { key: '', baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini', ...JSON.parse(raw) }
  } catch { /* ignore */ }
  return { key: '', baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }
}

export function setLLMConfig(cfg: Partial<LLMConfig>) {
  const next = { ...getLLMConfig(), ...cfg }
  try {
    localStorage.setItem(LLM_KEY, JSON.stringify(next))
  } catch { /* ignore */ }
}

export function isLLMEnabled(): boolean {
  return getLLMConfig().key.trim().length > 0
}
