import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { getOfficeAgents, subscribeOfficeAgents } from '@/store/officeStore'
import { AGENT_ROSTER, PROJECTS } from '@/scene/layout/officeLayout'
import type { Agent } from '@/types/agent'
import { QUICK_TOOLS } from '@/config'
import { getOfficeScene } from '@/scene/officeSceneBridge'
function SvgIcon({ id, size = 14 }: { id: string; size?: number }) {
  return <svg viewBox="0 0 24 24" width={size} height={size}><use href={'#' + id}/></svg>
}

export function OfficeSidebar({ onAgentClick, activeNav, onNavChange }: {
  onAgentClick?: (agentId: string) => void
  activeNav?: string
  onNavChange?: (label: string) => void
}) {
  const navItems = [
    { label: '办公室', icon: 'i-office', badge: '7' },
    { label: '概览', icon: 'i-eye' },
    { label: '项目', icon: 'i-folder' },
    { label: '成员', icon: 'i-users' },
  ]
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
        {navItems.map(({ label, icon, badge }) => (
          <button key={label} type="button"
            className={`nav-item ${(activeNav||'办公室') === label ? 'active' : ''}`}
            onClick={() => onNavChange?.(label)}
          >
            <span className="nav-main"><span className="nav-icon"><SvgIcon id={icon} size={14}/></span><span>{label}</span></span>
            {badge && <span className="nav-badge">{badge}</span>}
          </button>
        ))}
      </nav>
      <div className="sidebar-section">
        <div className="section-title">团队成员</div>
        {AGENT_ROSTER.map((r) => (
          <div key={r.id} className="agent-row clickable"
            onClick={() => onAgentClick?.(r.id)}
            title={'点击查看 '+r.name+' 的档案'}
          >
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

function fmtSec(s: number) {
  if (s < 60) return Math.round(s) + '秒'
  const m = Math.floor(s / 60)
  if (m < 60) return m + '分钟'
  return Math.floor(m / 60) + '时' + (m % 60) + '分'
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
      // 实时从场景读取（含秒，高频刷新 → 100× 流速时时钟明显加速）
      const scene = getOfficeScene()
      if (scene) {
        setHudTime(scene.getClockLabel(true))
        setPhase(scene.phase())
      }
    }, 200)
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
          <span className="toolbar-phase" data-phase={phase} onClick={() => getOfficeScene()?.skipToNextPhase()} title="点击切换 白天 / 傍晚 / 夜间">{phase === 'day' ? <SvgIcon id="i-sun" size={14}/> : phase === 'dusk' ? <SvgIcon id="i-dusk" size={14}/> : <SvgIcon id="i-moon" size={14}/>}</span>
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
      {reportOpen && createPortal(
        <OfficeDailyReport onClose={() => setReportOpen(false)} />,
        document.body,
      )}
    </div>
  )
}

/* ═════════ 今日办公报告弹窗 ═════════ */
function rankItems<T>(items: T[], getValue: (t: T) => number, limit = 3) {
  return [...items].sort((a, b) => getValue(b) - getValue(a)).slice(0, limit)
}

type ReportAgent = {
  id: string; name: string
  workSec: number; idleSec: number; chatSec: number
  toiletCount: number; toiletTotalSec: number; visitCount: number
}
type ReportPayload = {
  agents: ReportAgent[]
  simH: number
  phase: 'day' | 'dusk' | 'night'
  wrongToiletCount: number
}

/** 复制：生成 Markdown 摘要写入剪贴板 */
async function copyReportText(p: ReportPayload): Promise<boolean> {
  const totalW = p.agents.reduce((s, a) => s + a.workSec, 0)
  const totalI = p.agents.reduce((s, a) => s + a.idleSec, 0)
  const totalC = p.agents.reduce((s, a) => s + a.chatSec, 0)
  const totalT = p.agents.reduce((s, a) => s + a.toiletTotalSec, 0)
  const lines: string[] = []
  lines.push('# 今日办公报告')
  lines.push(`模拟时间 ${String(p.simH).padStart(2, '0')}:00 · 阶段：${p.phase === 'day' ? '白天' : p.phase === 'dusk' ? '傍晚' : '夜间'}`)
  lines.push('')
  lines.push(`- 总工时：${fmtSec(totalW)}`)
  lines.push(`- 总摸鱼：${fmtSec(totalI)}`)
  lines.push(`- 总聊天：${fmtSec(totalC)}`)
  lines.push(`- 总如厕：${fmtSec(totalT)}`)
  lines.push('')
  lines.push('| 成员 | 工时 | 摸鱼 | 聊天 | 如厕 | 串门 |')
  lines.push('| --- | --- | --- | --- | --- | --- |')
  for (const a of p.agents) {
    lines.push(`| ${a.name} | ${fmtSec(a.workSec)} | ${fmtSec(a.idleSec)} | ${fmtSec(a.chatSec)} | ${a.toiletCount}次(${fmtSec(a.toiletTotalSec)}) | ${a.visitCount}次 |`)
  }
  if (p.wrongToiletCount > 0) {
    lines.push('')
    lines.push(`异常：走错厕所 ${p.wrongToiletCount} 次`)
  }
  try {
    await navigator.clipboard.writeText(lines.join('\n'))
    return true
  } catch {
    return false
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** 把报告画到 canvas 并返回（动态高度，确保全图不裁剪） */
function renderReportCanvas(p: ReportPayload): HTMLCanvasElement {
  const scale = 2
  const W = 760
  const pad = 24
  const rows = Math.max(p.agents.length, 1)

  // 预计算总高度（与下方实际绘制顺序严格一致，避免裁剪或留白）
  const yDistBottom = 168 + 14 + 4 * 22
  const yMembersBottom = yDistBottom + 30 + 10 + 14 + 22 + rows * 30
  const yRankBottom = yMembersBottom + 6 + 18 + 96
  const H = Math.ceil((p.wrongToiletCount > 0 ? yRankBottom + 116 : yRankBottom) + pad)

  const canvas = document.createElement('canvas')
  canvas.width = W * scale
  canvas.height = H * scale
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)

  ctx.fillStyle = '#121424'
  ctx.fillRect(0, 0, W, H)

  // 顶部三色渐变条
  const grad = ctx.createLinearGradient(0, 0, W, 0)
  grad.addColorStop(0, '#00d4ff'); grad.addColorStop(0.55, '#a855f7'); grad.addColorStop(1, '#ff6b9d')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, 6)

  ctx.fillStyle = '#e8e8f0'
  ctx.font = '700 20px -apple-system,BlinkMacSystemFont,sans-serif'
  ctx.fillText('今日办公报告', pad, 44)
  ctx.fillStyle = '#8888a0'
  ctx.font = '12px -apple-system,BlinkMacSystemFont,sans-serif'
  ctx.fillText(`模拟时间 ${String(p.simH).padStart(2, '0')}:00 · ${p.phase === 'day' ? '白天' : p.phase === 'dusk' ? '傍晚' : '夜间'} · 实时行为统计`, pad, 64)

  const totalWork = p.agents.reduce((s, a) => s + a.workSec, 0)
  const totalIdle = p.agents.reduce((s, a) => s + a.idleSec, 0)
  const totalChat = p.agents.reduce((s, a) => s + a.chatSec, 0)
  const totalToilet = p.agents.reduce((s, a) => s + a.toiletTotalSec, 0)

  // KPI
  const kpis = [
    { label: '总工时', value: fmtSec(totalWork), color: '#00d4ff' },
    { label: '摸鱼时长', value: fmtSec(totalIdle), color: '#f97316' },
    { label: '如厕总时长', value: fmtSec(totalToilet), color: '#4a90d9' },
    { label: '聊天总时长', value: fmtSec(totalChat), color: '#a855f7' },
  ]
  const kw = (W - pad * 2 - 24) / 4
  kpis.forEach((k, i) => {
    const x = pad + i * (kw + 8)
    const y = 80
    ctx.fillStyle = 'rgba(255,255,255,0.03)'
    roundRect(ctx, x, y, kw, 64, 12); ctx.fill()
    ctx.fillStyle = k.color
    ctx.font = '700 18px -apple-system,BlinkMacSystemFont,sans-serif'
    ctx.fillText(k.value, x + 12, y + 30)
    ctx.fillStyle = '#8888a0'
    ctx.font = '11px -apple-system,BlinkMacSystemFont,sans-serif'
    ctx.fillText(k.label, x + 12, y + 50)
  })

  // 时间分配条
  let y = 168
  ctx.fillStyle = '#c0c0d0'
  ctx.font = '700 12px -apple-system,BlinkMacSystemFont,sans-serif'
  ctx.fillText('时间分配总览', pad, y)
  y += 14
  const grand = Math.max(totalWork + totalIdle + totalChat + totalToilet, 1)
  const bars = [
    { label: '工作', value: totalWork, color: '#00d4ff' },
    { label: '摸鱼', value: totalIdle, color: '#f97316' },
    { label: '聊天', value: totalChat, color: '#a855f7' },
    { label: '如厕', value: totalToilet, color: '#4a90d9' },
  ]
  const trackW = W - pad * 2 - 210
  bars.forEach((b) => {
    y += 22
    ctx.fillStyle = '#c0c0d0'
    ctx.font = '11px -apple-system,BlinkMacSystemFont,sans-serif'
    ctx.fillText(b.label, pad, y)
    const bx = pad + 44
    ctx.fillStyle = 'rgba(255,255,255,0.06)'
    roundRect(ctx, bx, y - 11, trackW, 10, 5); ctx.fill()
    const pct = (b.value / grand) * 100
    ctx.fillStyle = b.color
    roundRect(ctx, bx, y - 11, Math.max(trackW * pct / 100, 2), 10, 5); ctx.fill()
    ctx.fillStyle = '#e8e8f0'
    ctx.font = '700 11px -apple-system,BlinkMacSystemFont,sans-serif'
    ctx.fillText(`${pct.toFixed(1)}%  ${fmtSec(b.value)}`, bx + trackW + 8, y)
  })

  // 成员明细表
  y += 30
  ctx.fillStyle = '#c0c0d0'
  ctx.font = '700 12px -apple-system,BlinkMacSystemFont,sans-serif'
  ctx.fillText('成员明细', pad, y)
  y += 10
  const cols = ['成员', '工时', '摸鱼', '聊天', '如厕', '串门']
  const colX = [pad, pad + 150, pad + 250, pad + 340, pad + 430, pad + 520]
  ctx.font = '700 11px -apple-system,BlinkMacSystemFont,sans-serif'
  ctx.fillStyle = '#8888a0'
  cols.forEach((c, i) => ctx.fillText(c, colX[i], y + 14))
  y += 22
  ctx.font = '12px -apple-system,BlinkMacSystemFont,sans-serif'
  p.agents.forEach((a) => {
    ctx.fillStyle = 'rgba(255,255,255,0.02)'
    roundRect(ctx, pad, y - 4, W - pad * 2, 26, 6); ctx.fill()
    ctx.fillStyle = '#e8e8f0'; ctx.fillText(a.name, colX[0], y + 14)
    ctx.fillStyle = '#34c759'; ctx.fillText(fmtSec(a.workSec), colX[1], y + 14)
    ctx.fillStyle = '#f97316'; ctx.fillText(fmtSec(a.idleSec), colX[2], y + 14)
    ctx.fillStyle = '#a855f7'; ctx.fillText(fmtSec(a.chatSec), colX[3], y + 14)
    ctx.fillStyle = '#4a90d9'; ctx.fillText(`${a.toiletCount}次`, colX[4], y + 14)
    ctx.fillStyle = '#ff6b9d'; ctx.fillText(`${a.visitCount}次`, colX[5], y + 14)
    y += 30
  })

  // 排行榜
  y += 6
  ctx.fillStyle = '#c0c0d0'
  ctx.font = '700 12px -apple-system,BlinkMacSystemFont,sans-serif'
  ctx.fillText('排行榜', pad, y)
  y += 18
  const ranks = [
    { title: '卷王', items: rankItems(p.agents, a => a.workSec).map(a => `${a.name} ${fmtSec(a.workSec)}`), color: '#00d4ff' },
    { title: '摸鱼王', items: rankItems(p.agents, a => a.idleSec).map(a => `${a.name} ${fmtSec(a.idleSec)}`), color: '#f97316' },
    { title: '厕所之王', items: rankItems(p.agents, a => a.toiletCount).map(a => `${a.name} ${a.toiletCount}次`), color: '#4a90d9' },
    { title: '话痨', items: rankItems(p.agents, a => a.chatSec).map(a => `${a.name} ${fmtSec(a.chatSec)}`), color: '#a855f7' },
    { title: '串门王', items: rankItems(p.agents, a => a.visitCount).map(a => `${a.name} ${a.visitCount}次`), color: '#ff6b9d' },
  ]
  const cw = (W - pad * 2 - 16) / 5
  ranks.forEach((r, i) => {
    const x = pad + i * (cw + 4)
    ctx.fillStyle = 'rgba(255,255,255,0.02)'
    roundRect(ctx, x, y, cw, 96, 8); ctx.fill()
    ctx.fillStyle = r.color
    ctx.font = '700 11px -apple-system,BlinkMacSystemFont,sans-serif'
    ctx.fillText(r.title, x + 8, y + 16)
    ctx.fillStyle = '#c0c0d0'
    ctx.font = '11px -apple-system,BlinkMacSystemFont,sans-serif'
    r.items.forEach((it, j) => ctx.fillText(`${j + 1}. ${it}`, x + 8, y + 36 + j * 18))
  })

  if (p.wrongToiletCount > 0) {
    y += 116
    ctx.fillStyle = '#ef4444'
    ctx.font = '11px -apple-system,BlinkMacSystemFont,sans-serif'
    ctx.fillText(`异常：走错厕所 ${p.wrongToiletCount} 次`, pad, y)
  }

  return canvas
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 复制：把整张报告图写入剪贴板（全图不裁剪）；不支持时回退为下载 */
async function copyReportImage(p: ReportPayload): Promise<{ ok: boolean; downloaded?: boolean }> {
  try {
    const canvas = renderReportCanvas(p)
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/png'))
    if (!blob) return { ok: false }
    if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
      triggerDownload(blob, `办公日报-${String(p.simH).padStart(2, '0')}00.png`)
      return { ok: false, downloaded: true }
    }
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

/** 导出图片：把报告画到 canvas 并下载 PNG（无外部依赖） */
function exportReportPng(p: ReportPayload) {
  const canvas = renderReportCanvas(p)
  canvas.toBlob((blob) => {
    if (!blob) return
    triggerDownload(blob, `办公日报-${String(p.simH).padStart(2, '0')}00.png`)
  }, 'image/png')
}

/** 团队今日小结（动态生成文案） */
function buildTeamSummary(
  agents: ReportAgent[],
  topWorker: ReportAgent[],
  topSlacker: ReportAgent[],
  wrongToiletCount: number,
  simH: number,
): string {
  if (agents.length === 0) return '数据收集中，稍候片刻即可看到团队今日的行为画像。'
  const parts: string[] = []
  parts.push(`截至 ${String(simH).padStart(2, '0')}:00，团队共 ${agents.length} 人在岗。`)
  const worker = topWorker[0]
  const slacker = topSlacker[0]
  if (worker && worker.workSec > 0) parts.push(`最卷的是 ${worker.name}（工时 ${fmtSec(worker.workSec)}）`)
  if (slacker && slacker.idleSec > 0) parts.push(`最摸鱼的是 ${slacker.name}（摸鱼 ${fmtSec(slacker.idleSec)}）`)
  if (wrongToiletCount > 0) parts.push(`今日还发生了 ${wrongToiletCount} 次走错厕所的乌龙。`)
  return parts.join('，') + '。'
}

function OfficeDailyReport({ onClose }: { onClose: () => void }) {
  const [stats, setStats] = useState<Record<string, AgentStat>>({})
  const [names, setNames] = useState<Record<string, string>>({})
  const [activities, setActivities] = useState<Array<{ text: string; color: number; time: string }>>([])
  const [phase, setPhase] = useState<'day'|'dusk'|'night'>('day')
  const [simH, setSimH] = useState(9)
  const [copied, setCopied] = useState(false)
  const [imgState, setImgState] = useState<'idle' | 'copied' | 'downloaded'>('idle')

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

  // Escape 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const agents: ReportAgent[] = Object.keys(stats).map(id => {
    const s = stats[id]!
    return {
      id, name: names[id] || id,
      workSec: s.workSec, idleSec: s.idleSec, chatSec: s.chatSec,
      toiletCount: s.toiletCount, toiletTotalSec: s.toiletTotalSec, visitCount: s.visitCount,
    }
  })

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

  const payload: ReportPayload = { agents, simH, phase, wrongToiletCount }
  const summary = buildTeamSummary(agents, topWorker, topSlacker, wrongToiletCount, simH)

  const handleCopy = async () => {
    const ok = await copyReportText(payload)
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1600) }
  }
  const handleExport = () => exportReportPng(payload)
  const handleCopyImage = async () => {
    const r = await copyReportImage(payload)
    if (r.ok) { setImgState('copied'); setTimeout(() => setImgState('idle'), 1600) }
    else if (r.downloaded) { setImgState('downloaded'); setTimeout(() => setImgState('idle'), 1600) }
  }

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
              <SvgIcon id={phase === 'day' ? 'i-sun' : phase === 'dusk' ? 'i-dusk' : 'i-moon'} size={13}/>
              {phase === 'day' ? '白天' : phase === 'dusk' ? '傍晚' : '夜间'}
            </span>
          </div>
          <p className="dr-sub">模拟时间 {String(simH).padStart(2, '0')}:00 · 实时行为统计分析</p>
          <button className="dr-close" onClick={onClose} aria-label="关闭报告">×</button>
        </div>

        {/* 团队今日小结 */}
        <div className="dr-section dr-summary">
          <div className="dr-section-title"><SvgIcon id="i-chart" size={12}/> 团队今日小结</div>
          <p className="dr-summary-text">{summary}</p>
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

        {/* 成员明细表 */}
        <div className="dr-section">
          <div className="dr-section-title">成员明细</div>
          <div className="dr-table">
            <div className="dr-tr dr-th">
              <span>成员</span><span>工时</span><span>摸鱼</span><span>聊天</span><span>如厕</span><span>串门</span>
            </div>
            {agents.length === 0 ? (
              <div className="dr-tr"><span className="dr-empty" style={{ gridColumn: '1 / -1' }}>数据收集中…</span></div>
            ) : agents.map(a => (
              <div className="dr-tr" key={a.id}>
                <span className="dr-name">{a.name}</span>
                <span className="t-work">{fmtSec(a.workSec)}</span>
                <span className="t-idle">{fmtSec(a.idleSec)}</span>
                <span className="t-chat">{fmtSec(a.chatSec)}</span>
                <span className="t-toilet">{a.toiletCount}次</span>
                <span className="t-visit">{a.visitCount}次</span>
              </div>
            ))}
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
          <button type="button" className="dr-act-btn" onClick={handleCopy}>{copied ? '已复制' : '复制'}</button>
          <button type="button" className="dr-act-btn" onClick={handleCopyImage}>{imgState === 'copied' ? '已复制图片' : imgState === 'downloaded' ? '已下载图片' : '复制图片'}</button>
          <button type="button" className="dr-act-btn" onClick={handleExport}>导出图片</button>
          <button type="button" className="dr-act-btn primary" onClick={onClose}>关闭报告</button>
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

