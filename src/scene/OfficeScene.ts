import { Application, Container, Graphics, Sprite, Text, TextStyle } from 'pixi.js'
import type { FederatedPointerEvent } from 'pixi.js'
import type { Agent } from '@/types/agent'
import { AGENT_ROSTER, COLORS, DESKS, INITIAL_AGENTS, pickHandoffVisitMessage, SCENE_HEIGHT, SCENE_WIDTH } from '@/scene/layout/officeLayout'
import { AgentEntity } from '@/scene/entities/AgentEntity'
import { DeskEntity } from '@/scene/entities/DeskEntity'
import { MovementSystem } from '@/scene/systems/MovementSystem'
import { AnimationSystem } from '@/scene/systems/AnimationSystem'
import { OfficeSimulator } from '@/scene/simulation/OfficeSimulator'
import { loadOfficeAssets, getOfficeBackgroundTexture } from '@/scene/assets/loadOfficeAssets'
import { setOfficeAgents } from '@/store/officeStore'
import { bindOfficeScene } from '@/scene/officeSceneBridge'

export type OfficeAgentClick = {
  agent: Agent
  rosterNo: number
  clientX: number
  clientY: number
}

type AutoWorkflowStep = { visitor: number; host: number; message: string }
const AUTO_WORKFLOW_MAX_ACTIVE = 2
const AUTO_WORKFLOW_INTERVAL = 1.2

const AUTO_WORKFLOW_STEPS: AutoWorkflowStep[] = [
  { visitor: 1, host: 2, message: '新一批评价数据出来了，帮忙跑一下打分。' },
  { visitor: 2, host: 4, message: '评分结果出炉，看看哪些方向值得开发。' },
  { visitor: 4, host: 5, message: '盲盒抽中这个方向，帮忙出一版创意图。' },
  { visitor: 6, host: 1, message: '压力测试跑完了，反馈已汇总。' },
  { visitor: 3, host: 6, message: '数字世界模拟完成，数据给你做测试。' },
  { visitor: 5, host: 7, message: '创意图做好了，放到原理展厅看一下。' },
  { visitor: 7, host: 1, message: '展厅已更新，来看看新工具。' },
  { visitor: 2, host: 3, message: '把打分的洞察同步到数字世界模型。' },
]

export class OfficeScene {
  private app: Application | null = null
  private world: Container | null = null
  private agentEntities = new Map<string, AgentEntity>()
  private deskEntities = new Map<string, DeskEntity>()
  private officeLayer: Container | null = null

  private movement = new MovementSystem()
  private animation = new AnimationSystem()
  private simulator = new OfficeSimulator()

  private agents: Agent[] = INITIAL_AGENTS.map((a) => ({ ...a }))
  private autoWorkflowTimer = 0.8
  private autoWorkflowIndex = 0
  private paused = false
  private speed = 100
  /** 模拟时间（秒，0-86400），从 9:00 开始，1×=1秒/秒，100×=100秒/秒 */
  private simTime = 9 * 3600
  /** 夜晚遮罩 */
  private nightOverlay: Container | null = null
  /** 厕所区状态：5 个隔间 */
  private stallGraphics: Graphics[] = []
  private stallDoorGraphics: Graphics[] = []
  private stallOccupiedIndicators: Graphics[] = []
  /** 5 个隔间的占用者（agent id，未占用为 null） */
  private stallOccupants: (string | null)[] = [null, null, null, null, null]
  /** 每个 agent 进入厕所的随机时长（秒） */
  private stallEntryTime: (number | null)[] = [null, null, null, null, null]
  /** 厕所 UI 引用 */
  private wcLabelText: Text | null = null
  private wcLabelBg: Graphics | null = null
  /** 活动日志（最近 12 条） */
  private activityLog: Array<{ text: string; color: number; time: string; ts: number }> = []
  /** 上次决策时间（避免连续触发） */
  private lastToiletCheck = 0
  private readonly options: { onAgentClick?: (event: OfficeAgentClick) => void }

  constructor(options: { onAgentClick?: (event: OfficeAgentClick) => void } = {}) {
    this.options = options
  }

