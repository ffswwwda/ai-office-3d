import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { AGENT_ROSTER, MEETING_EXPERTS } from '@/scene/layout/officeLayout'
import { getOfficeScene } from '@/scene/officeSceneBridge'

function SvgIcon({ id, size = 14 }: { id: string; size?: number }) {
  return <svg viewBox="0 0 24 24" width={size} height={size}><use href={'#' + id}/></svg>
}

const ROSTER: Record<string, { id: string; name: string; color: number; task: string }> =
  Object.fromEntries(AGENT_ROSTER.map(r => [r.id, r]))
const EXPERT: Record<string, { id: string; competency: string; keywords: string[] }> =
  Object.fromEntries(MEETING_EXPERTS.map(e => [e.id, e]))

type Stance = '支持' | '存疑' | '补充'
type Step = 'setup' | 'discuss' | 'plan' | 'done'
type Opinion = { stance: Stance; view: string; risk: string; advice: string }

/** 「建议拉取员工」：按主题/目的关键词命中打分排序 */
function suggestExperts(topic: string, purpose: string) {
  const text = (topic + ' ' + purpose).toLowerCase()
  return MEETING_EXPERTS
    .map(e => {
      const hits = e.keywords.filter(k => text.includes(k.toLowerCase()))
      return { id: e.id, score: hits.length, hits }
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
}

/** 每位员工基于自身能力 + 会议内容生成评估意见（规则引擎，无需 LLM） */
function buildOpinion(id: string, topic: string, purpose: string, plan: string): Opinion {
  const expert = EXPERT[id]
  const text = (topic + ' ' + purpose + ' ' + plan).toLowerCase()
  const hit = expert.keywords.some(k => text.includes(k.toLowerCase()))
  const riskWord = /风险|不确定|担心|可能|存疑|隐患|翻车/.test(purpose + plan)
  const stance: Stance = hit ? (riskWord ? '存疑' : '支持') : '补充'

  const T: Record<string, { view: string; risk: string; advice: string }> = {
    voc: {
      view: `从 VOC 角度，用户反馈里和「${topic}」最相关的痛点值得先打标确认。`,
      risk: '低分评论覆盖到了，但长尾小众需求容易被平均掉，需留意样本偏差。',
      advice: '先跑一遍 9 维打标，把相关痛点标签拉出来做证据底座，再谈方案。',
    },
    score: {
      view: '用四维评分框一下：痛点匹配、技术可行、市场机会、竞争差异逐项过。',
      risk: '某维度证据不足时，得分会飘，结论不可信。',
      advice: '用需求打分引擎给概念出一份可溯源评分报告，每项附原文证据。',
    },
    lab: {
      view: '放进数字世界推演，注入定价 / 卖点 / 渠道变量看群体演化。',
      risk: '模型对极端分群敏感，未校准时会被平均意见稀释。',
      advice: '跑 L2 纯前端仿真，给乐观 / 中性 / 悲观三场景差异化输出。',
    },
    dev: {
      view: `用 TRIZ / SCAMPER 给「${topic}」长出几个产品开发方向。`,
      risk: '创意易发散，不锚定可落地就会变成脑洞集。',
      advice: '盲盒抽方向 + 配 FABE 文案与多语言 listing 模板。',
    },
    idea: {
      view: '从六维创意矿脉（外观 / 功能 / 场景 / 情感 / 技术 / 叙事）挖可执行的创意图。',
      risk: '审美主观，脱离市场预期会自嗨。',
      advice: '出创意图 + 用户情绪映射，对照市场流行设计语言校准。',
    },
    stress: {
      view: '把方案丢进虚拟用户群，找最极端的反对声音。',
      risk: '翻车点常藏在沉默多数里，不只看支持率。',
      advice: '跑压力测试，输出风险预警清单与极端用户画像 Top5。',
    },
    pr: {
      view: `「${topic}」要出海，需转成各市场地道表达而非直译。`,
      risk: '直译会丢转化力，还可能踩文化雷区引发反感。',
      advice: '用各市场用户语料做母语级改写，附文化敏感词清单。',
    },
  }
  const t = T[id]!
  return { stance, view: t.view, risk: t.risk, advice: t.advice }
}

/** 综合规划 + 执行方案文档（Markdown） */
function buildPlan(topic: string, purpose: string, plan: string, invited: string[], opinions: Record<string, Opinion>) {
  const lines: string[] = []
  lines.push('# 会议规划与执行方案')
  lines.push(`> 主题：${topic || '（未填写）'}`)
  lines.push(`> 目的：${purpose || '（未填写）'}`)
  lines.push('')
  lines.push('## 一、会议目标')
  lines.push(`- 围绕「${topic}」展开，目的为：${purpose}`)
  lines.push('')
  lines.push('## 二、参会成员评估要点')
  invited.forEach(id => {
    const o = opinions[id]; const r = ROSTER[id]
    lines.push(`- **${r.name}（${EXPERT[id].competency}）** · 立场：${o.stance}`)
    lines.push(`  - 观点：${o.view}`)
  })
  lines.push('')
  lines.push('## 三、风险清单')
  lines.push(invited.map(id => `- ${ROSTER[id].name}：${opinions[id].risk}`).join('\n') || '- 暂无')
  lines.push('')
  lines.push('## 四、执行分工')
  invited.forEach(id => {
    const r = ROSTER[id]
    lines.push(`- **${r.name}**：任务——${EXPERT[id].competency}；交付物——${opinions[id].advice}`)
  })
  lines.push('')
  lines.push('## 五、发起人方案要点')
  lines.push(plan || '（未填写详细方案）')
  return lines.join('\n')
}

function MeetingRoom({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>('setup')
  const [topic, setTopic] = useState('')
  const [purpose, setPurpose] = useState('')
  const [suggested, setSuggested] = useState<Array<{ id: string; score: number; hits: string[] }>>([])
  const [invited, setInvited] = useState<string[]>([])
  const [plan, setPlan] = useState('')
  const [opinions, setOpinions] = useState<Record<string, Opinion>>({})
  const [planDoc, setPlanDoc] = useState('')
  const [executed, setExecuted] = useState<string[]>([])
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const runSuggest = () => {
    const s = suggestExperts(topic, purpose)
    setSuggested(s)
    // 默认预选命中的员工
    setInvited(prev => {
      const base = s.map(x => x.id)
      const merged = Array.from(new Set([...base, ...prev]))
      return merged
    })
  }

  const toggleInvite = (id: string) => {
    setInvited(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const startDiscuss = () => {
    if (invited.length === 0) return
    const ops: Record<string, Opinion> = {}
    invited.forEach(id => { ops[id] = buildOpinion(id, topic, purpose, plan) })
    setOpinions(ops)
    setStep('discuss')
  }

  const makePlan = () => {
    setPlanDoc(buildPlan(topic, purpose, plan, invited, opinions))
    setStep('plan')
  }

  const doExecute = () => {
    const scene = getOfficeScene()
    const done: string[] = []
    if (scene) {
      invited.forEach(id => {
        const r = ROSTER[id]
        const task = EXPERT[id].competency
        scene.setAgentState(id, 'working', '执行会议任务：' + task)
        scene.pushActivity(`${r.name} 接受会议任务，开始执行：${task}`, r.color)
        done.push(r.name)
      })
      scene.pushActivity('会议室散会，进入执行阶段', 0x00d4ff)
    }
    setExecuted(done)
    setStep('done')
  }

  const copyPlan = async () => {
    try { await navigator.clipboard.writeText(planDoc); setCopied(true); setTimeout(() => setCopied(false), 1600) } catch { /* ignore */ }
  }

  const steps: Array<{ key: Step; label: string; icon: string }> = [
    { key: 'setup', label: '设置', icon: 'i-compass' },
    { key: 'discuss', label: '讨论', icon: 'i-msg' },
    { key: 'plan', label: '规划', icon: 'i-doc' },
    { key: 'done', label: '执行', icon: 'i-zap' },
  ]
  const stepIdx = steps.findIndex(s => s.key === step)

  const allMembers = AGENT_ROSTER

  return (
    <div className="mr-overlay" onClick={onClose}>
      <div className="mr-card" onClick={e => e.stopPropagation()}>
        <div className="mr-head">
          <div className="mr-title-row">
            <SvgIcon id="i-meeting" size={18} />
            <h3>会议室</h3>
            <span className="mr-badge">把相关员工拉进来一起想方案</span>
          </div>
          <button className="dr-close" onClick={onClose} aria-label="关闭会议室">×</button>
        </div>

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
                <input
                  className="mr-input" value={topic}
                  onChange={e => setTopic(e.target.value)}
                  placeholder="例如：新品类德国站上市打法"
                />
              </div>
              <div className="mr-field">
                <label><SvgIcon id="i-compass" size={12} /> 目的 / 想解决什么</label>
                <textarea
                  className="mr-textarea" value={purpose}
                  onChange={e => setPurpose(e.target.value)}
                  placeholder="例如：验证概念可行性，并产出可执行的上市方案"
                  rows={3}
                />
              </div>
              <button className="mr-btn primary" onClick={runSuggest}>
                <SvgIcon id="i-users" size={13} /> 建议拉取员工
              </button>

              {suggested.length > 0 && (
                <div className="mr-suggest">
                  <div className="mr-section-title"><SvgIcon id="i-zap" size={12} /> 智能建议（按主题相关性匹配）</div>
                  <div className="mr-suggest-list">
                    {suggested.map(s => (
                      <div key={s.id} className={'mr-suggest-item' + (invited.includes(s.id) ? ' on' : '')} onClick={() => toggleInvite(s.id)}>
                        <span className="mr-suggest-dot" style={{ background: '#' + ROSTER[s.id].color.toString(16).padStart(6, '0') }} />
                        <span className="mr-suggest-name">{ROSTER[s.id].name}</span>
                        <span className="mr-suggest-hit">{s.hits.slice(0, 3).join(' / ')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="mr-field" style={{ marginTop: 14 }}>
                <div className="mr-section-title"><SvgIcon id="i-users" size={12} /> 参会成员（点击可增减）</div>
                <div className="mr-members">
                  {allMembers.map(r => (
                    <button
                      key={r.id}
                      className={'mr-member' + (invited.includes(r.id) ? ' on' : '')}
                      style={invited.includes(r.id) ? { borderColor: '#' + r.color.toString(16).padStart(6, '0') } : undefined}
                      onClick={() => toggleInvite(r.id)}
                    >
                      <span className="mr-member-dot" style={{ background: '#' + r.color.toString(16).padStart(6, '0') }} />
                      {r.name}
                    </button>
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

          {/* ── 步骤二：讨论 ── */}
          {step === 'discuss' && (
            <div className="mr-discuss">
              <div className="mr-field">
                <label><SvgIcon id="i-doc" size={12} /> 你的想法 / 方案（详细输出）</label>
                <textarea
                  className="mr-textarea" value={plan}
                  onChange={e => setPlan(e.target.value)}
                  placeholder="把你的初步想法、方案要点写在这里，员工会据此给评估意见"
                  rows={5}
                />
              </div>
              <div className="mr-chips">
                {invited.map(id => (
                  <span key={id} className="mr-chip" style={{ borderColor: '#' + ROSTER[id].color.toString(16).padStart(6, '0') }}>
                    <span className="mr-chip-dot" style={{ background: '#' + ROSTER[id].color.toString(16).padStart(6, '0') }} />
                    {ROSTER[id].name}
                  </span>
                ))}
              </div>
              <button className="mr-btn primary" onClick={makePlan}>
                <SvgIcon id="i-msg" size={13} /> 让 {invited.length} 位员工给出评估
              </button>

              {Object.keys(opinions).length > 0 && (
                <div className="mr-opinions">
                  {invited.map(id => {
                    const o = opinions[id]; const r = ROSTER[id]
                    return (
                      <div key={id} className="mr-opinion" style={{ borderLeftColor: '#' + r.color.toString(16).padStart(6, '0') }}>
                        <div className="mr-opinion-head">
                          <span className="mr-opinion-avatar" style={{ background: 'linear-gradient(135deg,#00d4ff,#a855f7 55%,#ff6b9d)' }}><SvgIcon id="w-chat" size={14} /></span>
                          <span className="mr-opinion-name">{r.name}</span>
                          <span className={'mr-stance'} data-stance={o.stance}>{o.stance}</span>
                        </div>
                        <div className="mr-opinion-body">
                          <p><b>观点 · </b>{o.view}</p>
                          <p><b>风险 · </b>{o.risk}</p>
                          <p><b>建议 · </b>{o.advice}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── 步骤三：规划 ── */}
          {step === 'plan' && (
            <div className="mr-plan">
              <div className="mr-section-title"><SvgIcon id="i-doc" size={12} /> 整体规划与执行方案</div>
              <pre className="mr-plan-doc">{planDoc}</pre>
              <div className="mr-foot">
                <button className="mr-btn" onClick={copyPlan}>{copied ? '已复制' : '复制方案'}</button>
                <button className="mr-btn primary" onClick={doExecute}>
                  <SvgIcon id="i-zap" size={13} /> 分派执行
                </button>
              </div>
            </div>
          )}

          {/* ── 步骤四：执行 ── */}
          {step === 'done' && (
            <div className="mr-done">
              <div className="mr-done-badge">
                <SvgIcon id="i-zap" size={20} />
                <span>方案已分派，员工进入执行</span>
              </div>
              <p className="mr-done-text">
                已把任务分派给 {executed.length} 位员工，他们在 3D 办公室里已切换为「工作中」状态，实时动态面板可见进度。
              </p>
              <ul className="mr-done-list">
                {executed.map((n, i) => (
                  <li key={i}><SvgIcon id="i-check" size={12} /> {n} 已开始执行对应任务</li>
                ))}
              </ul>
              <div className="mr-foot">
                <button className="mr-btn" onClick={copyPlan}>{copied ? '已复制' : '复制方案'}</button>
                <button className="mr-btn primary" onClick={onClose}>完成</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function OfficeMeetingRoom({ onClose }: { onClose: () => void }) {
  return createPortal(<MeetingRoom onClose={onClose} />, document.body)
}
