/** 每位数字员工的「长期记忆」：跨会话、跨模型永久保留（存浏览器 localStorage）
 *  解决「每次工作 / 换模型员工就变了」的问题——
 *  员工的身份 / 知识库 / 技能写在代码里（永远不会因换模型而变），
 *  而这里保留的是「他历次工作沉淀下来的经验与结论」，让同一个智能体有连续性。
 */
import type { EmployeeKB } from '@/lib/employeeKB'

export interface MemoryEntry {
  ts: number
  text: string
}

const KEY = (id: string) => `ai-office:memory:${id}`
const MAX_ENTRIES = 40
const MAX_LEN = 400

export function getMemory(id: string): MemoryEntry[] {
  try {
    const raw = localStorage.getItem(KEY(id))
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

export function addMemory(id: string, text: string): void {
  const clean = (text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_LEN)
  if (!clean) return
  const list = getMemory(id)
  list.push({ ts: Date.now(), text: clean })
  const trimmed = list.slice(-MAX_ENTRIES)
  try {
    localStorage.setItem(KEY(id), JSON.stringify(trimmed))
  } catch { /* ignore quota */ }
}

export function clearMemory(id: string): void {
  try {
    localStorage.removeItem(KEY(id))
  } catch { /* ignore */ }
}

/** 把记忆格式化成一段注入 system prompt 的文本（最近在前） */
export function memoryToText(id: string): string {
  const list = getMemory(id)
  if (list.length === 0) return ''
  return list
    .slice()
    .reverse()
    .map((e, i) => `${i + 1}. [${new Date(e.ts).toLocaleDateString('zh-CN')}] ${e.text}`)
    .join('\n')
}

/** 从一次任务的交付物里抽取一句简短记忆（去掉标题/引用行，取前两段） */
export function summarizeForMemory(kb: EmployeeKB, topic: string, title: string, output: string): string {
  const body = output
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('>') && !l.startsWith('-'))
    .slice(0, 2)
    .join(' ')
    .slice(0, 180)
  return `完成「${title}」（会议：${topic || '—'}）。${body || '已交付。'}`
}