  async init(container: HTMLElement, width: number, height: number) {
    const app = new Application()
    await app.init({ width, height, backgroundColor: COLORS.floor, antialias: true, resolution: window.devicePixelRatio || 1, autoDensity: true })
    this.app = app
    container.appendChild(app.canvas)

    this.world = new Container()
    app.stage.addChild(this.world)
    this.fitStage(width, height)

    await loadOfficeAssets()

    this.drawMap(this.world)
    this.spawnOffice(this.world)
    this.pushDataToEntities()
    setOfficeAgents(this.agents)

    // 夜晚遮罩
    this.nightOverlay = new Container()
    const ng = new Graphics()
    ng.rect(0, 0, SCENE_WIDTH, SCENE_HEIGHT)
    ng.fill({ color: 0x0a0e27, alpha: 0.0 })
    this.nightOverlay.addChild(ng)
    ;(ng as any).__rect = true
    this.world.addChild(this.nightOverlay)

    app.ticker.add(this.onTick)
    bindOfficeScene(this)
  }

  requestDeskVisit(visitorRosterNo: number, hostRosterNo: number, message: string) {
    this.agents = this.simulator.startDeskVisit(this.agents, visitorRosterNo, hostRosterNo, message)
    this.pushDataToEntities()
  }

  requestDeskVisitTour(visitorRosterNo: number, hostRosterNos: number[], messageFn?: (hostRosterNo: number, hostName: string) => string) {
    this.agents = this.simulator.startDeskVisitTour(this.agents, visitorRosterNo, hostRosterNos, pickHandoffVisitMessage)
    this.pushDataToEntities()
  }

  setAgentState(id: string, state: string, task?: string) {
    this.agents = this.agents.map((a) => {
      if (a.id !== id) return a
      return { ...a, state: state as any, currentTask: task, targetX: undefined, targetY: undefined, walkPath: undefined, walkPathIndex: undefined, mission: undefined, bubbleText: undefined, viewFacing: state === 'working' ? 'back' : a.viewFacing }
    })
    this.pushDataToEntities()
  }

  playAgentAnimation(id: string, _animation: string, task?: string) {
    this.agents = this.agents.map((a) => {
      if (a.id !== id) return a
      return { ...a, state: 'talking' as any, currentTask: task, targetX: undefined, targetY: undefined, walkPath: undefined, walkPathIndex: undefined, mission: undefined, bubbleText: undefined, viewFacing: 'front' as any, facing: 1 }
    })
    this.pushDataToEntities()
  }

  getAgents(): Agent[] {
    return this.agents.map((a) => ({ ...a }))
  }

  /** 暴露活动日志给 React UI */
  getActivityLog() {
    return this.activityLog.slice(-12).reverse()
  }

  /** 推入一条活动事件 */
  pushActivity(text: string, color: number) {
    const h = Math.floor(this.simTime / 3600) % 24
    const m = Math.floor((this.simTime % 3600) / 60)
    const time = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0')
    this.activityLog.push({ text, color, time, ts: Date.now() })
    if (this.activityLog.length > 30) this.activityLog.shift()
  }

  resize(containerWidth: number, containerHeight: number) {
    if (!this.app || !this.world) return
    this.app.renderer.resize(containerWidth, containerHeight)
    this.fitStage(containerWidth, containerHeight)
  }

  destroy() {
    bindOfficeScene(null)
    this.app?.ticker.remove(this.onTick)
    this.app?.destroy(true, { children: true })
    this.app = null
    this.agentEntities.clear()
    this.deskEntities.clear()
    this.officeLayer = null
    this.nightOverlay = null
  }

  private fitStage(cw: number, ch: number) {
    if (!this.world) return
    const scale = Math.min(cw / SCENE_WIDTH, ch / SCENE_HEIGHT)
    this.world.scale.set(scale)
    this.world.position.set((cw - SCENE_WIDTH * scale) / 2, (ch - SCENE_HEIGHT * scale) / 2)
    const canvas = this.app?.canvas as HTMLCanvasElement | undefined
    if (!canvas) return
    canvas.style.cssText = 'display:block;width:100%;height:100%;max-width:100%;max-height:100%'
  }

