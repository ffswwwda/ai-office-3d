import { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { AGENT_ROSTER } from '@/scene/layout/officeLayout'
import { kbOf, composeSystemPrompt, DATA_SOURCE_REGISTRY } from '@/lib/employeeKB'
import { memoryStore } from '@/lib/employeeMemory'
import { streamChat } from '@/lib/llm'
import { normalizePunct } from '@/lib/meetingEngine'
import { tagComment, VOC_DIMENSION_NAMES, type VocTagResult } from '@/lib/vocTagger'

function SvgIcon({ id, size = 14 }: { id: string; size?: number }) {
  return <svg viewBox="0 0 24 24" width={size} height={size}><use href={'#' + id} /></svg>
}

const rid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

const colorHex = (id: string) => {
  const c = AGENT_ROSTER.find((r) => r.id === id)?.color ?? 0x00d4ff
  return '#' + c.toString(16).padStart(6, '0')
}

/** 小灵 VOC 自动演示用的真实感评论样本（覆盖多维度） */
const VOC_SAMPLES = [
  '第一次买这种东西，说实话有点害羞，怕室友听见声音，但晚上一个人用真的挺放松的。',
  '出差住酒店带着很方便，小巧不占地方，就是充电有点麻烦。',
  '用了半年一直回购，静音做得好，老公都没发现，材质也舒服。',
  '充电口接触不良充不进电，客服让我退货，体验很差，再也不买了。',
  '朋友推荐的，种草很久终于下手，颜值在线质感也不错，爱了。',
  '要是能多几档力度就好了，现在只有强弱两档，老人家用着不太顺手。',
]

const SENTIMENT_COLOR: Record<string, string> = {
  正面: '#34c759',
  中性: '#9aa0b4',
  负面: '#ff6b9d',
}

type ChatLine = { role: 'user' | 'emp'; text: string; images?: string[]; file?: UserFile; job?: TagJob }
type VocRow = { id: string; text: string; result: VocTagResult }
type UserFile = { name: string; type: string; size: number; dataUrl?: string; content?: string }
type TagConfig = {
  limit?: number
  dimensions?: string[]
  sentimentFilter?: string[]
  instruction?: string
}
type TagJob = {
  id: string
  fileName: string
  total: number
  current: number
  currentDim: number
  rows: VocRow[]
  done: boolean
  cancelled: boolean
  config: TagConfig
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

const readFileAsText = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = reject
    reader.readAsText(file)
  })

const readFileAsDataURL = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = reject
    reader.readAsDataURL(file)
  })

