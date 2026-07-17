import { Application, Container, Graphics, Sprite } from 'pixi.js'
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

    // 后墙柜子组
    for (let i = 0; i < 5; i++) {
      const cx = 200 + i * 140
      const cabinet = new Graphics()
      cabinet.roundRect(cx - 30, 16, 60, 76, 4)
      cabinet.fill({ color: 0xf5f4f0, alpha: 0.8 })
      cabinet.stroke({ color: 0xd8d4cc, width: 0.5 })
      // 柜门分割线
      cabinet.moveTo(cx, 24)
      cabinet.lineTo(cx, 84)
      cabinet.stroke({ color: 0xd8d4cc, width: 0.5, alpha: 0.6 })
      map.addChild(cabinet)
    }

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