  private onTick = (ticker: { deltaTime: number }) => {
    if (this.paused) return
    const realDt = Math.min(ticker.deltaTime / 60, 0.05)
    // 模拟时间按 speed 倍率推进（speed=100 → 1 真实秒 = 100 模拟秒）
    this.simTime += realDt * this.speed
    if (this.simTime >= 24 * 3600) this.simTime -= 24 * 3600
    const dt = realDt * this.speed
    const ph = this.phase()
    this.applyNightOverlay(ph)

    this.agents = this.simulator.tick(dt, this.agents)
    // 下班逻辑：白天在工作 → 傍晚后自动 reset 到工作 → 夜晚所有小人离开
    this.applyOffWork(ph)
    // 厕所决策：低概率触发「我想上厕所」事件
    this.checkToiletDecision(dt, ph)
    // 厕所计时：检查是否有 agent 蹲够了时间
    this.checkStallExit()
    this.pushDataToEntities()

    this.movement.update(this.agentEntities, dt)
    this.pullDataFromEntities()

    this.agents = this.simulator.afterMovement(dt, this.agents, this.agentEntities)
    this.pushDataToEntities()

    this.updateAutoWorkflow(dt)
    this.animation.update(this.agentEntities, dt)
    this.sortOfficeDepth()
    this.syncDeskOccupancy()

    setOfficeAgents(this.agents)
  }

  /** 厕所门位置：场景顶部中央 */
  private wcDoorX = 330
  private wcDoorY = 130
  /** 各 stall 内部位置（agent 进入后站在这里） */
  private stallInsidePos(i: number) {
    const stallStartX = 200
    const stallSpacing = 130
    return { x: stallStartX + i * stallSpacing, y: 64 }
  }
  private stallEntryPos(i: number) {
    const stallStartX = 200
    const stallSpacing = 130
    return { x: stallStartX + i * stallSpacing, y: 130 }
  }

  /** 决策：是否有 agent 想去厕所（白天 9-18 之间 1-2% 概率/秒/agent） */
  private checkToiletDecision(dt: number, ph: string) {
    if (ph !== 'day') return
    // 至少 30 真实秒决策一次（避免太频繁）
    this.lastToiletCheck += dt
    if (this.lastToiletCheck < 30) return
    this.lastToiletCheck = 0

    // 找一个空闲 stall
    const freeStalls = this.stallOccupants.map((o, i) => o === null ? i : -1).filter(i => i >= 0)
    if (freeStalls.length === 0) return

    // 找一个空闲 + 当前在工作状态 + 没在 mission 的 agent
    const candidates = this.agents.filter(a => {
      if (a.state !== 'working' && a.state !== 'idle') return false
      if (a.mission) return false
      return true
    })
    if (candidates.length === 0) return

    // 随机 1 个候选
    if (Math.random() > 0.4) return  // 40% 概率触发
    const agent = candidates[Math.floor(Math.random() * candidates.length)]
    const stallIdx = freeStalls[Math.floor(Math.random() * freeStalls.length)]

    // 随机 1-30 分钟（在 stallEntryTime 数组里存模拟秒）
    const minutes = Math.random() < 0.7 ? (1 + Math.floor(Math.random() * 5)) : (10 + Math.floor(Math.random() * 25))
    this.stallEntryTime[stallIdx] = minutes * 60
    this.stallOccupants[stallIdx] = agent.id

    // 走过去
    this.walkAgentTo(agent.id, this.stallEntryPos(stallIdx), () => {
      // 到达门口后，进入 stall
      this.enterStall(stallIdx, agent.id, agent.name)
    })
    this.pushActivity(agent.name + ' 走向厕所，准备开门进入', 0x4a90d9)
  }

  /** 让 agent 走（动画）到指定位置 */
  private walkAgentTo(agentId: string, target: { x: number; y: number }, onArrive: () => void) {
    const a = this.agents.find(x => x.id === agentId)
    if (!a) { onArrive(); return }
    a.state = 'walking'
    a.targetX = target.x
    a.targetY = target.y
    a.walkPath = undefined
    a.walkPathIndex = undefined
    a.currentTask = undefined
    a.bubbleText = '🚻'
    this.pushDataToEntities()
    // 注册一次性监听：等走到位置
    const checkArrive = setInterval(() => {
      const cur = this.agents.find(x => x.id === agentId)
      if (!cur) { clearInterval(checkArrive); return }
      if (cur.state !== 'walking' || (cur.targetX === undefined || cur.targetY === undefined)) {
        clearInterval(checkArrive)
        onArrive()
      }
      if (Math.abs(cur.x - target.x) < 8 && Math.abs(cur.y - target.y) < 8) {
        clearInterval(checkArrive)
        onArrive()
      }
    }, 200)
  }

