import { useEffect, useState } from 'react'
import { getOfficeAgents, subscribeOfficeAgents } from '@/store/officeStore'
import { AGENT_ROSTER } from '@/scene/layout/officeLayout'
import type { Agent } from '@/types/agent'
import { QUICK_TOOLS } from '@/config'
import { getOfficeScene } from '@/scene/officeSceneBridge'
function SvgIcon({ id, size = 14 }: { id: string; size?: number }) {
  return <svg viewBox="0 0 24 24" width={size} height={size}><use href={'#' + id}/></svg>
}

export function OfficeSidebar() {
  return (
    <aside className="office-sidebar">
      <div className="sidebar-brand">
        <span className="brand-mark">AI</span>
        <span>AI 办公全景</span>
      </div>
      <div className="sidebar-search">
        <SvgIcon id="i-eye" size={12}/>
        <span>搜索工位或工具</span>
        <kbd>⌘K</kbd>
      </div>
      <nav className="sidebar-nav">
        {[{ label: '办公室', icon: 'i-office' }, { label: '概览', icon: 'i-eye' }, { label: '项目', icon: 'i-folder' }, { label: '成员', icon: 'i-users' }].map(({ label, icon }) => (
          <button key={label} type="button" className={`nav-item ${label === '办公室' ? 'active' : ''}`}>
            <span className="nav-main"><span className="nav-icon"><SvgIcon id={icon} size={14}/></span><span>{label}</span></span>
            {label === '办公室' && <span className="nav-badge">7</span>}
          </button>
        ))}
      </nav>
      <div className="sidebar-section">
        <div className="section-title">团队成员</div>
        {AGENT_ROSTER.map((r) => (
          <div key={r.id} className="agent-row">
            <span className="agent-dot online" />
            <span style={{ flex: 1 }}>{r.name}</span>
            <span style={{ color: '#999', fontSize: 11 }}>{r.task}</span>
          </div>
        ))}
      </div>
      <div className="sidebar-footer">
        <a className="back-to-hub-btn" href="https://ffswwwda.github.io/category-insight-hub/category-insight-hub.html" target="_blank" rel="noopener noreferrer">
          <SvgIcon id="i-globe" size={12}/> 返回类目洞察主站
        </a>
        <div className="user-card">
          <div className="user-avatar">U</div>
          <span><strong>用户</strong><em>在线 · 管理员</em></span>
        </div>
        <div className="system-status"><span>系统负载</span><span>12%</span></div>
      </div>
    </aside>
  )
}

export function OfficeHeaderStats() {
  const [agents, setAgents] = useState<Agent[]>(getOfficeAgents())

  useEffect(() => subscribeOfficeAgents(setAgents), [])

  const working = agents.filter((a) => a.state === 'working').length
  const talking = agents.filter((a) => a.state === 'talking').length
  const thinking = agents.filter((a) => a.state === 'thinking').length

  return (
    <div className="office-header-stats">
      <div className="stat-card">
        <span className="stat-label">在线员工</span>
        <span className="stat-value">{agents.length}</span>
      </div>
      <div className="stat-card">
        <span className="stat-label">工作中</span>
        <span className="stat-value" style={{ color: '#34c759' }}>{working}</span>
      </div>
      <div className="stat-card">
        <span className="stat-label">对话中</span>
        <span className="stat-value" style={{ color: '#a855f7' }}>{talking}</span>
      </div>
      <div className="stat-card">
        <span className="stat-label">思考中</span>
        <span className="stat-value" style={{ color: '#f5c542' }}>{thinking}</span>
      </div>
      <div className="stat-card resource-card">
        <div className="resource-row"><span>CPU</span><div className="resource-bar"><span style={{ width: '23%' }} /></div><em>23%</em></div>
        <div className="resource-row"><span>内存</span><div className="resource-bar"><span className="tone-purple" style={{ width: '34%' }} /></div><em>34%</em></div>
        <div className="resource-row"><span>网络</span><div className="resource-bar"><span className="tone-blue" style={{ width: '12%' }} /></div><em style={{ gridColumn: 2, textAlign: 'left' }}>12Mbps</em></div>
      </div>
    </div>
  )
}

type AgentStat = {
  workSec: number; idleSec: number; chatSec: number; visitCount: number;
  toiletCount: number; toiletTotalSec: number; visitReceiveCount: number
}

function fmtTime(sec: number) {
  if (sec < 60) return Math.round(sec) + 's'
  if (sec < 3600) return Math.floor(sec / 60) + 'm'
  return Math.floor(sec / 3600) + 'h' + Math.floor((sec % 3600) / 60) + 'm'
}

