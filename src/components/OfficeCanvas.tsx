import { useEffect, useRef, useState, useCallback } from 'react'
import { OfficeScene, type OfficeAgentClick } from '@/scene/OfficeScene'
import type { Agent, AgentState } from '@/types/agent'

type AgentMenuState = {
  agent: Agent; rosterNo: number; x: number; y: number
  agents: Agent[]; pickingTarget: boolean
}

const STATE_ACTIONS: Array<{ label: string; state: AgentState; task?: string }> = [
  { label: '开始工作', state: 'working', task: '处理当前任务…' },
  { label: '进入思考', state: 'thinking', task: '思考下一步…' },
  { label: '暂时空闲', state: 'idle' },
]

/** 每个 agent 的「身份卡」数据 */
const AGENT_PROFILES: Record<string, {
  name: string; role: string; icon: string;
  desc: string;
  category: string;
  methods: string[];
  tools: string[];
  aiInfo: string;
  reports: string;
  sources: string;
}> = {
  voc: {
    name:'小灵', role:'VOC 智能打标', icon:'w-tag',
    desc:'我负责给用户评论打维度标签——动机、场景、痛点，一条评论穿过 9 道标签墙，盖上属于它的印章。',
    category:'飞机杯、震动棒、润滑液等成人用品类目',
    methods:['规则引擎打标','9 维度标签体系','否定保护校验','频率统计与情感分析'],
    tools:['VOC 标签框','语料分析工具','情绪维度报告'],
    aiInfo:'我的打标引擎是纯规则化的（无需 LLM API），但你可以开启 AI 增强来提高模糊匹配的准确率。AI 会在现有规则基础上做语义补充，不修改你的标签体系。',
    reports:'用户评论标签分布报告、情感极性统计、高频问题 TOP 列表',
    sources:'亚马逊评论·DE/US/JP/UK/EU'
  },
  score: {
    name:'小分', role:'产品需求打分', icon:'w-target',
    desc:'我帮产品需求做四维评分——痛点匹配、技术可行、市场机会、竞争差异。每项附理由与置信度。',
    category:'新产品概念、功能改进、产品线扩展',
    methods:['四象限评分模型','关键词权重打分','置信度评估','可溯源证据链'],
    tools:['产品打分工具','数据源匹配器','类目容量计算器'],
    aiInfo:'AI 增强可以帮你从产品描述中自动提取评分维度、匹配数据源引用、给出更精准的置信度判断。所有评分理由都支持点击追溯原文。',
    reports:'产品需求综合评分报告、各维度得分分布、数据源匹配明细',
    sources:'德国商品库·DE、竞品分析·DE/US'
  },
  lab: {
    name:'小预', role:'数字世界预测', icon:'w-globe',
    desc:'我用多智能体仿真推演你的运营策略——把你真实的用户分群放进数字沙盒，注入定价、卖点、渠道变量，观察群体演化。',
    category:'社媒活动预测、新品上市预测、品类机会评估',
    methods:['Agent-Based Model','Hegselmann-Krause 观点演化','蒙特卡洛复算','三场景差异化输出'],
    tools:['数字世界工作台','用户基座编辑器','预测报告引擎'],
    aiInfo:'AI 增强版可以接入 LLM 做更精细的用户分群聚类、语义情感建模。当前纯前端引擎（L2）完全不依赖外调，适合快速迭代。',
    reports:'预测报告（爆款率/触达率/翻车风险）、多场景对比、敏感性分析图标',
    sources:'NS 社媒内容台、用户画像/领新数据、类目趋势·EU/US'
  },
  dev: {
    name:'小创', role:'新品开发盲盒', icon:'w-box',
    desc:'我负责把创新方法装进盲盒——抽中 TRIZ 就给你物场分析，抽中 SCAMPER 就做替代/组合变形。每个方法长出 3 条产品开发创意。',
    category:'飞机杯、震动棒等类目的产品创新',
    methods:['TRIZ 40 发明原理','SCAMPER 变形法','物场分析与标准解','语义组合引擎'],
    tools:['新品开发创意工具','FABE 文案生成器','多语言详情页模板'],
    aiInfo:'AI 开启后可以从你的历史评价数据中自动提取用户语言特征，让生成的创意更贴近真实用户表达。盲盒结果可以反复"重抽"直到满意。',
    reports:'产品设计需求文档、FABE 文案、多语言 listing 详情页',
    sources:'用户访谈、竞品分析·DE/US、搜索数据·DE/US/JP'
  },
  idea: {
    name:'小设', role:'新品创意图', icon:'w-layers',
    desc:'我是矿工——从六维创意矿脉（外观/功能/场景/情感/技术/叙事）里挖金块，拼成一张可执行的创意图。',
    category:'成人用品类目外观设计、使用场景创新',
    methods:['六维创意生成','场景情感映射','技术趋势导入','叙事包装'],
    tools:['新品打造创意灵感工具','场景定义器','竞品视觉库'],
    aiInfo:'AI 增强版会根据你指定的类目自动提取当前市场的流行设计语言和用户审美偏好，让你挖到的"金块"更符合市场预期。',
    reports:'创意概念卡片、场景说明文档、用户情绪映射报告',
    sources:'社媒声量·全球、用户访谈、领新用户反馈'
  },
  stress: {
    name:'小测', role:'虚拟压力测试', icon:'w-robot',
    desc:'我把你的产品概念丢进虚拟用户群——有人支持、有人反对、有人沉默。我找出最极端的反对声音，帮你提前发现翻车风险。',
    category:'新品概念验证、运营活动压力、文案挑刺',
    methods:['虚拟用户群生成','压力测试仿真','极端用户识别（von Hippel）','立场与影响分析'],
    tools:['虚拟用户压力测试工作台','极端用户分析器','风险评分卡'],
    aiInfo:'AI 增强可以从你的 VOC 原文中提取更真实的用户立场特征，让虚拟用户群更贴合你的真实用户分布——不被 LLM 的"平均意见"稀释。',
    reports:'压力测试报告（支持/中立/反对分布）、极端用户画像 Top 5、风险预警清单',
    sources:'社媒声量·全球、品类洞察、产品运营看板'
  },
  pr: {
    name:'小展', role:'原理展厅', icon:'w-office',
    desc:'我管理原理展厅——所有工具的「使用」和「看背后工作」双视角演示都存储在我这里。你想看什么工具怎么运转，我来展示。',
    category:'全品类工具原理与演示',
    methods:['原理全景图','双视角切换（使用/原理）','动画演示引擎'],
    tools:['原理展厅画廊','AI 办公全景图','3D 引擎版（PixiJS）'],
    aiInfo:'所有演示动画都是纯前端实现（无需后端）。你可以自由切换「使用视角」看结果、「看背后工作」看原理。每个演示对应一个真实工具。',
    reports:'工具使用指南、演示步骤说明、原理图解',
    sources:'全数据源示意、分析框架库、AI 简化工具集'
  }
}

