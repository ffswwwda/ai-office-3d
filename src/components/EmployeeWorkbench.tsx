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

type ChatLine = { role: 'user' | 'emp'; text: string }
type VocRow = { id: string; text: string; result: VocTagResult }

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
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [msgs, typing])

  function fallbackReply(_text: string): string {
    return `${kb.name}（规则模式）：我目前没有接入 AI 密钥，只能做基础应答。我的岗位是「${kb.role}」——${kb.purpose}。你可以把相关语料贴给我，或去设置里填入 LLM 密钥后我们再深入聊。`
  }

  async function send() {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    setMsgs((m) => [...m, { role: 'user', text }])
    setBusy(true)
    setTyping('')
    const system = composeSystemPrompt(agentId, memRef.current)
    try {
      const full = await streamChat(system, text, (d) => setTyping((t) => t + d))
      setMsgs((m) => [...m, { role: 'emp', text: full }])
    } catch {
      setMsgs((m) => [...m, { role: 'emp', text: fallbackReply(text) }])
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
            <p className="wb-chat-empty-tip">填入 LLM 密钥后，回复会是流式逐字生成的；未填则走规则应答。</p>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={'wb-bubble ' + (m.role === 'user' ? 'me' : 'emp')}>
            <div className="wb-bubble-name">{m.role === 'user' ? '我' : kb.name}</div>
            <div className="wb-bubble-text">{m.text}</div>
          </div>
        ))}
        {typing && (
          <div className="wb-bubble emp">
            <div className="wb-bubble-name">{kb.name}</div>
            <div className="wb-bubble-text">{typing}<span className="wb-cursor" /></div>
          </div>
        )}
      </div>
      <div className="wb-chat-input">
        <textarea
          className="wb-textarea"
          placeholder={`和 ${kb.name} 说点什么…（Enter 发送，Shift+Enter 换行）`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
          }}
          disabled={busy}
        />
        <button className="wb-btn primary" onClick={send} disabled={busy || !input.trim()}>发送</button>
      </div>
    </div>
  )
}