/** 简单 CSV / TSV / 换行文本解析：优先把每行当一条评论；若第一行像表头则尝试找「评论」列。 */
function parseCommentRows(raw: string): string[] {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  if (lines.length === 0) return []
  const first = lines[0]
  const headerKeywords = ['评论', '内容', 'review', 'content', 'text', '评价', '原文', '用户反馈', 'feedback']
  const looksHeader = headerKeywords.some((k) => first.toLowerCase().includes(k.toLowerCase()))
  if (!looksHeader) return lines

  // 尝试按逗号/制表符拆分表头，找文本列
  const sep = first.includes('\t') ? '\t' : ','
  const headers = first.split(sep).map((h) => h.trim().replace(/^["']|["']$/g, ''))
  let colIdx = headers.findIndex((h) => headerKeywords.some((k) => h.toLowerCase().includes(k.toLowerCase())))
  if (colIdx < 0) colIdx = 0
  return lines
    .slice(1)
    .map((line) => {
      const cols = line.split(sep).map((c) => c.trim().replace(/^["']|["']$/g, ''))
      return cols[colIdx] ?? ''
    })
    .filter(Boolean)
}

const isImageFile = (f: File) => /^image\//.test(f.type)
const isTableFile = (f: File) =>
  f.type === 'text/csv' || f.type === 'text/tab-separated-values' || f.type === 'text/plain' ||
  /\.(csv|tsv|txt)$/i.test(f.name)

const isTableFileByName = (name: string) => /\.(csv|tsv|txt)$/i.test(name)

/** 把常见中文数字（一~九十九）转成阿拉伯数字；阿拉伯数字串直接返回 */
function parseChineseNumber(s: string): number | null {
  if (!s) return null
  if (/^\d+$/.test(s)) return parseInt(s, 10)
  const map: Record<string, number> = {
    一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  }
  if (s === '十') return 10
  if (s.startsWith('十')) return 10 + (map[s.slice(1)] ?? 0)
  if (s.endsWith('十')) return (map[s.slice(0, -1)] ?? 0) * 10
  if (s.includes('十')) {
    const [a, b] = s.split('十')
    return (map[a] ?? 0) * 10 + (map[b] ?? 0)
  }
  if (map[s] !== undefined) return map[s]
  return null
}

/** 从用户文字指令里提取批量打标配置（条数 / 维度 / 情感过滤） */
function parseTagInstruction(text: string): TagConfig {
  const cfg: TagConfig = { instruction: text.trim() || undefined }
  if (!text) return cfg

  // 数量：「前50条」「前十行」「只打100个」「最多200」「打前 30 条」
  const limitMatch = text.match(/(?:前|只打|最多|打前|处理前|限制|限量)\s*(\d+|[一二三四五六七八九十]+)\s*(?:条|行|个)?/)
  if (limitMatch) {
    const n = parseChineseNumber(limitMatch[1])
    if (n != null && n > 0) cfg.limit = n
  }

  // 维度：「只打情感和场景」「关注用户画像和动机」
  const dimMap: Record<string, string> = {
    '用户画像': '用户画像', '画像': '用户画像',
    '动机': '购买动机', '购买动机': '购买动机',
    '场景': '使用场景', '使用场景': '使用场景',
    '阻碍': '使用阻碍', '使用阻碍': '使用阻碍',
    '克服': '克服方式', '克服方式': '克服方式',
    '忠诚': '用户忠诚度', '忠诚度': '用户忠诚度',
    '改进': '产品改进建议', '改进建议': '产品改进建议',
    '需求': '十三种需求', '13维': '十三种需求', '13种': '十三种需求',
    '使用方式': '使用方式',
    '购买目的': '购买目的',
    '产品属性': '产品属性',
  }
  const matchedDims = Object.keys(dimMap).filter((k) => text.includes(k))
  if (matchedDims.length > 0) {
    cfg.dimensions = [...new Set(matchedDims.map((k) => dimMap[k]))]
  }

  // 情感过滤：「只看负面」「只保留正面和中性」
  const sentimentMap: Record<string, string> = { '正面': '正面', '负面': '负面', '中性': '中性' }
  if (/只看负面/.test(text)) cfg.sentimentFilter = ['负面']
  else if (/只看正面/.test(text)) cfg.sentimentFilter = ['正面']
  else if (/只看中性/.test(text)) cfg.sentimentFilter = ['中性']
  else {
    const matchedSenti = Object.keys(sentimentMap).filter((k) => text.includes(k))
    if (matchedSenti.length > 0) cfg.sentimentFilter = matchedSenti
  }

  return cfg
}

export function EmployeeWorkbench({ agentId, onClose }: { agentId: string; onClose: () => void }) {
  const kb = useMemo(() => kbOf(agentId), [agentId])
  const accent = colorHex(agentId)
  const [tab, setTab] = useState<'tool' | 'chat'>('tool')

  // ---- 记忆文本（注入 system prompt，异步取一次） ----
  const [memText, setMemText] = useState('')
  const memRef = useRef('')
  useEffect(() => {
    let alive = true
    memoryStore.toText(agentId).then((t) => {
      if (!alive) return
      memRef.current = t
      setMemText(t)
    })
    return () => { alive = false }
  }, [agentId])

  // ---- 工作看板（任务状态提升到顶层，右侧展示） ----
  const [jobs, setJobs] = useState<Record<string, TagJob>>({})
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [jobBoardOpen, setJobBoardOpen] = useState(false)
  const [jobBoardFullscreen, setJobBoardFullscreen] = useState(false)
  const stopBatchRef = useRef<Record<string, boolean>>({})

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  function registerJob(fileName: string, total: number, config: TagConfig = {}): string {
    const id = rid()
    const job: TagJob = { id, fileName, total, current: 0, currentDim: -1, rows: [], done: false, cancelled: false, config }
    setJobs((prev) => ({ ...prev, [id]: job }))
    setActiveJobId(id)
    setJobBoardOpen(true)
    return id
  }

  async function startBatchTag(fileName: string, rows: string[]): Promise<string> {
    const jobId = registerJob(fileName, rows.length)
    stopBatchRef.current[jobId] = false

    // 根据总量动态调整演示粒度，避免大文件卡死
    const isBig = rows.length > 200
    const dimDelay = isBig ? 12 : rows.length > 50 ? 35 : 90
    const batchSize = isBig ? 10 : 1

    for (let idx = 0; idx < rows.length; idx++) {
      if (stopBatchRef.current[jobId]) {
        setJobs((prev) => ({ ...prev, [jobId]: { ...prev[jobId], cancelled: true, done: true, currentDim: -1 } }))
        return jobId
      }
      const text = rows[idx]
      setJobs((prev) => ({ ...prev, [jobId]: { ...prev[jobId], current: idx, currentDim: 0 } }))
      const result = tagComment(text)

      // 每 batchSize 行展示一次 9 维扫描动画
      if (idx % batchSize === 0 || idx === rows.length - 1) {
        for (let d = 0; d < VOC_DIMENSION_NAMES.length; d++) {
          setJobs((prev) => ({ ...prev, [jobId]: { ...prev[jobId], currentDim: d } }))
          await sleep(dimDelay)
        }
      }

      const row: VocRow = { id: rid(), text, result }
      setJobs((prev) => ({
        ...prev,
        [jobId]: { ...prev[jobId], rows: [...prev[jobId].rows, row], currentDim: -1 },
      }))

      // 每处理完一行让出时间片，保证 UI 响应 + 可被停止
      await sleep(isBig ? 10 : 30)
    }

    setJobs((prev) => ({ ...prev, [jobId]: { ...prev[jobId], current: rows.length, currentDim: -1, done: true } }))
    return jobId
  }

  function stopBatchTag(jobId: string) {
    stopBatchRef.current[jobId] = true
  }

  const activeJob = activeJobId ? jobs[activeJobId] : null

  return createPortal(
    <div className="wb-overlay" onClick={onClose}>
      <div
        className={'wb-panel' + (jobBoardOpen ? ' wb-panel-with-board' : '')}
        style={{ ['--wb-accent' as any]: accent }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="wb-head">
          <div className="wb-avatar"><span>{kb.name.slice(0, 1)}</span></div>
          <div className="wb-head-info">
            <div className="wb-name">{kb.name}<span className="wb-role"> · {kb.role}</span></div>
            <div className="wb-status"><span className="wb-dot" /> 在线 · 工作台开放中</div>
          </div>
          <button className="wb-close" onClick={onClose} title="关闭"><SvgIcon id="i-close" size={16} /></button>
        </header>

        <div className="wb-body">
          {/* 左：身份 / 工作流 / 技能 / 知识库 / 交付物 */}
          <aside className="wb-left">
            <div className="wb-block">
              <div className="wb-block-title"><SvgIcon id="i-target" size={12} /> 身份定位</div>
              <p className="wb-text">{kb.role}</p>
            </div>
            <div className="wb-block">
              <div className="wb-block-title"><SvgIcon id="i-compass" size={12} /> 岗位目的 / 使命</div>
              <p className="wb-text">{kb.purpose}</p>
            </div>
            <div className="wb-block">
              <div className="wb-block-title"><SvgIcon id="i-steps" size={12} /> 标准工作流</div>
              <ol className="wb-flow">
                {kb.workflow.map((w, i) => (
                  <li key={i}><span className="wb-flow-no">{i + 1}</span><span>{w}</span></li>
                ))}
              </ol>
            </div>
            <div className="wb-block">
              <div className="wb-block-title"><SvgIcon id="i-gear" size={12} /> 硬技能 / 工具</div>
              <div className="wb-chips">
                {kb.skills.map((s, i) => <span key={i} className="wb-chip">{s}</span>)}
              </div>
            </div>
            <div className="wb-block">
              <div className="wb-block-title"><SvgIcon id="i-link" size={12} /> 知识库 / 已接入数据源</div>
              <div className="wb-sources">
                {kb.dataSources.map((id) => {
                  const s = DATA_SOURCE_REGISTRY[id]
                  if (!s) return null
                  return (
                    <div key={id} className="wb-src">
                      <div className="wb-src-name">{s.name}<span className="wb-src-meta">{s.market} · {s.records.toLocaleString()} 条</span></div>
                      <div className="wb-src-desc">{s.desc}</div>
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="wb-block">
              <div className="wb-block-title"><SvgIcon id="i-doc" size={12} /> 交付物标准</div>
              <p className="wb-text">{kb.deliverable}</p>
            </div>
          </aside>

          {/* 中：工具间 / 私聊 */}
          <section className="wb-work-area">
            <div className="wb-tabs">
              <button className={'wb-tab' + (tab === 'tool' ? ' on' : '')} onClick={() => setTab('tool')}>
                <SvgIcon id="i-box" size={13} /> 工具间
              </button>
              <button className={'wb-tab' + (tab === 'chat' ? ' on' : '')} onClick={() => setTab('chat')}>
                <SvgIcon id="i-msg" size={13} /> 私聊
              </button>
            </div>
            {tab === 'tool'
              ? <ToolRoom agentId={agentId} kb={kb} />
              : <PrivateChat
                  agentId={agentId}
                  memRef={memRef}
                  onStartBatch={startBatchTag}
                  onRegisterJob={registerJob}
                  jobs={jobs}
                  setJobs={setJobs}
                  stopBatchTag={stopBatchTag}
                  setActiveJobId={setActiveJobId}
                  setJobBoardOpen={setJobBoardOpen}
                  setJobBoardFullscreen={setJobBoardFullscreen}
                />}
          </section>

          {/* 右：工作看板 */}
          {jobBoardOpen && activeJob && (
            <JobBoard
              job={activeJob}
              onClose={() => setJobBoardOpen(false)}
              fullscreen={jobBoardFullscreen}
              onToggleFullscreen={() => setJobBoardFullscreen((v) => !v)}
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

/* ----------------------------- 工具间 ----------------------------- */
function ToolRoom({ agentId, kb }: { agentId: string; kb: ReturnType<typeof kbOf> }) {
  const [rows, setRows] = useState<VocRow[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [scanText, setScanText] = useState('')
  const [scanDim, setScanDim] = useState(-1)
  const busyRef = useRef(false)

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

  async function processOne(text: string) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setScanText(text)
    setScanDim(0)
    try {
      const result = tagComment(text)
      for (let i = 0; i < VOC_DIMENSION_NAMES.length; i++) {
        setScanDim(i)
        await sleep(170)
      }
      setRows((prev) => [...prev, { id: rid(), text, result }])
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('VOC 打标失败', e)
    } finally {
      setBusy(false)
      setScanText('')
      setScanDim(-1)
      busyRef.current = false
    }
  }

  async function runDemo() {
    if (busyRef.current) return
    for (let idx = 0; idx < VOC_SAMPLES.length; idx++) {
      if (busyRef.current) break
      await processOne(VOC_SAMPLES[idx])
      if (idx < VOC_SAMPLES.length - 1) await sleep(220)
    }
  }

  function submit() {
    const t = input.trim()
    if (!t || busyRef.current) return
    setInput('')
    void processOne(t)
  }

  // 仅小灵（voc）有真实可交互工具；其余员工展示占位
  if (agentId !== 'voc') {
    return (
      <div className="wb-tool">
        <div className="wb-tool-empty">
          <div className="wb-tool-empty-icon"><SvgIcon id="i-build" size={26} /></div>
          <div className="wb-tool-empty-title">「{kb.name}」工作台建设中</div>
          <p className="wb-tool-empty-text">
            该员工工作台正在搭建。首个开放体验的是 <b>小灵（VOC 智能打标）</b> 的工作台——
            你可以在左侧名单点开小灵，进入她的工具间，粘贴评论看她实时打标。
          </p>
          <div className="wb-tool-empty-skills">
            她的核心工具：{kb.skills.slice(0, 3).join('、')}…
          </div>
        </div>
      </div>
    )
  }

  const senti = { 正面: 0, 中性: 0, 负面: 0 } as Record<string, number>
  rows.forEach((r) => { senti[r.result.sentiment] = (senti[r.result.sentiment] ?? 0) + 1 })

  return (
    <div className="wb-tool">
      <div className="wb-tool-head">
        <div className="wb-tool-title"><SvgIcon id="w-tag" size={14} /> VOC 9 维智能打标台</div>
        <div className="wb-tool-actions">
          <button className="wb-btn" onClick={runDemo} disabled={busy}>让小灵演示</button>
        </div>
      </div>

      {/* 9 维扫描进度 */}
      <div className="wb-scan">
        {VOC_DIMENSION_NAMES.map((d, i) => (
          <span key={d} className={'wb-scan-dim' + (scanDim === i ? ' scanning' : '')}>{d}</span>
        ))}
      </div>
      {scanText && (
        <div className="wb-scan-status">
          <span className="wb-ws-dot" /> 小灵正在逐维扫描：{scanText.length > 36 ? scanText.slice(0, 36) + '…' : scanText}
        </div>
      )}

      <div className="wb-input-row">
        <textarea
          className="wb-textarea"
          placeholder="把一条用户评论贴在这里，回车或点「打标」让小灵实时拆解到 9 个维度…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
          disabled={busy}
        />
        <button className="wb-btn primary" onClick={submit} disabled={busy || !input.trim()}>
          {busy ? '打标中…' : '打标'}
        </button>
      </div>

      <div className="wb-summary">
        <span className="wb-sum-pill">已标注 <b>{rows.length}</b> 条</span>
        <span className="wb-sum-pill" style={{ color: SENTIMENT_COLOR['正面'] }}>正面 {senti['正面']}</span>
        <span className="wb-sum-pill" style={{ color: SENTIMENT_COLOR['中性'] }}>中性 {senti['中性']}</span>
        <span className="wb-sum-pill" style={{ color: SENTIMENT_COLOR['负面'] }}>负面 {senti['负面']}</span>
      </div>

      <div className="wb-table-wrap">
        <table className="wb-table">
          <thead>
            <tr>
              <th style={{ width: '34%' }}>评论原文</th>
              <th>9 维标签</th>
              <th style={{ width: '64px' }}>情感</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={3} className="wb-table-empty">还没有标注记录。贴上评论，或点「让小灵演示」。</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="wb-td-text" title={r.text}>{r.text.length > 40 ? r.text.slice(0, 40) + '…' : r.text}</td>
                <td>
                  <div className="wb-td-tags">
                    {r.result.dims.length === 0
                      ? <span className="wb-td-none">未命中维度</span>
                      : r.result.dims.map((d) => (
                        <span key={d.dim} className="wb-td-dim">
                          <span className="wb-td-dim-name">{d.dim}</span>
                          {d.tags.map((t) => <span key={t} className="wb-td-tag">{t}</span>)}
                        </span>
                      ))}
                  </div>
                </td>
                <td><span className="wb-senti" style={{ background: SENTIMENT_COLOR[r.result.sentiment] }}>{r.result.sentiment}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ----------------------------- 私聊 ----------------------------- */
function PrivateChat({
  agentId,
  memRef,
  onStartBatch,
  onRegisterJob,
  jobs,
  setJobs,
  stopBatchTag,
  setActiveJobId,
  setJobBoardOpen,
  setJobBoardFullscreen,
}: {
  agentId: string
  memRef: React.MutableRefObject<string>
  onStartBatch: (fileName: string, rows: string[]) => Promise<string>
  onRegisterJob: (fileName: string, total: number, config?: TagConfig) => string
  jobs: Record<string, TagJob>
  setJobs: React.Dispatch<React.SetStateAction<Record<string, TagJob>>>
  stopBatchTag: (jobId: string) => void
  setActiveJobId: (id: string | null) => void
  setJobBoardOpen: (open: boolean) => void
  setJobBoardFullscreen: (fs: boolean) => void
}) {
  const kb = useMemo(() => kbOf(agentId), [agentId])
  const [msgs, setMsgs] = useState<ChatLine[]>([])
  const [input, setInput] = useState('')
  const [typing, setTyping] = useState('')
  const [busy, setBusy] = useState(false)
  const [attach, setAttach] = useState<UserFile | null>(null)
  const [attachPreview, setAttachPreview] = useState<string | null>(null)
  const [composing, setComposing] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const abortCtrlRef = useRef<AbortController | null>(null)
  const activeBatchRef = useRef<string | null>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [msgs, typing])

  function fallbackReply(_text: string): string {
    return `${kb.name}（规则模式）：我目前没有接入 AI 密钥，只能做基础应答。我的岗位是「${kb.role}」——${kb.purpose}。你可以把相关语料贴给我，或去设置里填入 LLM 密钥后我们再深入聊。`
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    if (isImageFile(file)) {
      const dataUrl = await readFileAsDataURL(file)
      setAttach({ name: file.name, type: file.type, size: file.size, dataUrl })
      setAttachPreview(dataUrl)
      return
    }
    if (isTableFile(file)) {
      const text = await readFileAsText(file)
      setAttach({ name: file.name, type: file.type, size: file.size, content: text })
      setAttachPreview(null)
      return
    }
    // 其他类型：暂不支持
    setAttach({ name: file.name, type: file.type, size: file.size })
    setAttachPreview(null)
  }

  function clearAttach() {
    setAttach(null)
    setAttachPreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function runLocalBatchTag(fileName: string, rows: string[], config: TagConfig = {}) {
    const targetRows = config.limit && config.limit > 0 ? rows.slice(0, config.limit) : rows
    const jobId = onRegisterJob(fileName, targetRows.length, config)
    activeBatchRef.current = jobId
    setMsgs((m) => [...m, {
      role: 'emp',
      text: `${kb.name}：收到 ${fileName}，共 ${targetRows.length} 条${config.limit ? `（按你的要求只取前 ${config.limit} 条）` : ''}，我现在按你的指令逐维扫描打标…`,
      job: { id: jobId, fileName, total: targetRows.length, current: 0, currentDim: -1, rows: [], done: false, cancelled: false, config }
    }])

    const isBig = targetRows.length > 200
    const dimDelay = isBig ? 12 : targetRows.length > 50 ? 35 : 90
    const batchSize = isBig ? 10 : 1

    for (let idx = 0; idx < targetRows.length; idx++) {
      const job = jobs[jobId]
      if (job?.cancelled || activeBatchRef.current !== jobId) {
        setJobs((prev) => ({ ...prev, [jobId]: { ...prev[jobId], cancelled: true, done: true, currentDim: -1 } }))
        return
      }
      const text = targetRows[idx]
      setJobs((prev) => ({ ...prev, [jobId]: { ...prev[jobId], current: idx, currentDim: 0 } }))
      const result = tagComment(text)

      if (idx % batchSize === 0 || idx === targetRows.length - 1) {
        for (let d = 0; d < VOC_DIMENSION_NAMES.length; d++) {
          setJobs((prev) => ({ ...prev, [jobId]: { ...prev[jobId], currentDim: d } }))
          await sleep(dimDelay)
        }
      }

      const row: VocRow = { id: rid(), text, result }
      setJobs((prev) => ({
        ...prev,
        [jobId]: { ...prev[jobId], rows: [...prev[jobId].rows, row], currentDim: -1 },
      }))
      await sleep(isBig ? 10 : 30)
    }

    setJobs((prev) => ({ ...prev, [jobId]: { ...prev[jobId], current: targetRows.length, currentDim: -1, done: true } }))
    activeBatchRef.current = null
  }

  async function send() {
    const text = input.trim()
    if ((!text && !attach) || busy) return
    const currentAttach = attach
    clearAttach()
    setInput('')

    const userMsg: ChatLine = { role: 'user', text: text || (currentAttach ? currentAttach.name : '') }
    if (currentAttach) userMsg.file = currentAttach
    setMsgs((m) => [...m, userMsg])

    // ── 表格文件：本地 VOC 批量打标 + 可视化过程 ──
    if (currentAttach && isTableFileByName(currentAttach.name)) {
      setBusy(true)
      try {
        const raw = currentAttach.content ?? ''
        const rows = parseCommentRows(raw || text || '')
        if (rows.length === 0) {
          setMsgs((m) => [...m, { role: 'emp', text: `${kb.name}：我没从文件里读到有效评论行。请检查文件是不是 CSV / TSV / TXT，且每行是一条评论；如果是表格，第一行最好有「评论」或「content」列名。` }])
        } else {
          await runLocalBatchTag(currentAttach.name, rows, parseTagInstruction(text))
        }
      } finally {
        setBusy(false)
      }
      return
    }

    // ── 图片：走 LLM 视觉 ──
    const images = currentAttach?.dataUrl ? [currentAttach.dataUrl] : undefined
    if (images && !text) {
      setMsgs((m) => [...m, { role: 'emp', text: `${kb.name}：图片已收到，但我需要你在文字里告诉我你想让我做什么（总结 / 提取观点 / 识别风险 / 描述内容）。` }])
      return
    }

    setBusy(true)
    setTyping('')
    const system = composeSystemPrompt(agentId, memRef.current)
    abortCtrlRef.current = new AbortController()
    try {
      const full = await streamChat(
        system,
        text || '请看看这张图并给出你的分析。',
        (d) => setTyping((t) => t + d),
        { images, signal: abortCtrlRef.current.signal },
      )
      setMsgs((m) => [...m, { role: 'emp', text: normalizePunct(full) }])
    } catch (err) {
      if ((err as Error)?.name === 'AbortError' || (err as Error)?.message?.includes('aborted')) {
        setMsgs((m) => [...m, { role: 'emp', text: normalizePunct(typing || '（已停止输出）') }])
      } else {
        setMsgs((m) => [...m, { role: 'emp', text: normalizePunct(fallbackReply(text || '图片分析')) }])
      }
    } finally {
      setTyping('')
      setBusy(false)
      abortCtrlRef.current = null
    }
  }

  function stop() {
    // 停止 LLM 流式
    if (abortCtrlRef.current) {
      abortCtrlRef.current.abort()
      abortCtrlRef.current = null
    }
    // 停止批量打标
    if (activeBatchRef.current) {
      stopBatchTag(activeBatchRef.current)
      activeBatchRef.current = null
    }
    setBusy(false)
  }

  const canSend = !busy && (!!input.trim() || !!attach)
  const canStop = busy

  return (
    <div className="wb-chat">
      <div className="wb-chat-scroll" ref={scrollRef}>
        {msgs.length === 0 && (
          <div className="wb-chat-empty">
            <div className="wb-chat-empty-avatar"><span>{kb.name.slice(0, 1)}</span></div>
            <p>这是你和 <b>{kb.name}</b> 的 1v1 私聊。在这里可以直接问她岗位问题、让她解释某个标签，或聊某个具体任务。</p>
            <p className="wb-chat-empty-tip">支持上传图片（让 LLM 直接看）或 CSV / TSV / TXT 表格（小灵本地逐行 VOC 打标并展示过程）。</p>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i}>
            <div className={'wb-msg-row ' + (m.role === 'user' ? 'me' : 'emp')}>
              <div className="wb-avatar" title={m.role === 'user' ? '我' : kb.name}>
                {m.role === 'user' ? '我' : kb.name.slice(0, 1)}
              </div>
              <div className="wb-bubble">
                <div className="wb-bubble-name">{m.role === 'user' ? '我' : kb.name}</div>
                <div className="wb-bubble-text">
                  {m.file && m.file.dataUrl ? (
                    <img src={m.file.dataUrl} alt={m.file.name} className="wb-chat-img" />
                  ) : null}
                  {m.file && !m.file.dataUrl ? (
                    <span className="wb-chat-file"><SvgIcon id="i-doc" size={13} /> {m.file.name}</span>
                  ) : null}
                  {m.text ? m.text : null}
                </div>
              </div>
            </div>
            {m.job && (
              <BatchTagJob
                jobId={m.job.id}
                jobs={jobs}
                onOpenBoard={() => { setActiveJobId(m.job!.id); setJobBoardOpen(true) }}
                onOpenFullscreen={() => { setActiveJobId(m.job!.id); setJobBoardOpen(true); setJobBoardFullscreen(true) }}
              />
            )}
          </div>
        ))}
        {typing && (
          <div className="wb-msg-row emp">
            <div className="wb-avatar" title={kb.name}>{kb.name.slice(0, 1)}</div>
            <div className="wb-bubble">
              <div className="wb-bubble-name">{kb.name}</div>
              <div className="wb-bubble-text">{typing}<span className="wb-cursor" /></div>
            </div>
          </div>
        )}
      </div>

      {attach && (
        <div className="wb-attach-bar">
          {attachPreview ? (
            <img src={attachPreview} alt="preview" className="wb-attach-thumb" />
          ) : (
            <span className="wb-attach-name"><SvgIcon id="i-doc" size={13} /> {attach.name}</span>
          )}
          <button className="wb-attach-del" onClick={clearAttach} title="移除"><SvgIcon id="i-close" size={12} /></button>
        </div>
      )}

      <div className="wb-chat-input">
        <input
          type="file"
          ref={fileInputRef}
          className="wb-file-input"
          accept="image/*,.csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
          onChange={onPickFile}
        />
        <button className="wb-btn" onClick={() => fileInputRef.current?.click()} title="上传图片或表格" disabled={busy}>
          <SvgIcon id="i-doc" size={15} />
        </button>
        <textarea
          className="wb-textarea"
          placeholder={`和 ${kb.name} 说点什么…（Enter 发送，Shift+Enter 换行；可传图片/CSV/TXT）`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !composing) {
              e.preventDefault()
              if (canSend) send()
            }
          }}
          disabled={busy}
        />
        {canStop ? (
          <button className="wb-btn stop" onClick={stop}>停止</button>
        ) : (
          <button className="wb-btn primary" onClick={send} disabled={!canSend}>发送</button>
        )}
      </div>
    </div>
  )
}

/* ----------------------------- 批量打标任务可视化（聊天流里的小卡片） ----------------------------- */
function BatchTagJob({ jobId, jobs, onOpenBoard, onOpenFullscreen }: { jobId: string; jobs: Record<string, TagJob>; onOpenBoard: () => void; onOpenFullscreen: () => void }) {
  const job = jobs[jobId]
  if (!job) return null
  const senti = { 正面: 0, 中性: 0, 负面: 0 } as Record<string, number>
  const visibleRows = job.config.sentimentFilter
    ? job.rows.filter((r) => job.config.sentimentFilter!.includes(r.result.sentiment))
    : job.rows
  visibleRows.forEach((r) => { senti[r.result.sentiment] = (senti[r.result.sentiment] ?? 0) + 1 })
  const visibleDims = job.config.dimensions ?? null

  return (
    <div className="wb-job">
      <div className="wb-job-head">
        <div className="wb-job-title"><SvgIcon id="w-tag" size={13} /> 批量 VOC 打标：{job.fileName}</div>
        <div className="wb-job-meta">
          {job.cancelled ? `已停止 ${job.rows.length} / ${job.total} 条` : job.done ? `已完成 ${job.total} 条` : `处理中 ${job.current + (job.currentDim >= 0 ? 1 : 0)} / ${job.total} 条`}
        </div>
      </div>

      {(job.config.instruction || visibleDims || job.config.sentimentFilter) && (
        <div className="wb-job-config">
          {job.config.instruction ? <span className="wb-job-cfg-item" title={job.config.instruction}>指令：{job.config.instruction}</span> : null}
          {visibleDims ? <span className="wb-job-cfg-item">只看维度：{visibleDims.join('、')}</span> : null}
          {job.config.sentimentFilter ? <span className="wb-job-cfg-item">只看情感：{job.config.sentimentFilter.join('、')}</span> : null}
        </div>
      )}

      {!job.done && !job.cancelled && (
        <div className="wb-job-scan">
          <div className="wb-job-progress"><div className="wb-job-progress-bar" style={{ width: `${Math.min(100, (job.current / Math.max(1, job.total)) * 100)}%` }} /></div>
          <div className="wb-scan" style={{ marginBottom: 0 }}>
            {VOC_DIMENSION_NAMES.map((d, i) => (
              <span key={d} className={'wb-scan-dim' + (job.currentDim === i ? ' scanning' : '')}>{d}</span>
            ))}
          </div>
        </div>
      )}

      <div className="wb-job-summary">
        <span className="wb-sum-pill">已标注 <b>{job.rows.length}</b> / {job.total} 条</span>
        <span className="wb-sum-pill" style={{ color: SENTIMENT_COLOR['正面'] }}>正面 {senti['正面']}</span>
        <span className="wb-sum-pill" style={{ color: SENTIMENT_COLOR['中性'] }}>中性 {senti['中性']}</span>
        <span className="wb-sum-pill" style={{ color: SENTIMENT_COLOR['负面'] }}>负面 {senti['负面']}</span>
      </div>

      <div className="wb-table-wrap" style={{ maxHeight: 260 }}>
        <table className="wb-table">
          <thead>
            <tr>
              <th style={{ width: '34%' }}>评论原文</th>
              <th>9 维标签</th>
              <th style={{ width: '64px' }}>情感</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 && (
              <tr><td colSpan={3} className="wb-table-empty">等待小灵开始扫描…</td></tr>
            )}
            {visibleRows.map((r) => {
              const dims = visibleDims
                ? r.result.dims.filter((d) => visibleDims.includes(d.dim))
                : r.result.dims
              return (
                <tr key={r.id}>
                  <td className="wb-td-text" title={r.text}>{r.text.length > 40 ? r.text.slice(0, 40) + '…' : r.text}</td>
                  <td>
                    <div className="wb-td-tags">
                      {dims.length === 0
                        ? <span className="wb-td-none">未命中维度</span>
                        : dims.map((d) => (
                          <span key={d.dim} className="wb-td-dim">
                            <span className="wb-td-dim-name">{d.dim}</span>
                            {d.tags.map((t) => <span key={t} className="wb-td-tag">{t}</span>)}
                          </span>
                        ))}
                    </div>
                  </td>
                  <td><span className="wb-senti" style={{ background: SENTIMENT_COLOR[r.result.sentiment] }}>{r.result.sentiment}</span></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="wb-job-foot">
        <button className="wb-btn" onClick={onOpenBoard}><SvgIcon id="i-bar" size={12} /> 在右侧面板展开</button>
        <button className="wb-btn primary" onClick={onOpenFullscreen}><SvgIcon id="i-box" size={12} /> 全屏查看</button>
      </div>
    </div>
  )
}

/* ----------------------------- 右侧工作看板（可全屏） ----------------------------- */
function JobBoard({
  job,
  onClose,
  fullscreen,
  onToggleFullscreen,
}: {
  job: TagJob
  onClose: () => void
  fullscreen: boolean
  onToggleFullscreen: () => void
}) {
  const senti = { 正面: 0, 中性: 0, 负面: 0 } as Record<string, number>
  const visibleRows = job.config.sentimentFilter
    ? job.rows.filter((r) => job.config.sentimentFilter!.includes(r.result.sentiment))
    : job.rows
  visibleRows.forEach((r) => { senti[r.result.sentiment] = (senti[r.result.sentiment] ?? 0) + 1 })
  const visibleDims = job.config.dimensions ?? null

  function downloadCSV() {
    const dims = visibleDims ?? VOC_DIMENSION_NAMES
    const rows = visibleRows.map((r) => {
      const dimMap: Record<string, string> = {}
      const ds = visibleDims ? r.result.dims.filter((d) => visibleDims.includes(d.dim)) : r.result.dims
      ds.forEach((d) => { dimMap[d.dim] = d.tags.join('、') })
      return [r.text, r.result.sentiment, ...dims.map((d) => dimMap[d] ?? '')]
    })
    const csv = [['评论原文', '情感', ...dims], ...rows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `voc-tag-${job.fileName.replace(/\.[^.]+$/, '')}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const panel = (
    <div className={'wb-board' + (fullscreen ? ' fullscreen' : '')}>
      <div className="wb-board-head">
        <div className="wb-board-title"><SvgIcon id="w-tag" size={14} /> 工作看板 · {job.fileName}</div>
        <div className="wb-board-actions">
          <button className="wb-board-btn" onClick={downloadCSV} title="下载 CSV"><SvgIcon id="i-doc" size={13} /> 导出</button>
          <button className="wb-board-btn" onClick={onToggleFullscreen} title={fullscreen ? '退出全屏' : '全屏'}>
            <SvgIcon id={fullscreen ? 'i-close' : 'i-box'} size={13} /> {fullscreen ? '退出全屏' : '全屏'}
          </button>
          {!fullscreen && (
            <button className="wb-board-btn close" onClick={onClose} title="收起"><SvgIcon id="i-close" size={13} /></button>
          )}
        </div>
      </div>

      {(job.config.instruction || visibleDims || job.config.sentimentFilter) && (
        <div className="wb-board-config">
          {job.config.instruction ? <span className="wb-board-cfg-item" title={job.config.instruction}>指令：{job.config.instruction}</span> : null}
          {visibleDims ? <span className="wb-board-cfg-item">只看维度：{visibleDims.join('、')}</span> : null}
          {job.config.sentimentFilter ? <span className="wb-board-cfg-item">只看情感：{job.config.sentimentFilter.join('、')}</span> : null}
        </div>
      )}

      <div className="wb-board-status">
        <div className="wb-board-progress-wrap">
          <div className="wb-board-progress">
            <div className="wb-board-progress-bar" style={{ width: `${Math.min(100, (job.rows.length / Math.max(1, job.total)) * 100)}%` }} />
          </div>
          <div className="wb-board-progress-text">
            {job.cancelled ? `已停止：${job.rows.length} / ${job.total} 条` : job.done ? `已完成：${job.total} 条` : `处理中：${job.rows.length} / ${job.total} 条`}
          </div>
        </div>
        <div className="wb-board-summary">
          <span className="wb-sum-pill">已标注 <b>{job.rows.length}</b> 条</span>
          <span className="wb-sum-pill" style={{ color: SENTIMENT_COLOR['正面'] }}>正面 {senti['正面']}</span>
          <span className="wb-sum-pill" style={{ color: SENTIMENT_COLOR['中性'] }}>中性 {senti['中性']}</span>
          <span className="wb-sum-pill" style={{ color: SENTIMENT_COLOR['负面'] }}>负面 {senti['负面']}</span>
        </div>
      </div>

      {!job.done && !job.cancelled && (
        <div className="wb-board-scan">
          {VOC_DIMENSION_NAMES.map((d, i) => (
            <span key={d} className={'wb-scan-dim' + (job.currentDim === i ? ' scanning' : '')}>{d}</span>
          ))}
        </div>
      )}

      <div className="wb-board-table-wrap">
        <table className="wb-table">
          <thead>
            <tr>
              <th style={{ width: '38%' }}>评论原文</th>
              <th>9 维标签</th>
              <th style={{ width: '72px' }}>情感</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 && (
              <tr><td colSpan={3} className="wb-table-empty">等待小灵开始扫描…</td></tr>
            )}
            {visibleRows.map((r) => {
              const dims = visibleDims
                ? r.result.dims.filter((d) => visibleDims.includes(d.dim))
                : r.result.dims
              return (
                <tr key={r.id}>
                  <td className="wb-td-text" title={r.text}>{r.text}</td>
                  <td>
                    <div className="wb-td-tags">
                      {dims.length === 0
                        ? <span className="wb-td-none">未命中维度</span>
                        : dims.map((d) => (
                          <span key={d.dim} className="wb-td-dim">
                            <span className="wb-td-dim-name">{d.dim}</span>
                            {d.tags.map((t) => <span key={t} className="wb-td-tag">{t}</span>)}
                          </span>
                        ))}
                    </div>
                  </td>
                  <td><span className="wb-senti" style={{ background: SENTIMENT_COLOR[r.result.sentiment] }}>{r.result.sentiment}</span></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )

  if (fullscreen) {
    return createPortal(
      <div className="wb-board-fullscreen-overlay">
        {panel}
      </div>,
      document.body,
    )
  }
  return panel
}