  /** 进入隔间：开门、进去 */
  private enterStall(stallIdx: number, agentId: string, agentName: string) {
    // 开门动画：填充半透明蓝色矩形
    const door = this.stallDoorGraphics[stallIdx]
    if (door) {
      door.clear()
      door.rect(-50, -28, 100, 56)
      door.fill({ color: 0x4a90d9, alpha: 0.6 })
    }
    // 占用指示器亮
    const occ = this.stallOccupiedIndicators[stallIdx]
    if (occ) occ.alpha = 0.9

    // 0.6 秒后进入
    setTimeout(() => {
      const a = this.agents.find(x => x.id === agentId)
      if (a) {
        const inside = this.stallInsidePos(stallIdx)
        a.x = inside.x; a.y = inside.y
        a.state = 'thinking'  // 用 thinking 状态表示蹲着
        a.viewFacing = 'back' as any
        a.facing = 1
        a.bubbleText = '🚽 ' + Math.round((this.stallEntryTime[stallIdx] || 0) / 60) + '分钟'
        // 关上门
        if (door) {
          door.clear()
          door.rect(-50, -28, 100, 56)
          door.fill({ color: 0x4a90d9, alpha: 0.0 })
          door.stroke({ color: 0x4a90d9, width: 1 })
        }
        this.pushDataToEntities()
        this.pushActivity(agentName + ' 关上厕所门，开始蹲坑（' + Math.round((this.stallEntryTime[stallIdx] || 0) / 60) + ' 分钟）', 0x4a90d9)
      }
    }, 600)
  }

  /** 检查是否有 agent 蹲够了时间 */
  private checkStallExit() {
    for (let i = 0; i < 5; i++) {
      const entry = this.stallEntryTime[i]
      const occ = this.stallOccupants[i]
      if (entry == null || occ == null) continue
      const remaining = entry - 1  // 每次减 1 模拟秒
      if (remaining <= 0) {
        // 时间到：开门 + agent 出来
        this.exitStall(i, occ)
        this.stallEntryTime[i] = null
        this.stallOccupants[i] = null
      } else {
        this.stallEntryTime[i] = remaining
        // 更新气泡
        const a = this.agents.find(x => x.id === occ)
        if (a && a.bubbleText) {
          a.bubbleText = '🚽 还剩 ' + Math.ceil(remaining / 60) + '分钟'
        }
      }
    }
  }

  /** 出来隔间 */
  private exitStall(stallIdx: number, agentId: string) {
    const a = this.agents.find(x => x.id === agentId)
    if (!a) return
    // 开门
    const door = this.stallDoorGraphics[stallIdx]
    if (door) {
      door.clear()
      door.rect(-50, -28, 100, 56)
      door.fill({ color: 0x4a90d9, alpha: 0.6 })
    }
    const occ = this.stallOccupiedIndicators[stallIdx]
    if (occ) occ.alpha = 0

    setTimeout(() => {
      // agent 出来走到门口
      a.x = this.stallEntryPos(stallIdx).x
      a.y = this.stallEntryPos(stallIdx).y
      a.bubbleText = '😌 终于出来了'
      this.pushDataToEntities()
      this.pushActivity(a.name + ' 上完厕所出来（用了 ' + Math.round(((this.stallEntryTime[stallIdx] || 0) + 1) / 60) + ' 分钟）', 0x34c759)
      // 关上门
      if (door) {
        door.clear()
        door.rect(-50, -28, 100, 56)
        door.fill({ color: 0x4a90d9, alpha: 0.0 })
        door.stroke({ color: 0x4a90d9, width: 0 })
      }
      // 1.5 秒后走回工位
      setTimeout(() => {
        const desk = (this.agents.find(x => x.id === agentId) as any)?.assignedDeskId
        if (desk) {
          const deskPos = this.getDeskSeat(desk)
          if (deskPos) {
            this.walkAgentTo(agentId, deskPos, () => {
              const cur = this.agents.find(x => x.id === agentId)
              if (cur) {
                cur.bubbleText = undefined
                cur.state = 'working'
                cur.viewFacing = 'back' as any
                this.pushDataToEntities()
              }
            })
          }
        }
      }, 1500)
    }, 600)
  }

  /** 获取工位座位坐标（从 DeskEntity） */
  private getDeskSeat(deskId: string) {
    const desk = this.deskEntities.get(deskId)
    if (desk) return desk.getSeatPosition()
    return null
  }

  /** 阶段：day(9-18) / dusk(18-21) / night(21-9) */
  phase(): 'day' | 'dusk' | 'night' {
    const h = this.simTime / 3600
    if (h >= 9 && h < 18) return 'day'
    if (h >= 18 && h < 21) return 'dusk'
    return 'night'
  }