/* ═════════ 真实项目弹窗（主从布局）════════ */
export function OfficeProjectsModal({ onClose }: { onClose: () => void }) {
  const [activeId, setActiveId] = useState<string>(PROJECTS[0]?.id ?? '')
  const active = PROJECTS.find(p => p.id === activeId) ?? PROJECTS[0]
  const agentName = (id: string) => AGENT_ROSTER.find(r => r.id === id)?.name ?? id
  const agentColor = (id: string) => {
    const c = AGENT_ROSTER.find(r => r.id === id)?.color
    return c != null ? '#' + c.toString(16).padStart(6, '0') : '#888'
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="projects-overlay" onClick={onClose}>
      <div className="projects-card" onClick={e => e.stopPropagation()}>
        <div className="proj-head">
          <div className="proj-title-row">
            <SvgIcon id="i-folder" size={18}/>
            <h3>真实项目看板</h3>
            <span className="proj-count">{PROJECTS.length} 个进行中 / 规划项目</span>
          </div>
          <button className="dr-close" onClick={onClose} aria-label="关闭项目">×</button>
        </div>
        <div className="proj-body">
          {/* 左侧主列表 */}
          <div className="proj-list">
            {PROJECTS.map(p => {
              const owner = agentName(p.ownerId)
              return (
                <button
                  key={p.id}
                  type="button"
                  className={'proj-item' + (p.id === activeId ? ' on' : '')}
                  onClick={() => setActiveId(p.id)}
                >
                  <span className="proj-item-icon"><SvgIcon id={p.icon} size={15}/></span>
                  <span className="proj-item-main">
                    <span className="proj-item-name">{p.name}</span>
                    <span className="proj-item-owner">负责人 · {owner}</span>
                  </span>
                  <span className={'proj-item-status'} data-status={p.status}>{p.status}</span>
                </button>
              )
            })}
          </div>
          {/* 右侧详情 */}
          {active && (
            <div className="proj-detail">
              <div className="proj-detail-head">
                <span className="proj-detail-icon"><SvgIcon id={active.icon} size={20}/></span>
                <div>
                  <div className="proj-detail-name">{active.name}</div>
                  <div className="proj-detail-tags">
                    <span className="proj-tag" data-status={active.status}>{active.status}</span>
                    <span className="proj-tag">负责人 {agentName(active.ownerId)}</span>
                  </div>
                </div>
              </div>
              {/* 进度条 */}
              <div className="proj-progress">
                <div className="proj-progress-track">
                  <div className="proj-progress-fill" style={{ width: active.progress + '%' }}/>
                </div>
                <span className="proj-progress-val">{active.progress}%</span>
              </div>
              {/* 成员 */}
              <div className="proj-section">
                <div className="proj-section-title"><SvgIcon id="i-users" size={12}/> 参与成员</div>
                <div className="proj-members">
                  {active.memberIds.map(id => (
                    <span key={id} className="proj-member" style={{ borderColor: agentColor(id) }}>
                      <span className="proj-member-dot" style={{ background: agentColor(id) }}/>
                      {agentName(id)}
                    </span>
                  ))}
                </div>
              </div>
              {/* 简介 */}
              <div className="proj-section">
                <div className="proj-section-title"><SvgIcon id="i-doc" size={12}/> 项目简介</div>
                <p className="proj-text">{active.desc}</p>
              </div>
              {/* 分工 */}
              <div className="proj-section">
                <div className="proj-section-title"><SvgIcon id="i-sliders" size={12}/> 分工</div>
                <ul className="proj-list-text">
                  {active.division.map((d, i) => <li key={i}>{d}</li>)}
                </ul>
              </div>
              {/* 进展 */}
              <div className="proj-section">
                <div className="proj-section-title"><SvgIcon id="i-trend" size={12}/> 当前进展</div>
                <p className="proj-text">{active.progressText}</p>
              </div>
              {/* 输出成果 */}
              <div className="proj-section">
                <div className="proj-section-title"><SvgIcon id="i-bar" size={12}/> 输出成果</div>
                <div className="proj-outputs">
                  {active.outputs.map((o, i) => (
                    <span key={i} className="proj-output">{o}</span>
                  ))}
                </div>
              </div>
              {active.link && (
                <a className="proj-link" href={active.link} target="_blank" rel="noopener noreferrer">
                  <SvgIcon id="i-link" size={13}/> 打开关联工具
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

