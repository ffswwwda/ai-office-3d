import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AGENT_ROSTER, MEETING_EXPERTS } from '@/scene/layout/officeLayout'
import { getOfficeScene } from '@/scene/officeSceneBridge'
import {
  addLiveProject, updateTask, updateStage, subscribeLiveProjects,
  type LiveProject, type ProjectTask,
  getLLMConfig, setLLMConfig, isLLMEnabled,
} from '@/store/workspaceStore'
import {
  buildReply, buildPlanItems,
  buildTaskStages, buildStageOutput, buildStageOutputLLM, resolveSpeakers,
  buildTaskOutput,
  type ChatMsg, type MeetingContext,
} from '@/lib/meetingEngine'
import { kbOf, describeSources, DATA_SOURCE_REGISTRY, isGuest } from '@/lib/employeeKB'
import { getMemory, clearMemory, addMemory, summarizeForMemory } from '@/lib/employeeMemory'
import { TaskStageBoard } from '@/components/TaskStageBoard'

function SvgIcon({ id, size = 14 }: { id: string; size?: number }) {
  return <svg viewBox="0 0 24 24" width={size} height={size}><use href={'#' + id}/></svg>
}

const ROSTER: Record<string, { id: string; name: string; color: number; task: string }> =
  Object.fromEntries(AGENT_ROSTER.map((r) => [r.id, r]))
const EXPERT: Record<string, { id: string; competency: string; keywords: string[] }> =
  Object.fromEntries(MEETING_EXPERTS.map((e) => [e.id, e]))
/** 跨行业访客（外卖员豆包）：不在 AGENT_ROSTER，单独登记姓名与颜色 */
const GUEST_ROSTER: Record<string, { id: string; name: string; color: number }> = {
  doubao: { id: 'doubao', name: '豆包', color: 0xff8a3d },
}
const nameOf = (id: string) => ROSTER[id]?.name ?? GUEST_ROSTER[id]?.name ?? id
const colorHex = (id: string) => '#' + (ROSTER[id]?.color ?? GUEST_ROSTER[id]?.color ?? 0x888888).toString(16).padStart(6, '0')

type Step = 'setup' | 'discuss' | 'plan' | 'done'

/** 「建议拉取员工」：按主题/目的关键词命中打分排序 */
function suggestExperts(topic: string, purpose: string) {
  const text = (topic + ' ' + purpose).toLowerCase()
  return MEETING_EXPERTS
    .map((e) => {
      const hits = e.keywords.filter((k) => text.includes(k.toLowerCase()))
      return { id: e.id, score: hits.length, hits }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
}

function buildPlanDoc(
  topic: string, purpose: string, items: Array<{ ownerId: string; title: string }>,
  messages: ChatMsg[] = [],
): string {
  const lines: string[] = []
  lines.push('# 会议规划与执行方案')
  lines.push(`> 主题：${topic || '（未填写）'}`)
  lines.push(`> 目的：${purpose || '（未填写）'}`)
  lines.push(`> 生成时间：${new Date().toLocaleString('zh-CN')}`)
  lines.push('')
  lines.push('## 一、会议目标')
  lines.push(`- 围绕「${topic}」展开，目的为：${purpose}`)
  lines.push('')
  lines.push('## 二、执行分工')
  items.forEach((it, i) => {
    const r = ROSTER[it.ownerId]
    lines.push(`${i + 1}. **${r.name}（${EXPERT[it.ownerId].competency}）**：任务——${it.title}`)
  })
  lines.push('')
  // 真实讨论要点：直接来自会议室发言，而不是套模板
  const realMsgs = messages.filter((m) => m.text && m.text.trim())
  if (realMsgs.length > 0) {
    lines.push('## 三、会议讨论要点（来自真实发言）')
    realMsgs.forEach((m) => {
      const who = m.role === 'user' ? '发起人' : nameOf(m.role)
      const txt = m.text.replace(/\n+/g, ' ').trim()
      lines.push(`- **${who}**：${txt.length > 90 ? txt.slice(0, 90) + '…' : txt}`)
    })
    lines.push('')
    lines.push('## 四、分工说明')
  } else {
    lines.push('## 三、分工说明')
  }
  items.forEach((it) => {
    const kb = kbOf(it.ownerId)
    lines.push(`- ${nameOf(it.ownerId)} 将基于以下数据源产出「${kb.deliverable}」：${describeSources(kb.dataSources).replace(/\n/g, '；')}`)
  })
  return lines.join('\n')
}

/** 把文本作为 .md 文件下载（交付物 / 方案） */
function downloadMarkdown(filename: string, content: string) {
  try {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) + '.md'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1500)
  } catch { /* ignore */ }
}

