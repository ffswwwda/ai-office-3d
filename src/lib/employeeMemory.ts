/** 每位数字员工的「长期记忆」：跨会话、跨模型永久保留。
 *
 *  设计目标（见 2026-07-24 架构讨论）：
 *  - 这是「通用思考引擎」里真正差异化的部分——模型可换，记忆要能沉淀与进化。
 *  - Phase 0：抽象出统一 MemoryStore 接口 + MemoryRecord 进化单元模型，
 *    当前用 LocalStorageMemoryStore（浏览器 localStorage）实现，业务代码零改动。
 *  - 将来：新增 DbMemoryStore（Cloudflare D1 / Supabase）实现同一接口即可换后端，
 *    并在其上做 compact（碎片→偏好/观点，强化抬置信、长期不印证则衰减）。
 *  - 更远：后端为真相源，定期导出 .md 进 Obsidian 供人审阅/手改，改完回流。
 *
 *  本文件同时保留旧同步 API（getMemory/addMemory/clearMemory/memoryToText/summarizeForMemory），
 *  仅内部改为读写 MemoryRecord，调用方无需改动。
 */
import type { EmployeeKB } from '@/lib/employeeKB'

// ---------- 记忆数据模型：进化单元 ----------
export type MemoryType = 'event' | 'fact' | 'preference' | 'belief' | 'correction'

export interface MemoryRecord {
  id: string
  empId: string
  type: MemoryType
  content: string
  confidence: number // 0..1 置信度
  evidence?: string // 来源：会议主题 / 消息行号，便于溯源
  strength: number // 被强化次数（同条被多次印证→升置信）
  links?: string[] // [[其他员工]] 或话题，喂图谱
  createdAt: number
  reinforcedAt: number
}

/** 兼容旧 UI 呈现（EmployeeProfileCard 用 .ts / .text） */
export interface MemoryEntry {
  ts: number
  text: string
}

// ---------- 统一记忆存储接口（将来换后端零成本） ----------
export type MemoryInput = {
  type?: MemoryType
  content: string
  confidence?: number
  evidence?: string
  links?: string[]
  strength?: number
}

export interface MemoryStore {
  get(empId: string): Promise<MemoryRecord[]>
  add(empId: string, input: MemoryInput): Promise<MemoryRecord>
  clear(empId: string): Promise<void>
  toText(empId: string): Promise<string>
  /** 将来后端实现；local 版为 no-op 占位，便于接口完整 */
  compact?(empId: string): Promise<MemoryRecord[]>
}

const KEY = (id: string) => `ai-office:memory:${id}`
const MAX_ENTRIES = 40
const MAX_LEN = 400

const rid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

const TYPE_SHORT: Record<MemoryType, string> = {
  event: '',
  fact: '事实·',
  preference: '偏好·',
  belief: '观点·',
  correction: '纠正·',
}

// ---------- 底层读写（localStorage，同步；legacy 与 store 共用） ----------
function readRaw(id: string): MemoryRecord[] {
  try {
    const raw = localStorage.getItem(KEY(id))
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    // 兼容旧数据 {ts,text} → MemoryRecord（type=event）
    return arr.map((it: any): MemoryRecord => {
      if (it && typeof it === 'object' && 'content' in it && 'id' in it) return it as MemoryRecord
      const ts = (it && typeof it.ts === 'number' ? it.ts : Date.now()) as number
      return {
        id: rid(),
        empId: id,
        type: 'event',
        content: typeof it?.text === 'string' ? it.text : String(it ?? ''),
        confidence: 0.6,
        strength: 1,
        createdAt: ts,
        reinforcedAt: ts,
      }
    })
  } catch {
    return []
  }
}

function writeRaw(id: string, records: MemoryRecord[]): void {
  const trimmed = records.slice(-MAX_ENTRIES)
  try {
    localStorage.setItem(KEY(id), JSON.stringify(trimmed))
  } catch {
    /* ignore quota */
  }
}

/** 旧 {ts,text} → 新呈现结构（UI 用） */
function toEntry(r: MemoryRecord): MemoryEntry {
  return { ts: r.createdAt, text: `${TYPE_SHORT[r.type]}${r.content}` }
}

function formatText(records: MemoryRecord[]): string {
  if (records.length === 0) return ''
  return records
    .slice()
    .reverse()
    .map((r, i) => `${i + 1}. [${new Date(r.createdAt).toLocaleDateString('zh-CN')}] ${TYPE_SHORT[r.type]}${r.content}`)
    .join('\n')
}

// ---------- 参考实现：localStorage ----------
export class LocalStorageMemoryStore implements MemoryStore {
  async get(empId: string): Promise<MemoryRecord[]> {
    return readRaw(empId)
  }

  async add(empId: string, input: MemoryInput): Promise<MemoryRecord> {
    const now = Date.now()
    const rec: MemoryRecord = {
      id: rid(),
      empId,
      type: input.type ?? 'event',
      content: (input.content || '').replace(/\s+/g, ' ').trim().slice(0, MAX_LEN),
      confidence: input.confidence ?? 0.6,
      evidence: input.evidence,
      links: input.links,
      strength: input.strength ?? 1,
      createdAt: now,
      reinforcedAt: now,
    }
    if (!rec.content) return rec
    const list = readRaw(empId)
    list.push(rec)
    writeRaw(empId, list)
    return rec
  }

  async clear(empId: string): Promise<void> {
    try {
      localStorage.removeItem(KEY(empId))
    } catch {
      /* ignore */
    }
  }

  async toText(empId: string): Promise<string> {
    return formatText(readRaw(empId))
  }

  async compact(empId: string): Promise<MemoryRecord[]> {
    // Phase 0：local 版暂不做归纳；后端实现时在此做碎片→偏好/观点的提炼。
    return readRaw(empId)
  }
}

/** 全局默认 store。将来换后端只需把它赋值为 new DbMemoryStore(...) 即可。 */
export const memoryStore: MemoryStore = new LocalStorageMemoryStore()

// ---------- 旧同步 API（保持签名，业务代码无需改动） ----------
export function getMemory(id: string): MemoryEntry[] {
  return readRaw(id).map(toEntry)
}

export function addMemory(id: string, text: string): void {
  const clean = (text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_LEN)
  if (!clean) return
  const list = readRaw(id)
  list.push({
    id: rid(),
    empId: id,
    type: 'event',
    content: clean,
    confidence: 0.6,
    strength: 1,
    createdAt: Date.now(),
    reinforcedAt: Date.now(),
  })
  writeRaw(id, list)
}

export function clearMemory(id: string): void {
  try {
    localStorage.removeItem(KEY(id))
  } catch {
    /* ignore */
  }
}

/** 把记忆格式化成一段注入 system prompt 的文本（最近在前） */
export function memoryToText(id: string): string {
  return formatText(readRaw(id))
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

/* --- 后端迁移预留（2026-07-24 讨论结论，暂未实现）---
 * 1) DbMemoryStore implements MemoryStore，底层 Cloudflare D1（SQLite）或 Supabase。
 *    表记忆：id, empId, type, content, confidence, evidence, strength, links(JSON), createdAt, reinforcedAt。
 * 2) compact()：定时把同 empId 的 event 聚类提炼成 preference/belief；
 *    重复印证 strength++、confidence 上调；长期不印证（reinforcedAt 陈旧）衰减。
 * 3) Obsidian 操作台：exportMarkdown(empId) 生成带 frontmatter + #偏好/#观点 标签的 .md；
 *    importMarkdown(empId, md) 解析回流 DB。Local REST API 为可选常驻增强。
 */