function SvgIcon({ id, size = 14 }: { id: string; size?: number }) {
  return <svg viewBox="0 0 24 24" width={size} height={size}><use href={'#' + id}/></svg>
}

interface WorkStatus {
  clockIn: string; now: string; state: string
  workSec: number; idleSec: number; chatSec: number
  toiletCount: number; toiletTotalSec: number; visitCount: number
  recent: { text: string; time: string }[]
}

function fmtSec(s: number) {
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  const mm = m % 60
  return h > 0 ? `${h}h${mm}m` : `${mm}m`
}

export function OfficeCanvas() {
  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<OfficeScene | null>(null)
  const readyRef = useRef(false)
  const [menu, setMenu] = useState<AgentMenuState | null>(null)
  const [detailTab, setDetailTab] = useState<'profile' | 'work' | 'actions'>('profile')
  const [workStatus, setWorkStatus] = useState<WorkStatus | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const handleAgentClick = (event: OfficeAgentClick) => {
      setDetailTab('profile')
      const rect = host.getBoundingClientRect()
      const mw = 310
      setMenu({
        agent: event.agent,
        rosterNo: event.rosterNo,
        x: Math.max(12, Math.min(event.clientX - rect.left, rect.width - mw - 12)),
        y: Math.max(12, Math.min(event.clientY - rect.top, 300)),
        agents: sceneRef.current?.getAgents() ?? [],
        pickingTarget: false,
      })
      setWorkStatus(sceneRef.current?.getAgentWorkStatus(event.agent.id) ?? null)
    }
    const scene = new OfficeScene({ onAgentClick: handleAgentClick })
    sceneRef.current = scene
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      if (width <= 0 || height <= 0) return
      if (!readyRef.current) {
        readyRef.current = true
        void scene.init(host, width, height)
        return
      }
      scene.resize(width, height)
    })
    ro.observe(host)
    return () => { ro.disconnect(); readyRef.current = false; scene.destroy(); sceneRef.current = null }
  }, [])

  useEffect(() => {
    // 用 click 代替 pointerdown 避免与按钮 onClick 冲突
    const close = (e: MouseEvent) => {
      if (!menu) return
      // 点击菜单内部不关闭
      if (menuRef.current && menuRef.current.contains(e.target as Node)) return
      setMenu(null)
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', key) }
  }, [menu])

  // 监听侧边栏员工点击事件（CustomEvent 从 OfficeSidebar 发出）
  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail
      if (!d?.agentId || !sceneRef.current) return
      const agents = sceneRef.current.getAgents()
      const target = agents.find((a: Agent) => a.id === d.agentId)
      if (!target) return
      setDetailTab('profile')
      const host = hostRef.current!
      const rect = host.getBoundingClientRect()
      const mw = 310
      setMenu({
        agent: target,
        rosterNo: 0,
        x: Math.max(12, rect.width - mw - 24),
        y: Math.max(12, 80),
        agents,
        pickingTarget: false,
      })
      setWorkStatus(sceneRef.current!.getAgentWorkStatus(d.agentId) ?? null)
    }
    window.addEventListener('office:agent-click', handler)
    return () => window.removeEventListener('office:agent-click', handler)
  }, [])

  // 员工卡打开时，实时刷新工作状态（上班/工作/摸鱼）
  useEffect(() => {
    if (!menu) { setWorkStatus(null); return }
    const id = menu.agent.id
    const t = setInterval(() => {
      const st = sceneRef.current?.getAgentWorkStatus(id)
      if (st) setWorkStatus(st)
    }, 1500)
    return () => clearInterval(t)
  }, [menu])

  const applyState = (state: AgentState, task?: string) => {
    if (!menu) return
    sceneRef.current?.setAgentState(menu.agent.id, state, task)
    setMenu(null)
  }

  const startInteraction = (targetRosterNo: number, targetName: string) => {
    if (!menu || targetRosterNo === menu.rosterNo) return
    sceneRef.current?.requestDeskVisit(menu.rosterNo, targetRosterNo, `${targetName}，我来和你同步一下。`)
    setMenu(null)
  }

  const profile = menu ? AGENT_PROFILES[menu.agent.id] : null

  return (
    <div ref={hostRef} className="office-canvas">
      {menu && profile && (
        <div className="agent-card" ref={menuRef} style={{ left: menu.x, top: menu.y }}>
          {/* 头部 */}
          <div className="ac-head">
            <div className="ac-avatar" style={{ background: 'linear-gradient(135deg,#00d4ff,#a855f7 55%,#ff6b9d)', color: '#fff' }}>
              <SvgIcon id={profile.icon} size={20}/>
            </div>
            <div className="ac-head-info">
              <div className="ac-head-name">{menu.agent.name} · {profile.role}</div>
              <div className="ac-head-status" data-state={menu.agent.state}>
                <span className="status-dot" />
                {menu.agent.state === 'working' ? '工作中' : menu.agent.state === 'idle' ? '空闲' : menu.agent.state === 'walking' ? '走动中' : menu.agent.state === 'talking' ? '对话中' : menu.agent.state === 'thinking' ? '思考中' : menu.agent.state}
              </div>
            </div>
          </div>

          {/* Tab 导航 */}
          <div className="ac-tabs">
            {(['profile','work','actions'] as const).map(tab => (
              <button key={tab} className={'ac-tab' + (detailTab === tab ? ' on' : '')} onClick={() => setDetailTab(tab)}>
                {tab === 'profile' && <><SvgIcon id="i-users" size={12}/> 身份</>}
                {tab === 'work' && <><SvgIcon id="i-build" size={12}/> 能力</>}
                {tab === 'actions' && <><SvgIcon id="i-zap" size={12}/> 操作</>}
              </button>
            ))}
          </div>

          {/* Tab 内容 */}
          <div className="ac-body">
            {detailTab === 'profile' && (
              <div className="ac-profile">
                {/* 自我介绍：第一人称带入 */}
                <div className="ac-intro">
                  <div className="ac-intro-hi">你好，我是 <b>{menu.agent.name}</b></div>
                  <p className="ac-intro-body">{profile.desc}</p>
                </div>
                {/* 实时工作状态：上班 / 工作 / 摸鱼 */}
                {workStatus && (
                  <div className="ac-section ac-ws">
                    <div className="ac-section-title"><SvgIcon id="i-refresh" size={12}/> 今日工作状态（实时）</div>
                    <div className="ac-ws-grid">
                      <div className="ac-ws-cell"><span className="ac-ws-k">上班</span><span className="ac-ws-v">{workStatus.clockIn} 起 · 现在 {workStatus.now}</span></div>
                      <div className="ac-ws-cell"><span className="ac-ws-k">当下</span><span className="ac-ws-v">{workStatus.state}</span></div>
                      <div className="ac-ws-cell"><span className="ac-ws-k">工作</span><span className="ac-ws-v ac-ws-work">{fmtSec(workStatus.workSec)}</span></div>
                      <div className="ac-ws-cell"><span className="ac-ws-k">摸鱼</span><span className="ac-ws-v ac-ws-idle">{fmtSec(workStatus.idleSec)}</span></div>
                      <div className="ac-ws-cell"><span className="ac-ws-k">串门</span><span className="ac-ws-v">{fmtSec(workStatus.chatSec)} · {workStatus.visitCount} 次</span></div>
                      <div className="ac-ws-cell"><span className="ac-ws-k">如厕</span><span className="ac-ws-v">{workStatus.toiletCount} 次 / {fmtSec(workStatus.toiletTotalSec)}</span></div>
                    </div>
                    {workStatus.recent.length > 0 && (
                      <div className="ac-ws-recent">
                        {workStatus.recent.map((r, i) => (
                          <div key={i} className="ac-ws-log"><span className="ac-ws-time">{r.time}</span>{r.text}</div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div className="ac-section">
                  <div className="ac-section-title"><SvgIcon id="i-target" size={12}/> 擅长类目</div>
                  <div className="ac-tags">{profile.category.split('、').map((c,i) => <span key={i} className="ac-tag">{c}</span>)}</div>
                </div>
                <div className="ac-section">
                  <div className="ac-section-title"><SvgIcon id="i-link" size={12}/> 数据源</div>
                  <div className="ac-text">{profile.sources}</div>
                </div>
              </div>
            )}

            {detailTab === 'work' && (
              <div className="ac-work">
                <div className="ac-section">
                  <div className="ac-section-title"><SvgIcon id="i-bar" size={12}/> 分析方法</div>
                  {profile.methods.map((m,i) => (
                    <div key={i} className="ac-method-item"><span className="ac-method-dot"/> {m}</div>
                  ))}
                </div>
                <div className="ac-section">
                  <div className="ac-section-title"><SvgIcon id="i-doc" size={12}/> 关联工具</div>
                  {profile.tools.map((t,i) => (
                    <div key={i} className="ac-tool-item"><span className="ac-tool-grad"/>{t}</div>
                  ))}
                </div>
                <div className="ac-section">
                  <div className="ac-section-title"><SvgIcon id="i-robot" size={12}/> AI 协作</div>
                  <p className="ac-text ac-ai-text">{profile.aiInfo}</p>
                </div>
              </div>
            )}

            {detailTab === 'actions' && (
              <div className="ac-actions">
                <div className="ac-section">
                  <div className="ac-section-title"><SvgIcon id="i-msg" size={12}/> 串门互动</div>
                  <button type="button" className="ac-action-btn" onClick={() => setMenu(prev => prev ? { ...prev, pickingTarget: !prev.pickingTarget } : null)}>
                    <SvgIcon id="i-users" size={14}/> {menu.pickingTarget ? '收起目标选择' : '选择同事互动…'}
                  </button>
                  {menu.pickingTarget && (
                    <div className="ac-targets">
                      {menu.agents.filter(a => a.id !== menu.agent.id).map(a => {
                        const rosterNo = menu.agents.findIndex(x => x.id === a.id) + 1
                        return (
                          <button key={a.id} className="ac-target-btn" onClick={() => startInteraction(rosterNo, a.name)}>
                            和 {a.name} 互动
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
                <div className="ac-section">
                  <div className="ac-section-title"><SvgIcon id="i-compass" size={12}/> 状态切换</div>
                  <div className="ac-state-btns">
                    {STATE_ACTIONS.map(a => (
                      <button key={a.label} className="ac-state-btn" onClick={() => applyState(a.state, a.task)}>{a.label}</button>
                    ))}
                  </div>
                </div>
                <div className="ac-section">
                  <div className="ac-section-title"><SvgIcon id="i-doc" size={12}/> 报告与入口</div>
                  <div className="ac-report-item"><SvgIcon id="i-bar" size={12}/> {profile.reports}</div>
                </div>
                <div className="ac-section">
                  <div className="ac-section-title"><SvgIcon id="i-bot" size={12}/> 数字员工招募</div>
                  <p className="ac-text ac-recruit-tip">在「数字员工招募区」把 {menu.agent.name} 的知识库 + 技能 + system prompt 打包成 .zip，交给你的 AI 就地上岗。</p>
                  <a
                    className="ac-recruit-btn"
                    href={`https://ffswwwda.github.io/category-insight-hub/category-insight-hub.html?emp=${menu.agent.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <SvgIcon id="i-bot" size={14}/> 去招募 {menu.agent.name}（打包 .zip）
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