  getTimeLabel(): string {
    const h = Math.floor(this.simTime / 3600) % 24
    const m = Math.floor((this.simTime % 3600) / 60)
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0')
  }

  /** 根据阶段设置夜晚遮罩透明度 */
  private applyNightOverlay(ph: 'day' | 'dusk' | 'night') {
    if (!this.nightOverlay) return
    const g = this.nightOverlay.children[0] as any
    if (!g || typeof g.clear !== 'function') return
    const h = this.simTime / 3600
    let alpha = 0
    if (h >= 18 && h < 21) {
      // 18-21 渐入
      alpha = (h - 18) / 3 * 0.4
    } else if (h >= 21) {
      alpha = 0.4
    } else if (h < 6) {
      alpha = 0.4
    } else if (h < 9) {
      // 6-9 渐出
      alpha = (9 - h) / 3 * 0.4
    }
    g.clear()
    g.rect(0, 0, SCENE_WIDTH, SCENE_HEIGHT)
    g.fill({ color: 0x0a0e27, alpha })
  }

  /** 下班逻辑：夜晚所有员工状态变为 gone（淡出） */
  private applyOffWork(ph: 'day' | 'dusk' | 'night') {
    if (ph !== 'night') return
    for (const a of this.agents) {
      if (a.state !== 'talking' && a.state !== 'walking') {
        if (a.state !== 'gone') {
          a.state = 'gone'
        }
      }
    }
  }

  pause() { this.paused = true }
  resume() { this.paused = false }
  setSpeed(s: number) { this.speed = s }
  reset() {
    this.simTime = 9 * 3600
    this.speed = 100
    this.paused = false
    this.agents = INITIAL_AGENTS.map((a) => ({ ...a }))
    this.autoWorkflowIndex = 0
    this.autoWorkflowTimer = 0.8
    for (const [id, entity] of this.agentEntities) {
      const a = this.agents.find((x) => x.id === id)
      if (a) entity.apply(a)
      entity.setPosition(a?.x ?? 0, a?.y ?? 0)
    }
    setOfficeAgents(this.agents)
  }

