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

export function OfficeRightPanel() {
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
      <div className="panel-section panel-grow">
        <h2>实时动态</h2>
        <ul className="activity-list">
          <li><span className="activity-dot" style={{ background: '#34c759' }} /><p><strong>小灵</strong> 开始处理新评价数据<time>刚刚</time></p></li>
          <li><span className="activity-dot" style={{ background: '#a855f7' }} /><p><strong>小分</strong> 前往 <strong>小灵</strong> 的工位<time>1分钟前</time></p></li>
          <li><span className="activity-dot" style={{ background: '#f5c542' }} /><p><strong>小预</strong> 正在思考预测模型参数<time>3分钟前</time></p></li>
        </ul>
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