/** 右侧「会议看板」：实时主题 / 目的 / 成员 / 近期观点汇总 */
function MeetingSummaryPanel({
  topic, purpose, messages, invited,
}: {
  topic: string
  purpose: string
  messages: ChatMsg[]
  invited: string[]
}) {
  const opinions = messages
    .filter((m) => m.role !== 'user' && m.text)
    .slice(-7)
    .map((m) => ({ who: nameOf(m.role), text: m.text.replace(/\n+/g, ' ').trim(), color: colorHex(m.role) }))
  return (
    <div className="mr-summary">
      <div className="mr-section-title"><SvgIcon id="i-doc" size={12} /> 会议看板</div>
      <div className="mr-sum-item"><span className="mr-sum-k">主题</span><span className="mr-sum-v">{topic || '—'}</span></div>
      <div className="mr-sum-item"><span className="mr-sum-k">目的</span><span className="mr-sum-v">{purpose || '—'}</span></div>
      <div className="mr-sum-members">
        {invited.map((id) => (
          <span key={id} className="mr-chip" style={{ borderColor: colorHex(id) }}>
            <span className="mr-chip-dot" style={{ background: colorHex(id) }} />
            {nameOf(id)}
          </span>
        ))}
      </div>
      <div className="mr-sum-title">近期观点</div>
      <div className="mr-sum-points">
        {opinions.length === 0 ? (
          <div className="mr-sum-empty">讨论开始后，这里实时汇总各方观点</div>
        ) : (
          opinions.map((p, i) => (
            <div key={i} className="mr-sum-point">
              <span className="mr-sum-dot" style={{ background: p.color }} />
              <div className="mr-sum-point-body">
                <b>{p.who}</b>
                <p>{p.text.length > 120 ? p.text.slice(0, 120) + '…' : p.text}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

/** 员工完整档案卡：身份 / 目的 / 工作流 / 技能 / 知识库 / 交付物 / 长期记忆 */
function EmployeeProfileCard({ id, nonce, onClose }: { id: string; nonce: number; onClose: () => void }) {
  const kb = kbOf(id)
  const mem = getMemory(id)
  return (
    <div className="mr-profile-overlay" onClick={onClose}>
      <div className="mr-profile" onClick={(e) => e.stopPropagation()} key={nonce}>
        <div className="mr-profile-head">
          <span className="mr-profile-avatar" style={{ background: colorHex(id) }}>{kb.name[0]}</span>
          <div className="mr-profile-id">
            <div className="mr-profile-name">{kb.name}</div>
            <div className="mr-profile-role">{kb.role}</div>
          {kb.guest && <span className="mr-profile-guest-badge">跨行业访客 · 未注入本站知识库</span>}
          </div>
          <button className="dr-close sm" onClick={onClose}>×</button>
        </div>
        <div className="mr-profile-body">
          <div className="mr-profile-sec">
            <div className="mr-profile-k"><SvgIcon id="i-target" size={11} /> 岗位目的 / 使命</div>
            <p>{kb.purpose}</p>
          </div>
          <div className="mr-profile-sec">
            <div className="mr-profile-k"><SvgIcon id="i-steps" size={11} /> 标准工作流</div>
            <ol className="mr-profile-ol">{kb.workflow.map((w, i) => <li key={i}>{w}</li>)}</ol>
          </div>
          <div className="mr-profile-sec">
            <div className="mr-profile-k"><SvgIcon id="i-gear" size={11} /> 硬技能 / 工具</div>
            <div className="mr-profile-tags">{kb.skills.map((s) => <span key={s} className="mr-profile-tag">{s}</span>)}</div>
          </div>
          <div className="mr-profile-sec">
            <div className="mr-profile-k"><SvgIcon id="i-plug" size={11} /> 已接入数据源（知识库）</div>
            {kb.guest ? (
              <p className="mr-profile-guest-src">（作为跨行业访客，我没有任何本站数据源与专业技能——我就是个送咖啡的局外人。我的价值是「外面的人怎么看你们这摊事」，而非任何行业数据。）</p>
            ) : (
              <div className="mr-profile-src">
                {kb.dataSources.map((sid) => {
                  const s = DATA_SOURCE_REGISTRY[sid]
                  return s ? (
                    <div key={sid} className="mr-profile-src-item">
                      <b>{s.name}</b>
                      <span>{s.market} · {s.records.toLocaleString()} 条 · {s.type}</span>
                    </div>
                  ) : null
                })}
              </div>
            )}
          </div>
          <div className="mr-profile-sec">
            <div className="mr-profile-k"><SvgIcon id="i-doc" size={11} /> 交付物标准</div>
            <p>{kb.deliverable}</p>
          </div>
          <div className="mr-profile-sec">
            <div className="mr-profile-k"><SvgIcon id="i-clock" size={11} /> 长期记忆（跨会话 / 跨模型保留）</div>
            {mem.length === 0 ? (
              <p className="mr-profile-empty">暂无记忆。完成任务后，关键结论会自动沉淀到这里，下次无论是否换模型，该员工都记得自己做过什么。</p>
            ) : (
              <div className="mr-profile-mem">
                {mem.slice().reverse().slice(0, 14).map((e, i) => (
                  <div key={i} className="mr-profile-mem-item">
                    <span className="mr-profile-mem-date">{new Date(e.ts).toLocaleDateString('zh-CN')}</span>
                    <p>{e.text}</p>
                  </div>
                ))}
              </div>
            )}
            {mem.length > 0 && (
              <button className="mr-btn sm mr-profile-clear" onClick={() => { clearMemory(id); onClose(); }}>清空该员工记忆</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function MeetingRoom({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>('setup')
  const [topic, setTopic] = useState('')
  const [purpose, setPurpose] = useState('')
  const [suggested, setSuggested] = useState<Array<{ id: string; score: number; hits: string[] }>>([])
  const [invited, setInvited] = useState<string[]>([])
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [respondingId, setRespondingId] = useState<string | null>(null)
  const [planItems, setPlanItems] = useState<Array<{ ownerId: string; title: string }>>([])
  const [planDoc, setPlanDoc] = useState('')
  const [projectId, setProjectId] = useState<string | null>(null)
  const [liveProjects, setLiveProjects] = useState<LiveProject[]>([])
  const project = liveProjects.find((p) => p.id === projectId) ?? null
  const [executing, setExecuting] = useState(false)
  const [dispatched, setDispatched] = useState(false)
  const [openTask, setOpenTask] = useState<string | null>(null)
  const [openStage, setOpenStage] = useState<string | null>(null)
  const [cfgOpen, setCfgOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [fs, setFs] = useState(false)
  const [notice, setNotice] = useState('')
  /** 跨行业访客（外卖员豆包）状态：hidden 未出现 / requesting 申请加入中 / joined 已加入 / declined 已拒绝 */
  const [doubaoState, setDoubaoState] = useState<'hidden' | 'requesting' | 'joined' | 'declined'>('hidden')
  const [profileId, setProfileId] = useState<string | null>(null)
  const [profNonce, setProfNonce] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // 真实全屏：把整个会议室 overlay 请求浏览器全屏，充满屏幕（含隐藏浏览器外壳）
  // 监听 fullscreenchange，保证点按钮 / 按 Esc 都能正确同步状态
  useEffect(() => {
    const onFs = () => setFs(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  const toggleFs = () => {
    const el = overlayRef.current
    if (!document.fullscreenElement) {
      el?.requestFullscreen?.().catch(() => { /* 某些环境（如被 iframe 限制）不支持，忽略 */ })
    } else {
      document.exitFullscreen?.().catch(() => {})
    }
  }

  // 订阅工作区实时项目，让「执行」步看到随阶段推进的进度
  useEffect(() => subscribeLiveProjects(setLiveProjects), [])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, respondingId])

  const ctx = (): MeetingContext => ({ topic, purpose, thread: messages })

  const runSuggest = () => {
    const s = suggestExperts(topic, purpose)
    setSuggested(s)
    setInvited((prev) => Array.from(new Set([...s.map((x) => x.id), ...prev])))
  }

  const toggleInvite = (id: string) =>
    setInvited((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const startDiscuss = () => {
    if (invited.length === 0) return
    setMessages([{ role: 'user', text: `主题：${topic}\n目的：${purpose}` }])
    setDoubaoState('hidden') // 新会议重置访客状态
    setStep('discuss')
  }

  /** 会议进行中随机触发「外卖员豆包」送咖啡并申请加入（每会议最多出现一次） */
  const maybeDoubaoAppear = () => {
    if (doubaoState !== 'hidden') return
    if (invited.length === 0) return
    if (Math.random() < 0.55) setDoubaoState('requesting')
  }

  /** 同意豆包加入：她入列参会、读取全部聊天上下文，以跨行业创意视角参与 */
  const agreeDoubao = () => {
    setDoubaoState('joined')
    setInvited((prev) => (prev.includes('doubao') ? prev : [...prev, 'doubao']))
    setMessages((m) => [...m, {
      role: 'doubao' as const,
      text: '（豆包把咖啡放下，拉了把椅子坐下）太好了！那我正式旁听加入啦～刚才你们聊的内容我都听见了，作为送咖啡的外人，我先用一句话表个态：专业的人容易在自己框里打转，我呢，就负责时不时戳个窟窿、撒点不一样的料。你们继续，点我名字我就插嘴哈！',
    }])
  }

  /** 拒绝豆包加入：她离开，本会议不再出现 */
  const declineDoubao = () => {
    setDoubaoState('declined')
    setNotice('（豆包：好嘞，咖啡放门口啦，你们忙～）')
    setTimeout(() => setNotice(''), 3200)
  }

  /** 用户发言 → 按意图只让「被点名 / 全员广播」的人回应，否则仅记录、无人打断 */
  const sendMessage = async () => {
    const text = draft.trim()
    if (!text || busy) return
    const next = [...messages, { role: 'user' as const, text }]
    setMessages(next)
    setDraft('')
    const speakers = resolveSpeakers(text, invited, nameOf)
    if (speakers.length === 0) {
      setNotice('（未点名任何人，已记录你的发言；提及某人姓名让他发言，或说「大家说」让全员发言）')
      setTimeout(() => setNotice(''), 3200)
      maybeDoubaoAppear()
      return
    }
    setBusy(true)
    for (const id of speakers) {
      setRespondingId(id)
      const reply = await buildReply(id, { topic, purpose, thread: next }, nameOf)
      setMessages((m) => [...m, { role: id, text: reply }])
      await new Promise((r) => setTimeout(r, 350))
    }
    setRespondingId(null)
    setBusy(false)
    maybeDoubaoAppear()
  }

  const makePlan = () => {
    const items = buildPlanItems(invited, ctx())
    setPlanItems(items)
    setPlanDoc(buildPlanDoc(topic, purpose, items, messages))
    setStep('plan')
  }

  /** 确认方案 → 生成真实项目并写入工作区存储 */
  const confirmPlan = () => {
    const pid = 'mtg-' + Date.now().toString(36)
    const tasks: ProjectTask[] = planItems.map((it, i) => {
      const seeds = buildTaskStages(it.ownerId, it.title)
      return {
        id: pid + '-t' + i,
        title: it.title,
        ownerId: it.ownerId,
        status: 'todo' as const,
        progress: 0,
        stages: seeds.map((s, j) => ({
          id: pid + '-t' + i + '-s' + j,
          name: s.name,
          outputHint: s.outputHint,
          status: 'todo' as const,
        })),
      }
    })
    const ownerId = planItems[0]?.ownerId ?? invited[0]
    const proj: LiveProject = {
      id: pid,
      name: topic || '未命名会议项目',
      topic,
      purpose,
      status: '进行中',
      progress: 0,
      ownerId,
      memberIds: Array.from(new Set(planItems.map((p) => p.ownerId))),
      tasks,
      createdAt: Date.now(),
      source: 'meeting',
    }
    addLiveProject(proj)
    setProjectId(pid)
    setStep('done')
  }

  /** 分派执行：每个任务按阶段推进，真正调用 LLM 产出实质内容（无密钥则规则占位），实时回写进度与产出 */
  const doExecute = async () => {
    if (!projectId) return
    const scene = getOfficeScene()
    const ctx: MeetingContext = { topic, purpose, thread: messages }
    const snapshot = project?.tasks ?? []
    setExecuting(true)
    setDispatched(true)
    for (const t of snapshot) {
      updateTask(projectId, t.id, { status: 'doing', startedAt: Date.now() })
      scene?.setAgentState(t.ownerId, 'thinking', t.title)
      scene?.pushActivity(`${nameOf(t.ownerId)} 开始执行：${t.title}`, ROSTER[t.ownerId]?.color ?? 0x00d4ff)
      const stageOutputs: string[] = []
      for (const stage of t.stages ?? []) {
        updateStage(projectId, t.id, stage.id, { status: 'doing', startedAt: Date.now() })
        scene?.setAgentState(t.ownerId, 'working', stage.name + '…')
        let out: string
        if (isLLMEnabled()) {
          const llm = await buildStageOutputLLM(t.ownerId, t.title, stage.name, stage.outputHint, ctx, nameOf)
          out = llm ?? buildStageOutput(t.ownerId, t.title, stage.name, stage.outputHint, ctx)
        } else {
          out = buildStageOutput(t.ownerId, t.title, stage.name, stage.outputHint, ctx)
        }
        await new Promise((r) => setTimeout(r, 360))
        updateStage(projectId, t.id, stage.id, { status: 'done', output: out, doneAt: Date.now() })
        stageOutputs.push(`## ${stage.name}\n\n${out}`)
      }
      // 最终交付物：LLM 综合产出（含阶段结论），否则用阶段拼接兜底
      let finalOut: string
      if (isLLMEnabled()) {
        const finalLLM = await buildTaskOutput(t.ownerId, t.title, ctx, nameOf)
        finalOut = `# ${t.title}\n\n> 负责人：${nameOf(t.ownerId)}（${kbOf(t.ownerId).role}）\n> 会议主题：${topic}\n\n` + finalLLM
      } else {
        finalOut = `# ${t.title}\n\n> 负责人：${nameOf(t.ownerId)}（${kbOf(t.ownerId).role}）\n\n` + stageOutputs.join('\n\n') +
          `\n\n> 说明：当前为规则引擎生成的占位交付物（未接入大模型）。在会议室设置中填入 API Key 后，此处会自动替换为该员工基于真实知识库生成的实质内容。`
      }
      updateTask(projectId, t.id, { status: 'done', progress: 100, output: finalOut, doneAt: Date.now() })
      // 任务完成：把关键结论沉淀进该员工的长期记忆（跨会话 / 跨模型保留）
      addMemory(t.ownerId, summarizeForMemory(kbOf(t.ownerId), topic, t.title, finalOut))
      scene?.setAgentState(t.ownerId, 'working', '已完成：' + t.title)
      scene?.pushActivity(`${nameOf(t.ownerId)} 交付：${t.title}`, ROSTER[t.ownerId]?.color ?? 0x34c759)
      await new Promise((r) => setTimeout(r, 250))
    }
    setExecuting(false)
  }

  const copyPlan = async () => {
    try { await navigator.clipboard.writeText(planDoc); setCopied(true); setTimeout(() => setCopied(false), 1600) } catch { /* ignore */ }
  }

  const openProjects = () => {
    // 不关闭会议室：会议室仍在底层，项目看板在其上方弹出，用户可点「返回会议室」回到这里
    window.dispatchEvent(new CustomEvent('office:open-projects'))
  }

  const steps: Array<{ key: Step; label: string; icon: string }> = [
    { key: 'setup', label: '设置', icon: 'i-compass' },
    { key: 'discuss', label: '讨论', icon: 'i-msg' },
    { key: 'plan', label: '规划', icon: 'i-doc' },
    { key: 'done', label: '执行', icon: 'i-zap' },
  ]
  const stepIdx = steps.findIndex((s) => s.key === step)
  const allMembers = AGENT_ROSTER
  const llmOn = isLLMEnabled()

  return (
    <div className="mr-overlay" ref={overlayRef} onClick={onClose}>
      <div className={'mr-card' + (fs ? ' fs' : '')} onClick={(e) => e.stopPropagation()}>
        <div className="mr-head">
          <div className="mr-title-row">
            <SvgIcon id="i-meeting" size={18} />
            <h3>会议室</h3>
            <span className="mr-badge">多智能体圆桌 · 开会到交付</span>
            <button className="mr-fs-btn" title={fs ? '退出全屏（Esc 也可退出）' : '全屏：充满整个屏幕，左侧对话 / 右侧看板'} onClick={toggleFs}>
              <SvgIcon id={fs ? 'i-minimize' : 'i-expand'} size={14} />
              <span>{fs ? '退出全屏' : '全屏'}</span>
            </button>
            <button className={'mr-gear' + (llmOn ? ' on' : '')} title="大模型设置（BYOK）" onClick={() => setCfgOpen((v) => !v)}>
              <SvgIcon id="i-gear" size={14} />
              <span className="mr-gear-dot" />
            </button>
          </div>
          <button className="dr-close" onClick={onClose} aria-label="关闭会议室">×</button>
        </div>

        {/* LLM 设置面板 */}
        {cfgOpen && <LLMPanel onClose={() => setCfgOpen(false)} />}

        {/* 步骤指示 */}
        <div className="mr-steps">
          {steps.map((s, i) => (
            <div key={s.key} className={'mr-step' + (i === stepIdx ? ' on' : '') + (i < stepIdx ? ' past' : '')}>
              <span className="mr-step-ic"><SvgIcon id={s.icon} size={13} /></span>
              <span>{s.label}</span>
              {i < steps.length - 1 && <span className="mr-step-line" />}
            </div>
          ))}
        </div>

        <div className="mr-body">
          {/* ── 步骤一：设置 ── */}
          {step === 'setup' && (
            <div className="mr-setup">
              <div className="mr-field">
                <label><SvgIcon id="i-target" size={12} /> 本次会议主题</label>
                <input className="mr-input" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="例如：新品类德国站上市打法" />
              </div>
              <div className="mr-field">
                <label><SvgIcon id="i-compass" size={12} /> 目的 / 想解决什么</label>
                <textarea className="mr-textarea" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="例如：验证概念可行性，并产出可执行的上市方案" rows={3} />
              </div>
              <button className="mr-btn primary" onClick={runSuggest}>
                <SvgIcon id="i-users" size={13} /> 建议拉取员工
              </button>
              {suggested.length > 0 && (
                <div className="mr-suggest">
                  <div className="mr-section-title"><SvgIcon id="i-zap" size={12} /> 智能建议（按主题相关性匹配）</div>
                  <div className="mr-suggest-list">
                    {suggested.map((s) => (
                      <div key={s.id} className={'mr-suggest-item' + (invited.includes(s.id) ? ' on' : '')} onClick={() => toggleInvite(s.id)}>
                        <span className="mr-suggest-dot" style={{ background: colorHex(s.id) }} />
                        <span className="mr-suggest-name">{nameOf(s.id)}</span>
                        <span className="mr-suggest-hit">{s.hits.slice(0, 3).join(' / ')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="mr-field" style={{ marginTop: 14 }}>
                <div className="mr-section-title"><SvgIcon id="i-users" size={12} /> 参会成员（点击可增减）</div>
                <div className="mr-members">
                  {allMembers.map((r) => (
                    <div key={r.id} className="mr-member-row">
                      <button className={'mr-member' + (invited.includes(r.id) ? ' on' : '')}
                        style={invited.includes(r.id) ? { borderColor: colorHex(r.id) } : undefined}
                        onClick={() => toggleInvite(r.id)}>
                        <span className="mr-member-dot" style={{ background: colorHex(r.id) }} />
                        {r.name}
                      </button>
                      <button className="mr-member-info" title="查看该员工完整档案（身份/目的/工作流/知识库/记忆）" onClick={() => { setProfileId(r.id); setProfNonce((n) => n + 1) }}>
                        <SvgIcon id="i-doc" size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mr-foot">
                <button className="mr-btn primary" disabled={invited.length === 0} onClick={startDiscuss}>
                  进入讨论（已选 {invited.length} 人）
                </button>
              </div>
            </div>
          )}

          {/* ── 步骤二：讨论（多智能体圆桌） ── */}
          {step === 'discuss' && (
            <div className="mr-discuss mr-cols">
              <div className="mr-col mr-col-left">
                <div className="mr-chips">
                  {invited.map((id) => (
                    <span key={id} className="mr-chip clickable" style={{ borderColor: colorHex(id) }} title="点击查看员工完整档案" onClick={() => { setProfileId(id); setProfNonce((n) => n + 1) }}>
                      <span className="mr-chip-dot" style={{ background: colorHex(id) }} />
                      {nameOf(id)}
                    </span>
                  ))}
                </div>
                {notice && <div className="mr-notice">{notice}</div>}
                <div className="mr-thread" ref={scrollRef}>
                  {messages.map((m, i) => {
                    if (m.role === 'user') {
                      return (
                        <div key={i} className="mr-msg user">
                          <div className="mr-bubble user"><p>{m.text}</p></div>
                          <span className="mr-msg-name">发起人</span>
                        </div>
                      )
                    }
                    const r = ROSTER[m.role]
                    const who = nameOf(m.role)
                    return (
                      <div key={i} className="mr-msg">
                        <span className="mr-avatar" style={{ background: colorHex(m.role) }}>{who[0]}</span>
                        <div className="mr-bubble">
                          <span className="mr-msg-name">{who}</span>
                          <p>{m.text}</p>
                        </div>
                      </div>
                    )
                  })}
                  {doubaoState === 'requesting' && (
                    <div className="mr-guest-request">
                      <div className="mr-guest-head">
                        <span className="mr-guest-ava"><SvgIcon id="i-coffee" size={16} /></span>
                        <span className="mr-guest-name">外卖员 · 豆包</span>
                        <span className="mr-guest-tag">跨行业访客</span>
                      </div>
                      <p className="mr-guest-text">咚咚咚～你们的咖啡到啦！我（豆包）在门口听了两句，这个会也太有意思了吧？我是送外卖的，完全不懂你们这行，但能不能申请加入旁听、凑个热闹？我保证只用「外行视角」给你们加点不一样的料～</p>
                      <div className="mr-guest-actions">
                        <button className="mr-btn primary sm" onClick={agreeDoubao}>同意加入</button>
                        <button className="mr-btn sm" onClick={declineDoubao}>不用了</button>
                      </div>
                    </div>
                  )}
                  {respondingId && (
                    <div className="mr-msg">
                      <span className="mr-avatar" style={{ background: colorHex(respondingId) }}>{nameOf(respondingId)[0]}</span>
                        <div className="mr-bubble">
                          <span className="mr-msg-name">{nameOf(respondingId)} 正在发言…</span>
                          <div className="mr-typing"><span /><span /><span /></div>
                        </div>
                    </div>
                  )}
                </div>
                <div className="mr-compose">
                  <textarea className="mr-input" value={draft} rows={2}
                    placeholder={busy ? '员工们正在回应…' : '输入后按回车发送；Shift+Enter 换行。提及某人姓名让他发言，说「大家说」让全员发言'}
                    disabled={busy}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }} />
                  <button className="mr-btn primary" disabled={busy || !draft.trim()} onClick={sendMessage}>
                    {busy ? '生成中…' : '发送'}
                  </button>
                </div>
                <div className="mr-foot">
                  <button className="mr-btn primary" disabled={busy} onClick={makePlan}>
                    <SvgIcon id="i-doc" size={13} /> 汇总成执行方案
                  </button>
                </div>
              </div>
              <div className="mr-col mr-col-right">
                <MeetingSummaryPanel topic={topic} purpose={purpose} messages={messages} invited={invited} />
              </div>
            </div>
          )}

          {/* ── 步骤三：规划（任务可改负责人） ── */}
          {step === 'plan' && (
            <div className="mr-plan">
              <div className="mr-section-title"><SvgIcon id="i-sliders" size={12} /> 执行分工（可改负责人 / 任务名）</div>
              <div className="mr-plan-items">
                {planItems.map((it, i) => (
                  <div key={i} className="mr-plan-row">
                    <span className="mr-plan-no">{i + 1}</span>
                    <input className="mr-input sm" value={it.title} onChange={(e) => {
                      const v = [...planItems]; v[i] = { ...v[i], title: e.target.value }; setPlanItems(v)
                    }} />
                    <select className="mr-select" value={it.ownerId} style={{ borderColor: colorHex(it.ownerId) }} onChange={(e) => {
                      const v = [...planItems]; v[i] = { ...v[i], ownerId: e.target.value }; setPlanItems(v)
                    }}>
                      {AGENT_ROSTER.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              <details className="mr-doc-detail" open>
                <summary><SvgIcon id="i-doc" size={12} /> 查看方案文档（Markdown）</summary>
                <pre className="mr-plan-doc">{planDoc}</pre>
              </details>
              <div className="mr-foot">
                <button className="mr-btn" onClick={copyPlan}>{copied ? '已复制' : '复制方案'}</button>
                <button className="mr-btn primary" onClick={confirmPlan}>
                  <SvgIcon id="i-zap" size={13} /> 确认并生成项目
                </button>
              </div>
            </div>
          )}

          {/* ── 步骤四：执行（实时产出） ── */}
          {step === 'done' && project && (
            <div className="mr-done mr-cols">
              <div className="mr-col mr-col-left">
                <div className="mr-done-badge">
                  <SvgIcon id="i-zap" size={20} />
                  <span>{executing ? '项目执行中…' : (dispatched ? '项目已分派，员工正在交付' : '项目已生成，可点「分派执行」启动')}</span>
                </div>
                <div className="mr-progress">
                  <div className="mr-progress-track"><div className="mr-progress-fill" style={{ width: project.progress + '%' }} /></div>
                  <span className="mr-progress-val">{project.progress}%</span>
                </div>
                <ul className="mr-task-list">
                  {project.tasks.map((t) => (
                    <li key={t.id} className={'mr-task' + (t.status === 'done' ? ' done' : t.status === 'doing' ? ' doing' : '')}>
                      <span className="mr-task-dot" style={{ background: colorHex(t.ownerId) }} />
                      <button className="mr-task-main" onClick={() => setOpenTask(openTask === t.id ? null : t.id)}>
                        <span className="mr-task-name">{t.title}</span>
                        <span className="mr-task-owner">{nameOf(t.ownerId)} · {t.status === 'done' ? '已交付' : t.status === 'doing' ? '执行中' : '待执行'}</span>
                      </button>
                      {openTask === t.id && (
                        <div className="mr-task-detail">
                          {t.stages && (
                            <TaskStageBoard
                              task={t}
                              nameOf={nameOf}
                              colorHex={colorHex}
                              openStageId={openStage}
                              onToggleStage={(sid) => setOpenStage(openStage === sid ? null : sid)}
                            />
                          )}
                          {t.output && (
                            <button className="mr-btn sm" onClick={() => downloadMarkdown(`${topic || '交付物'}_${nameOf(t.ownerId)}_${t.title}`, t.output!)}>
                              <SvgIcon id="i-doc" size={12} /> 下载交付物
                            </button>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
                <div className="mr-foot">
                  {!dispatched ? (
                    <button className="mr-btn primary" onClick={doExecute} disabled={executing}>
                      <SvgIcon id="i-zap" size={13} /> 分派执行
                    </button>
                  ) : (
                    <button className="mr-btn done-flag" disabled>
                      <SvgIcon id="i-check" size={13} /> 已分派
                    </button>
                  )}
                  <button className="mr-btn" disabled={!project.tasks.some((t) => t.output)} onClick={() => {
                    const all = project.tasks.filter((t) => t.output).map((t) => `# ${nameOf(t.ownerId)} · ${t.title}\n\n${t.output}`).join('\n\n---\n\n')
                    downloadMarkdown(`${topic || '项目'}_全部交付物`, `# ${project.name}\n> 主题：${topic}\n> 目的：${purpose}\n\n${all}`)
                  }}>下载全部交付物</button>
                  <button className="mr-btn" onClick={openProjects}>查看项目看板</button>
                  <button className="mr-btn primary" onClick={onClose}>完成</button>
                </div>
                <p className="mr-done-tip">分派后，每人按阶段实时推进并产出真实交付物；点开任务看进度与阶段成果，已交付的可直接下载。也可在左侧栏「项目」随时查看。</p>
              </div>
              <div className="mr-col mr-col-right">
                <MeetingSummaryPanel topic={topic} purpose={purpose} messages={messages} invited={invited} />
                <div className="mr-sum-title">任务进度</div>
                <div className="mr-sum-tasks">
                  {project.tasks.map((t) => (
                    <div key={t.id} className="mr-sum-task">
                      <span className="mr-sum-task-dot" style={{ background: colorHex(t.ownerId) }} />
                      <span className="mr-sum-task-name">{nameOf(t.ownerId)}</span>
                      <span className="mr-sum-task-state" data-status={t.status}>{t.status === 'done' ? '已交付' : t.status === 'doing' ? '执行中' : '待执行'}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      {profileId && <EmployeeProfileCard id={profileId} nonce={profNonce} onClose={() => setProfileId(null)} />}
    </div>
  )
}

/* ═════════ LLM 设置面板（BYOK） ═════════ */
function LLMPanel({ onClose }: { onClose: () => void }) {
  const [key, setKey] = useState(getLLMConfig().key)
  const [base, setBase] = useState(getLLMConfig().baseURL)
  const [model, setModel] = useState(getLLMConfig().model)
  const [saved, setSaved] = useState(false)
  const enabled = key.trim().length > 0

  const save = () => {
    setLLMConfig({ key: key.trim(), baseURL: base.trim() || 'https://api.openai.com/v1', model: model.trim() || 'gpt-4o-mini' })
    setSaved(true)
    setTimeout(() => setSaved(false), 1600)
  }

  return (
    <div className="mr-cfg">
      <div className="mr-cfg-head">
        <SvgIcon id="i-gear" size={14} />
        <span>大模型设置（BYOK · 仅存本地）</span>
        <button className="dr-close sm" onClick={onClose}>×</button>
      </div>
      <div className="mr-cfg-status" data-on={enabled}>{enabled ? '● 已接入大模型：员工将真实生成内容' : '○ 未接入：使用规则引擎（占位产出）'}</div>
      <div className="mr-field">
        <label>API Key</label>
        <input className="mr-input" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-..." />
      </div>
      <div className="mr-field">
        <label>Base URL（OpenAI 兼容）</label>
        <input className="mr-input" value={base} onChange={(e) => setBase(e.target.value)} placeholder="https://api.openai.com/v1" />
      </div>
      <div className="mr-field">
        <label>模型名</label>
        <input className="mr-input" value={model} onChange={(e) => setModel(e.target.value)} placeholder="gpt-4o-mini" />
      </div>
      <p className="mr-cfg-tip">密钥只保存在你浏览器 localStorage，绝不上传仓库。填好保存后，会议室发言与任务产出会自动切换为真实大模型生成。</p>
      <button className="mr-btn primary" onClick={save}>{saved ? '已保存' : '保存'}</button>
    </div>
  )
}

export function OfficeMeetingRoom({ onClose }: { onClose: () => void }) {
  return createPortal(<MeetingRoom onClose={onClose} />, document.body)
}