export function OfficeRightPanel() {
  const [activities, setActivities] = useState<Array<{ text: string; color: number; time: string; ts: number }>>([])
  const [stats, setStats] = useState<Record<string, AgentStat>>({})
  const [agentNames, setAgentNames] = useState<Record<string, string>>({})

  useEffect(() => {
    const handle = setInterval(() => {
      const scene = getOfficeScene()
      if (scene) {
        setActivities(scene.getActivityLog())
        setStats(scene.getAgentStats())
        setAgentNames(scene.getAgentNames())
      }
    }, 1500)
    return () => clearInterval(handle)
  }, [])

  // 排行榜
  const ranking = (key: keyof AgentStat, limit = 3, formatter: (s: number) => string = fmtTime) => {
    const items = Object.entries(stats)
      .map(([id, s]) => ({ id, name: agentNames[id] || id, value: s[key] as number }))
      .filter(x => x.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, limit)
    return items.map((x, i) => ({ ...x, rank: i + 1, display: formatter(x.value) }))
  }

  const topWorker = ranking('workSec', 3)
  const topSlacker = ranking('idleSec', 3)
  const topToilet = ranking('toiletCount', 3, v => v + ' 次')
  const topChat = ranking('chatSec', 3)
  const topVisit = ranking('visitCount', 3, v => v + ' 次')

  return (
    <aside className="office-right-panel">
      <div className="panel-section">
        <h2>快速工具</h2>
        <div className="quick-tools">
          {QUICK_TOOLS.map((t) => (
            <button key={t.label} type="button" className="quick-tool">
              <SvgIcon id={t.icon} size={18}/>
              <strong>{t.label}</strong>
            </button>
          ))}
        </div>
      </div>
      <div className="panel-section">
        <h2>数据看板 <span style={{fontSize:10,color:'#0ea5e9',fontWeight:600,marginLeft:6}}>实时</span></h2>
        <div className="stats-board">
          <div className="stats-row" data-tone="cyan">
            <div className="stats-row-icon"><SvgIcon id="i-brief" size={16}/></div>
            <div className="stats-row-body">
              <div className="stats-row-title">最努力 Top 3</div>
              <div className="stats-row-list">
                {topWorker.length === 0 ? <span className="stats-row-empty">暂无数据</span> :
                  topWorker.map(x => (
                    <div key={x.id} className="stats-row-item">
                      <span className="stats-rank" data-rank={x.rank}>{x.rank}</span>
                      <span className="stats-name">{x.name}</span>
                      <span className="stats-val">{x.display}</span>
                    </div>
                  ))
                }
              </div>
            </div>
          </div>
          <div className="stats-row" data-tone="orange">
            <div className="stats-row-icon"><SvgIcon id="i-fish" size={16}/></div>
            <div className="stats-row-body">
              <div className="stats-row-title">最摸鱼 Top 3</div>
              <div className="stats-row-list">
                {topSlacker.length === 0 ? <span className="stats-row-empty">暂无数据</span> :
                  topSlacker.map(x => (
                    <div key={x.id} className="stats-row-item">
                      <span className="stats-rank" data-rank={x.rank}>{x.rank}</span>
                      <span className="stats-name">{x.name}</span>
                      <span className="stats-val">{x.display}</span>
                    </div>
                  ))
                }
              </div>
            </div>
          </div>
          <div className="stats-row" data-tone="purple">
            <div className="stats-row-icon"><SvgIcon id="i-toilet" size={16}/></div>
            <div className="stats-row-body">
              <div className="stats-row-title">上厕所最多 Top 3</div>
              <div className="stats-row-list">
                {topToilet.length === 0 ? <span className="stats-row-empty">暂无数据</span> :
                  topToilet.map(x => (
                    <div key={x.id} className="stats-row-item">
                      <span className="stats-rank" data-rank={x.rank}>{x.rank}</span>
                      <span className="stats-name">{x.name}</span>
                      <span className="stats-val">{x.display}</span>
                    </div>
                  ))
                }
              </div>
            </div>
          </div>
          <div className="stats-row" data-tone="green">
            <div className="stats-row-icon"><SvgIcon id="i-msg" size={14}/></div>
            <div className="stats-row-body">
              <div className="stats-row-title">最爱聊天 Top 3</div>
              <div className="stats-row-list">
                {topChat.length === 0 ? <span className="stats-row-empty">暂无数据</span> :
                  topChat.map(x => (
                    <div key={x.id} className="stats-row-item">
                      <span className="stats-rank" data-rank={x.rank}>{x.rank}</span>
                      <span className="stats-name">{x.name}</span>
                      <span className="stats-val">{x.display}</span>
                    </div>
                  ))
                }
              </div>
            </div>
          </div>
          <div className="stats-row" data-tone="pink">
            <div className="stats-row-icon"><SvgIcon id="i-walk" size={16}/></div>
            <div className="stats-row-body">
              <div className="stats-row-title">串门最多 Top 3</div>
              <div className="stats-row-list">
                {topVisit.length === 0 ? <span className="stats-row-empty">暂无数据</span> :
                  topVisit.map(x => (
                    <div key={x.id} className="stats-row-item">
                      <span className="stats-rank" data-rank={x.rank}>{x.rank}</span>
                      <span className="stats-name">{x.name}</span>
                      <span className="stats-val">{x.display}</span>
                    </div>
                  ))
                }
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="panel-section panel-grow">
        <h2>实时动态</h2>
        {activities.length === 0 ? (
          <ul className="activity-list">
            <li><span className="activity-dot" style={{ background: '#34c759' }} /><p><strong>小灵</strong> 开始处理新评价数据<time>刚刚</time></p></li>
            <li><span className="activity-dot" style={{ background: '#a855f7' }} /><p><strong>小分</strong> 前往 <strong>小灵</strong> 的工位<time>1分钟前</time></p></li>
            <li><span className="activity-dot" style={{ background: '#f5c542' }} /><p><strong>小预</strong> 正在思考预测模型参数<time>3分钟前</time></p></li>
          </ul>
        ) : (
          <ul className="activity-list">
            {activities.map((a, i) => (
              <li key={a.ts + '-' + i}>
                <span className="activity-dot" style={{ background: '#' + a.color.toString(16).padStart(6, '0') }} />
                <p>{a.text}<time>{a.time}</time></p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}

export function OfficeBottomToolbar() {
  const [paused, setPaused] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [phase, setPhase] = useState<'day' | 'dusk' | 'night'>('day')
  const [hudTime, setHudTime] = useState('09:00')
  const [reportOpen, setReportOpen] = useState(false)

  useEffect(() => {
    const unsub = subscribeOfficeAgents((agents) => {
      // 这里可以根据 agents 状态计算时间/阶段
    })
    return unsub
  }, [])

  useEffect(() => {
    const handle = setInterval(() => {
      // 实时从场景读取
      const scene = getOfficeScene()
      if (scene) {
        setHudTime(scene.getTimeLabel())
        setPhase(scene.phase())
      }
    }, 500)
    return () => clearInterval(handle)
  }, [])

  const handlePause = () => {
    const scene = getOfficeScene()
    if (!scene) return
    if (paused) { scene.resume(); setPaused(false) }
    else { scene.pause(); setPaused(true) }
  }

  const handleReset = () => {
    const scene = getOfficeScene()
    if (!scene) return
    scene.reset()
    setPaused(false)
  }

  const handleSpeed = () => {
    const next = speed === 1 ? 20 : speed === 20 ? 100 : 1
    setSpeed(next)
    getOfficeScene()?.setSpeed(next)
  }

  const handleScreenshot = () => {
    const scene = getOfficeScene()
    if (!scene) return
    scene.screenshot()
  }

  return (
    <div className="office-bottom-toolbar">
      <div className="toolbar-inner">
        <span className="toolbar-hud">
          <span className="toolbar-time">{hudTime}</span>
          <span className="toolbar-phase" data-phase={phase}>{phase === 'day' ? <SvgIcon id="i-sun" size={14}/> : phase === 'dusk' ? <SvgIcon id="i-dusk" size={14}/> : <SvgIcon id="i-moon" size={14}/>}</span>
          <span className="toolbar-speed" onClick={handleSpeed} title="点击切换时间流速">{speed}×</span>
        </span>
        <button type="button" className="toolbar-btn primary" onClick={() => setReportOpen(true)} title="查看今日办公报告">
          <SvgIcon id="i-brief" size={12}/>日报
        </button>
        <button type="button" className="toolbar-btn" onClick={handlePause} title={paused ? '继续' : '暂停'}>
          <SvgIcon id={paused ? 'i-play' : 'i-pause'} size={12}/>{paused ? '继续' : '暂停'}
        </button>
        <button type="button" className="toolbar-btn" onClick={handleReset} title="重置场景">
          <SvgIcon id="i-refresh" size={12}/>重置
        </button>
        <button type="button" className="toolbar-btn" onClick={handleScreenshot} title="下载当前画面">
          <SvgIcon id="i-camera" size={12}/>截图
        </button>
      </div>
      {reportOpen && <OfficeDailyReport onClose={() => setReportOpen(false)} />}
    </div>
  )
}

/* ═════════ 今日办公报告弹窗 ═════════ */
function fmtSec(s: number) {
  if (s < 60) return Math.round(s) + '秒'
  const m = Math.floor(s / 60)
  if (m < 60) return m + '分钟'
  return Math.floor(m / 60) + '时' + (m % 60) + '分'
}

function rankItems<T>(items: T[], getValue: (t: T) => number, limit = 3) {
  return [...items].sort((a, b) => getValue(b) - getValue(a)).slice(0, limit)
}

function OfficeDailyReport({ onClose }: { onClose: () => void }) {
  const [stats, setStats] = useState<Record<string, AgentStat>>({})
  const [names, setNames] = useState<Record<string, string>>({})
  const [activities, setActivities] = useState<Array<{ text: string; color: number; time: string }>>([])
  const [phase, setPhase] = useState<'day'|'dusk'|'night'>('day')
  const [simH, setSimH] = useState(9)

  useEffect(() => {
    const handle = setInterval(() => {
      const scene = getOfficeScene()
      if (!scene) return
      setStats(scene.getAgentStats())
      setNames(scene.getAgentNames())
      setActivities(scene.getActivityLog())
      setPhase(scene.phase())
      // 模拟小时数（从 simTime 算）
      const rawTime = scene.getTimeLabel()
      setSimH(parseInt(rawTime.split(':')[0]) || 9)
    }, 800)
    return () => clearInterval(handle)
  }, [])

  const agents = Object.keys(stats).map(id => ({ id, name: names[id] || id, ...stats[id] }))

  // 排行
  const topWorker = rankItems(agents, a => a.workSec, 3)
  const topSlacker = rankItems(agents, a => a.idleSec, 3)
  const topToilet = rankItems(agents, a => a.toiletCount, 3)
  const topChat = rankItems(agents, a => a.chatSec, 3)
  const topVisit = rankItems(agents, a => a.visitCount, 3)

  // 走错厕所次数（从活动日志统计）
  const wrongToiletCount = activities.filter(a => a.text.includes('走错厕所')).length

  // 工作效率条形图数据
  const totalWork = agents.reduce((s, a) => s + a.workSec, 0)
  const totalIdle = agents.reduce((s, a) => s + a.idleSec, 0)
  const totalChat = agents.reduce((s, a) => s + a.chatSec, 0)
  const totalToilet = agents.reduce((s, a) => s + a.toiletTotalSec, 0)
  const grandTotal = Math.max(totalWork + totalIdle + totalChat + totalToilet, 1)

  // 下班状态
  const offWorkAgents = agents.filter(a => {
    const scene = getOfficeScene()
    if (!scene) return false
    const agent = scene.getAgents().find(x => x.id === a.id)
    return agent?.state === 'gone'
  })

  return (
    <div className="daily-report-overlay" onClick={onClose}>
      <div className="daily-report-card" onClick={e => e.stopPropagation()}>
        {/* 头 */}
        <div className="dr-head">
          <div className="dr-title-row">
            <SvgIcon id="i-brief" size={18}/>
            <h3>今日办公报告</h3>
            <span className="dr-badge">{simH >= 18 ? '已下班' : simH >= 12 ? '下午' : '上午'}</span>
            <span className="dr-phase-tag" data-phase={phase}>
              {phase === 'day' ? '☀️ 白天' : phase === 'dusk' ? '🌆 傍晚' : '🌙 夜间'}
            </span>
          </div>
          <p className="dr-sub">模拟时间 {simH}:00 · 实时行为统计分析</p>
          <button className="dr-close" onClick={onClose}>✕</button>
        </div>

        {/* 核心概览 */}
        <div className="dr-grid">
          <div className="dr-kpi" data-tone="cyan">
            <span className="dr-kpi-icon"><SvgIcon id="i-build" size={16}/></span>
            <div><strong>{fmtSec(totalWork)}</strong><em>总工时</em></div>
          </div>
          <div className="dr-kpi" data-tone="orange">
            <span className="dr-kpi-icon"><SvgIcon id="i-fish" size={16}/></span>
            <div><strong>{fmtSec(totalIdle)}</strong><em>摸鱼时长</em></div>
          </div>
          <div className="dr-kpi" data-tone="purple">
            <span className="dr-kpi-icon"><SvgIcon id="i-toilet" size={16}/></span>
            <div><strong>{fmtSec(totalToilet)}</strong><em>如厕总时长</em></div>
          </div>
          <div className="dr-kpi" data-tone="green">
            <span className="dr-kpi-icon"><SvgIcon id="i-msg" size={16}/></span>
            <div><strong>{fmtSec(totalChat)}</strong><em>聊天总时长</em></div>
          </div>
        </div>

        {/* 时间分配饼状条 */}
        <div className="dr-section">
          <div className="dr-section-title">时间分配总览</div>
          <div className="dr-bar-chart">
            {[
              { label: '工作', value: totalWork, color: '#00d4ff' },
              { label: '摸鱼', value: totalIdle, color: '#f97316' },
              { label: '聊天', value: totalChat, color: '#a855f7' },
              { label: '如厕', value: totalToilet, color: '#4a90d9' },
            ].map(bar => {
              const pct = grandTotal > 0 ? (bar.value / grandTotal * 100) : 0
              return (
                <div key={bar.label} className="dr-bar-row">
                  <span className="dr-bar-label">{bar.label}</span>
                  <div className="dr-bar-track">
                    <div className="dr-bar-fill" style={{ width: pct + '%', background: bar.color }} />
                  </div>
                  <span className="dr-bar-val">{pct.toFixed(1)}%</span>
                  <span className="dr-bar-time">{fmtSec(bar.value)}</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* 排行榜 */}
        <div className="dr-rankings">
          <RankBlock tone="cyan" icon="i-build" title="卷王 Top 3" items={topWorker.map(x => ({ name: x.name, value: fmtSec(x.workSec) }))} />
          <RankBlock tone="orange" icon="i-fish" title="摸鱼王 Top 3" items={topSlacker.map(x => ({ name: x.name, value: fmtSec(x.idleSec) }))} />
          <RankBlock tone="purple" icon="i-toilet" title="厕所之王 Top 3" items={topToilet.map(x => ({ name: x.name, value: x.toiletCount + '次 (' + fmtSec(x.toiletTotalSec) + ')' }))} />
          <RankBlock tone="green" icon="i-msg" title="话痨 Top 3" items={topChat.map(x => ({ name: x.name, value: fmtSec(x.chatSec) }))} />
          <RankBlock tone="pink" icon="i-walk" title="串门王 Top 3" items={topVisit.map(x => ({ name: x.name, value: x.visitCount + '次' }))} />
        </div>

        {/* 异常事件 */}
        {(wrongToiletCount > 0 || offWorkAgents.length > 0) && (
          <div className="dr-section dr-alert-section">
            <div className="dr-section-title">异常事件记录</div>
            {wrongToiletCount > 0 && (
              <div className="dr-alert-item" data-type="wrong-toilet">
                <SvgIcon id="i-alert" size={14}/>
                <span>走错厕所：<strong>{wrongToiletCount}</strong> 次（男/女不分）</span>
              </div>
            )}
            {offWorkAgents.length > 0 && (
              <div className="dr-alert-item" data-type="offwork">
                <SvgIcon id="i-moon" size={14}/>
                <span>已下班：<strong>{offWorkAgents.map(a => a.name).join('、')}</strong></span>
                {offWorkAgents.length < agents.length && <span className="dr-still-working">其余 {agents.length - offWorkAgents.length} 人仍在岗或加班中</span>}
              </div>
            )}
          </div>
        )}

        {/* 底部操作 */}
        <div className="dr-foot">
          <button type="button" className="toolbar-btn" onClick={onClose}>关闭报告</button>
        </div>
      </div>
    </div>
  )
}

/** 排行块子组件 */
function RankBlock({ tone, icon, title, items }: { tone: string; icon: string; title: string; items: Array<{ name: string; value: string }> }) {
  return (
    <div className="dr-rank-block" data-tone={tone}>
      <div className="dr-rank-header">
        <SvgIcon id={icon as any} size={13}/><span>{title}</span>
      </div>
      <div className="dr-rank-items">
        {items.length === 0 ? (
          <span className="dr-empty">暂无数据</span>
        ) : items.map((item, i) => (
          <div key={item.name} className="dr-rank-item">
            <span className="dr-rank-num" data-rank={i + 1}>{i + 1}</span>
            <span className="dr-rank-name">{item.name}</span>
            <span className="dr-rank-val">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
