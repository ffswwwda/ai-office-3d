import { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { AGENT_ROSTER } from '@/scene/layout/officeLayout'
import { kbOf, composeSystemPrompt, DATA_SOURCE_REGISTRY } from '@/lib/employeeKB'
import { memoryStore } from '@/lib/employeeMemory'
import { streamChat } from '@/lib/llm'
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
type TagJob = {
  id: string
  fileName: string
  total: number
  current: number
  currentDim: number
  rows: VocRow[]
  done: boolean
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="wb-overlay" onClick={onClose}>
      <div className="wb-panel" style={{ ['--wb-accent' as any]: accent }} onClick={(e) => e.stopPropagation()}>
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

          {/* 右：工具间 / 私聊 */}
          <section className="wb-right">
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
              : <PrivateChat agentId={agentId} memRef={memRef} />}
          </section>
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
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit() } }}
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
function PrivateChat({ agentId, memRef }: { agentId: string; memRef: React.MutableRefObject<string> }) {
  const kb = useMemo(() => kbOf(agentId), [agentId])
  const [msgs, setMsgs] = useState<ChatLine[]>([])
  const [input, setInput] = useState('')
  const [typing, setTyping] = useState('')
  const [busy, setBusy] = useState(false)
  const [attach, setAttach] = useState<UserFile | null>(null)
  const [attachPreview, setAttachPreview] = useState<string | null>(null)
  const [jobs, setJobs] = useState<Record<string, TagJob>>({})
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  async function runBatchTag(fileName: string, rows: string[]) {
    const jobId = rid()
    const job: TagJob = { id: jobId, fileName, total: rows.length, current: 0, currentDim: -1, rows: [], done: false }
    setJobs((prev) => ({ ...prev, [jobId]: job }))

    for (let idx = 0; idx < rows.length; idx++) {
      const text = rows[idx]
      setJobs((prev) => ({ ...prev, [jobId]: { ...prev[jobId], current: idx, currentDim: 0 } }))
      const result = tagComment(text)
      for (let d = 0; d < VOC_DIMENSION_NAMES.length; d++) {
        setJobs((prev) => ({ ...prev, [jobId]: { ...prev[jobId], currentDim: d } }))
        await sleep(90)
      }
      const row: VocRow = { id: rid(), text, result }
      setJobs((prev) => ({
        ...prev,
        [jobId]: { ...prev[jobId], rows: [...prev[jobId].rows, row], currentDim: -1 },
      }))
      await sleep(120)
    }

    setJobs((prev) => ({ ...prev, [jobId]: { ...prev[jobId], current: rows.length, currentDim: -1, done: true } }))
  }

  async function send() {
    const text = input.trim()
    if ((!text && !attach) || busy) return
    const currentAttach = attach
    clearAttach()

    const userMsg: ChatLine = { role: 'user', text: text || (currentAttach ? `📎 ${currentAttach.name}` : '') }
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
          const jobId = rid()
          setMsgs((m) => [...m, { role: 'emp', text: `${kb.name}：收到 ${currentAttach.name}，共 ${rows.length} 条，我现在逐维扫描打标…`, job: { id: jobId, fileName: currentAttach.name, total: rows.length, current: 0, currentDim: -1, rows: [], done: false } }])
          await runBatchTag(currentAttach.name, rows)
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
    try {
      const full = await streamChat(system, text || '请看看这张图并给出你的分析。', (d) => setTyping((t) => t + d), { images })
      setMsgs((m) => [...m, { role: 'emp', text: full }])
    } catch {
      setMsgs((m) => [...m, { role: 'emp', text: fallbackReply(text || '图片分析') }])
    } finally {
      setTyping('')
      setBusy(false)
    }
  }

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
            <div className={'wb-bubble ' + (m.role === 'user' ? 'me' : 'emp')}>
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
            {m.job && <BatchTagJob jobId={m.job.id} jobs={jobs} setJobs={setJobs} />}
          </div>
        ))}
        {typing && (
          <div className="wb-bubble emp">
            <div className="wb-bubble-name">{kb.name}</div>
            <div className="wb-bubble-text">{typing}<span className="wb-cursor" /></div>
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
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
          }}
          disabled={busy}
        />
        <button className="wb-btn primary" onClick={send} disabled={busy || (!input.trim() && !attach)}>发送</button>
      </div>
    </div>
  )
}

const isTableFileByName = (name: string) => /\.(csv|tsv|txt)$/i.test(name)

/* ----------------------------- 批量打标任务可视化 ----------------------------- */
function BatchTagJob({ jobId, jobs, setJobs }: { jobId: string; jobs: Record<string, TagJob>; setJobs: React.Dispatch<React.SetStateAction<Record<string, TagJob>>> }) {
  const job = jobs[jobId]
  if (!job) return null
  const senti = { 正面: 0, 中性: 0, 负面: 0 } as Record<string, number>
  job.rows.forEach((r) => { senti[r.result.sentiment] = (senti[r.result.sentiment] ?? 0) + 1 })

  return (
    <div className="wb-job">
      <div className="wb-job-head">
        <div className="wb-job-title"><SvgIcon id="w-tag" size={13} /> 批量 VOC 打标：{job.fileName}</div>
        <div className="wb-job-meta">{job.done ? `已完成 ${job.total} 条` : `处理中 ${job.current + (job.currentDim >= 0 ? 1 : 0)} / ${job.total} 条`}</div>
      </div>

      {!job.done && (
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
            {job.rows.length === 0 && (
              <tr><td colSpan={3} className="wb-table-empty">等待小灵开始扫描…</td></tr>
            )}
            {job.rows.map((r) => (
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