  /** 截图下载当前 PixiJS 画布为 PNG */
  screenshot() {
    if (!this.app) return
    const canvas = this.app.canvas as HTMLCanvasElement
    if (!canvas) return
    canvas.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'ai-office-' + this.getTimeLabel().replace(':', '') + '.png'
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }, 'image/png')
  }

  private updateAutoWorkflow(dt: number) {
    this.autoWorkflowTimer -= dt
    if (this.autoWorkflowTimer > 0) return

    const activeCount = this.agents.filter((a) => a.mission).length
    if (activeCount >= AUTO_WORKFLOW_MAX_ACTIVE) { this.autoWorkflowTimer = 0.35; return }

    const step = this.nextAvailableWorkflowStep()
    if (!step) { this.autoWorkflowTimer = 0.45; return }

    this.agents = this.simulator.startDeskVisit(this.agents, step.visitor, step.host, step.message)
    this.pushDataToEntities()
    this.autoWorkflowTimer = AUTO_WORKFLOW_INTERVAL
  }

  private nextAvailableWorkflowStep(): AutoWorkflowStep | null {
    for (let i = 0; i < AUTO_WORKFLOW_STEPS.length; i++) {
      const index = (this.autoWorkflowIndex + i) % AUTO_WORKFLOW_STEPS.length
      const step = AUTO_WORKFLOW_STEPS[index]!
      if (this.canStartWorkflowStep(step)) {
        this.autoWorkflowIndex = (index + 1) % AUTO_WORKFLOW_STEPS.length
        return step
      }
    }
    return null
  }

  private canStartWorkflowStep(step: AutoWorkflowStep): boolean {
    const visitor = this.agents[step.visitor - 1]
    const host = this.agents[step.host - 1]
    if (!visitor || !host) return false
    const busyIds = new Set<string>()
    for (const a of this.agents) {
      if (a.mission) { busyIds.add(a.id); busyIds.add(a.mission.hostAgentId) }
      if (a.state === 'walking') busyIds.add(a.id)
    }
    return !busyIds.has(visitor.id) && !busyIds.has(host.id)
  }

  private sortOfficeDepth() {
    if (!this.officeLayer) return
    const aps = [...this.agentEntities.values()].map((e) => ({ x: e.position.x, y: e.position.y }))
    for (const e of this.agentEntities.values()) e.zIndex = e.position.y
    for (const d of this.deskEntities.values()) d.updateDepthZ(aps)
    this.officeLayer.sortChildren()
  }

  private pushDataToEntities() {
    for (const agent of this.agents) {
      const entity = this.agentEntities.get(agent.id)
      if (!entity) continue
      entity.apply(agent)
      if (agent.state !== 'walking') entity.setPosition(agent.x, agent.y)
    }
  }

  private pullDataFromEntities() {
    this.agents = this.agents.map((agent) => {
      const entity = this.agentEntities.get(agent.id)
      return entity ? { ...agent, ...entity.data } : agent
    })
  }

  private syncDeskOccupancy() {
    const occupied = new Set(this.agents.filter((a) => a.state === 'working' && a.assignedDeskId).map((a) => a.assignedDeskId!))
    for (const desk of this.deskEntities.values()) desk.setOccupied(occupied.has(desk.deskId))
  }

  private spawnOffice(parent: Container) {
    const layer = new Container()
    layer.label = 'office'
    layer.sortableChildren = true
    this.officeLayer = layer

    for (const desk of DESKS) {
      const entity = new DeskEntity(desk)
      this.deskEntities.set(desk.id, entity)
      layer.addChild(entity.shadowGfx, entity.deskLayer, entity.chairLayer, entity.occupiedIndicator)
    }

    for (const agent of this.agents) {
      const entity = new AgentEntity(agent)
      this.agentEntities.set(agent.id, entity)
      entity.zIndex = agent.y
      entity.on('pointertap', (event: FederatedPointerEvent) => {
        event.stopPropagation()
        this.options.onAgentClick?.({
          agent: { ...entity.data },
          rosterNo: this.agents.findIndex((a) => a.id === agent.id) + 1,
          clientX: event.clientX,
          clientY: event.clientY,
        })
      })
      layer.addChild(entity)
    }

    this.sortOfficeDepth()
    parent.addChild(layer)
  }

  private drawMap(parent: Container) {
    const map = new Container()
    map.label = 'map'

    // 白色地板
    const floor = new Graphics()
    floor.rect(0, 0, SCENE_WIDTH, SCENE_HEIGHT)
    floor.fill(0xffffff)
    map.addChild(floor)

    // 地板渐变
    const floorGrad = new Graphics()
    floorGrad.rect(0, 0, SCENE_WIDTH, SCENE_HEIGHT)
    floorGrad.fill({ color: 0xf0efe8, alpha: 0.4 })
    map.addChild(floorGrad)

    // 地板网格线（等轴测菱形网格）
    const grid = new Graphics()
    const step = 40
    for (let x = -SCENE_WIDTH; x < SCENE_WIDTH * 2; x += step) {
      grid.moveTo(x, 0)
      grid.lineTo(x - SCENE_WIDTH, SCENE_HEIGHT)
    }
    for (let y = -SCENE_HEIGHT; y < SCENE_HEIGHT * 2; y += step) {
      grid.moveTo(0, y)
      grid.lineTo(SCENE_WIDTH, y + SCENE_HEIGHT)
    }
    grid.stroke({ color: 0xdddad4, width: 0.5, alpha: 0.5 })
    map.addChild(grid)

    // 后墙（场景顶部区域）
    const backWall = new Graphics()
    backWall.rect(0, 0, SCENE_WIDTH, 100)
    backWall.fill({ color: 0xe8e6e1, alpha: 0.8 })
    backWall.stroke({ color: 0xd8d4cc, width: 1, alpha: 0.4 })
    map.addChild(backWall)

    // 左墙（场景左侧区域）
    const leftWall = new Graphics()
    leftWall.rect(0, 0, 120, SCENE_HEIGHT)
    leftWall.fill({ color: 0xe8e6e1, alpha: 0.6 })
    leftWall.stroke({ color: 0xd8d4cc, width: 1, alpha: 0.4 })
    map.addChild(leftWall)

    // 厕所区：5 个隔间 + 1 个门（场景顶部 0-100px 区域）
    // 「厕所」标签
    const wcLabel = new Graphics()
    wcLabel.roundRect(60, 8, 70, 18, 4)
    wcLabel.fill({ color: 0x4a90d9, alpha: 0.9 })
    wcLabel.stroke({ color: 0x4a90d9, width: 0.5 })
    map.addChild(wcLabel)
    const wcText = new Text({
      text: '🚻 厕所',
      style: new TextStyle({
        fontSize: 11, fill: 0xffffff, fontWeight: '700',
        fontFamily: '-apple-system,BlinkMacSystemFont,sans-serif',
      }),
    })
    wcText.position.set(72, 12)
    map.addChild(wcText)
    this.wcLabelText = wcText
    this.wcLabelBg = wcLabel

    // 5 个隔间
    this.stallGraphics = []
    this.stallDoorGraphics = []
    const stallSpacing = 130
    const stallStartX = 200
    for (let i = 0; i < 5; i++) {
      const cx = stallStartX + i * stallSpacing
      // 隔间外框
      const stall = new Graphics()
      stall.roundRect(cx - 50, 36, 100, 56, 4)
      stall.fill({ color: 0xe8e6e1, alpha: 0.85 })
      stall.stroke({ color: 0xa8a39a, width: 1 })
      // 隔间中线
      stall.moveTo(cx, 36)
      stall.lineTo(cx, 92)
      stall.stroke({ color: 0xa8a39a, width: 0.5, alpha: 0.7 })
      map.addChild(stall)
      this.stallGraphics.push(stall)

      // 门（一个矩形遮挡，可旋转）
      const door = new Graphics()
      door.rect(cx - 50, 36, 100, 56)
      door.fill({ color: 0x6b7d8f, alpha: 0.0 })  // 透明（门打开）
      door.stroke({ color: 0x4a90d9, width: 0 })
      // 占用指示器
      const occ = new Graphics()
      occ.circle(0, 0, 6)
      occ.fill({ color: 0x00d4ff, alpha: 0.0 })
      occ.stroke({ color: 0x00d4ff, width: 1.5 })
      occ.position.set(cx, 64)
      map.addChild(occ)
      this.stallOccupiedIndicators.push(occ)
      map.addChild(door)
      this.stallDoorGraphics.push(door)
    }
    // 门标识（"厕所入口"）— 在隔间前
    const doorSign = new Graphics()
    doorSign.roundRect(stallStartX - 80, 110, 160, 20, 6)
    doorSign.fill({ color: 0x4a90d9, alpha: 0.85 })
    map.addChild(doorSign)
    const doorText = new Text({
      text: '🚪 厕所入口（点击观察）',
      style: new TextStyle({
        fontSize: 10, fill: 0xffffff, fontWeight: '600',
        fontFamily: '-apple-system,BlinkMacSystemFont,sans-serif',
      }),
    })
    doorText.position.set(stallStartX - 70, 114)
    map.addChild(doorText)

    // 左侧绿植
    const plant = new Graphics()
    // 花盆
    plant.roundRect(34, 280, 28, 32, 4)
    plant.fill(0xd4ccc0)
    // 叶子
    for (let i = 0; i < 5; i++) {
      const angle = i * 1.2
      const lx = 48 + Math.cos(angle) * 20
      const ly = 270 + Math.sin(angle) * 16
      plant.ellipse(lx, ly, 8, 4)
      plant.fill({ color: 0x4a9e6b, alpha: 0.7 + Math.random() * 0.3 })
    }
    map.addChild(plant)

    // 右侧绿植
    const plant2 = new Graphics()
    plant2.roundRect(898, 460, 28, 32, 4)
    plant2.fill(0xd4ccc0)
    for (let i = 0; i < 5; i++) {
      const angle = i * 1.2 + 0.5
      const lx = 912 + Math.cos(angle) * 20
      const ly = 450 + Math.sin(angle) * 16
      plant2.ellipse(lx, ly, 8, 4)
      plant2.fill({ color: 0x4a9e6b, alpha: 0.7 + Math.random() * 0.3 })
    }
    map.addChild(plant2)

    // 尝试加载图片背景（如已存在）
    const bgTex = getOfficeBackgroundTexture()
    if (bgTex) {
      const bg = new Sprite(bgTex)
      const scale = Math.min(SCENE_WIDTH / bgTex.width, SCENE_HEIGHT / bgTex.height)
      bg.scale.set(scale)
      bg.position.set((SCENE_WIDTH - bgTex.width * scale) / 2, (SCENE_HEIGHT - bgTex.height * scale) / 2)
      map.addChild(bg)
    }

    parent.addChildAt(map, 0)
  }
}
