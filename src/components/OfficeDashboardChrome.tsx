import { useEffect, useState } from 'react'
import { getOfficeAgents, subscribeOfficeAgents } from '@/store/officeStore'
import { AGENT_ROSTER } from '@/scene/layout/officeLayout'
import type { Agent } from '@/types/agent'
import { QUICK_TOOLS } from '@/config'
import { getOfficeScene } from '@/scene/officeSceneBridge'
export function OfficeSidebar() {
  return (
    <aside className="office-sidebar">
      <div className="sidebar-brand">
        <span className="brand-mark">AI</span>
        <span>AI 办公全景</span>
      </div>
      <div className="sidebar-search">
        <span>🔍</span>
        <span>搜索工位或工具</span>
        <kbd>⌘K</kbd>
      </div>
      <nav className="sidebar-nav">
        {[{ label: '办公室', icon: '🏢' }, { label: '概览', icon: '📊' }, { label: '项目', icon: '📁' }, { label: '成员', icon: '👥' }].map(({ label, icon }) => (
          <button key={label} type="button" className={`nav-item ${label === '办公室' ? 'active' : ''}`}>
            <span className="nav-main"><span className="nav-icon">{icon}</span><span>{label}</span></span>
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
              <span>{t.icon}</span>
              <strong>{t.label}</strong>
            </button>
          ))}
        </div>
      </div>
      <div className="panel-section">
        <h2>数据看板 <span style={{fontSize:10,color:'#0ea5e9',fontWeight:600,marginLeft:6}}>实时</span></h2>
        <div className="stats-board">
          <div className="stats-row" data-tone="cyan">
            <div className="stats-row-icon">💼</div>
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
            <div className="stats-row-icon">🐟</div>
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
            <div className="stats-row-icon">🚽</div>
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
            <div className="stats-row-icon">💬</div>
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
            <div className="stats-row-icon">🚶</div>
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
  const [speed, setSpeed] = useState(100)
  const [phase, setPhase] = useState<'day' | 'dusk' | 'night'>('day')
  const [hudTime, setHudTime] = useState('09:00')

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
          <span className="toolbar-phase" data-phase={phase}>{phase === 'day' ? '☀' : phase === 'dusk' ? '🌆' : '🌙'}</span>
          <span className="toolbar-speed" onClick={handleSpeed} title="点击切换时间流速">{speed}×</span>
        </span>
        <button type="button" className="toolbar-btn" onClick={handlePause} title={paused ? '继续' : '暂停'}>
          <span className="toolbar-icon">{paused ? '▶' : '⏸'}</span>{paused ? '继续' : '暂停'}
        </button>
        <button type="button" className="toolbar-btn" onClick={handleReset} title="重置场景">
          <span className="toolbar-icon">🔄</span>重置
        </button>
        <button type="button" className="toolbar-btn" onClick={handleScreenshot} title="下载当前画面">
          <span className="toolbar-icon">📸</span>截图
        </button>
      </div>
    </div>
  )
}
