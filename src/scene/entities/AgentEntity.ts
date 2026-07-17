import { Container, Graphics, Rectangle } from 'pixi.js'
import type { Agent, AgentState } from '@/types/agent'
import { resolveWalkViewFacing, viewFacingToLR } from '@/scene/systems/movementFacing'
import { Bubble } from '@/scene/ui/Bubble'
import { StatusLabel } from '@/scene/ui/StatusLabel'

export class AgentEntity extends Container {
  readonly agentId: string
  private agent: Agent
  private body: Graphics
  private accent: Graphics
  private statusLabel: StatusLabel
  private bubble: Bubble
  private walkPhase = 0

  constructor(agent: Agent) {
    super()
    this.agentId = agent.id
    this.agent = { ...agent }

    this.body = new Graphics()
    this.accent = new Graphics()
    this.statusLabel = new StatusLabel(agent.name)
    this.bubble = new Bubble()

    this.addChild(this.body, this.accent, this.statusLabel, this.bubble)

    this.eventMode = 'static'
    this.cursor = 'pointer'
    this.hitArea = new Rectangle(-24, -80, 48, 110)

    this.syncVisual()
    this.position.set(agent.x, agent.y)
  }

  get data(): Agent {
    return this.agent
  }

  apply(patch: Partial<Agent>) {
    this.agent = { ...this.agent, ...patch }
    this.statusLabel.setName(this.agent.name)
    this.statusLabel.setState(this.agent.state)
    this.statusLabel.setTask(
      this.agent.state === 'working' || this.agent.state === 'thinking'
        ? this.agent.currentTask : undefined,
    )
  }

  setPosition(x: number, y: number) {
    this.agent.x = x
    this.agent.y = y
    this.position.set(x, y)
  }

  showBubble(text: string, duration = 4) {
    this.agent.bubbleText = text
    this.bubble.show(text, duration)
  }

  hideBubble() {
    this.agent.bubbleText = undefined
    this.bubble.hide()
  }

  updateVisuals(state: AgentState, dt: number) {
    if (state === 'walking') {
      this.walkPhase += dt * 8
    } else if (state === 'working') {
      this.walkPhase += dt * 3
    } else if (state === 'gone') {
      // 下班：淡出
      this.walkPhase += dt * 0.5
    } else {
      this.walkPhase += dt * 0.5
    }

    this.alpha = state === 'gone' ? 0.2 : 1
    this.body.alpha = state === 'gone' ? 0.4 : 1
    this.accent.alpha = state === 'gone' ? 0.3 : 1
    this.drawBody(state)
    this.bubble.update(dt)
    this.updateOverlayPositions()
  }

  private updateOverlayPositions() {
    const headOffsetY = -58
    this.statusLabel.layout(headOffsetY)
    const labelTopY = this.statusLabel.getLabelTopY(headOffsetY)
    const gap = 4
    this.bubble.position.set(0, labelTopY - gap + Bubble.TAIL_TIP_Y + 10)
  }

  private syncVisual() {
    this.statusLabel.setName(this.agent.name)
    this.statusLabel.setState(this.agent.state)
    this.statusLabel.setTask(
      this.agent.state === 'working' || this.agent.state === 'thinking'
        ? this.agent.currentTask : undefined,
    )
    this.drawBody(this.agent.state)
    this.updateOverlayPositions()
  }

  private drawBody(state: AgentState) {
    const facing = this.agent.facing
    const g = this.body
    const a = this.accent
    g.clear()
    a.clear()

    const bounce = state === 'walking'
      ? Math.sin(this.walkPhase) * 2
      : state === 'working'
        ? Math.sin(this.walkPhase * 2) * 1
        : 0

    // shadow
    g.ellipse(0, 16 + bounce, 14, 4)
    g.fill({ color: 0x000000, alpha: 0.12 })

    // legs / pants with swing
    const legSwing = state === 'walking' ? Math.sin(this.walkPhase) * 3 : 0
    g.roundRect(-9, 6 + bounce + legSwing, 7, 12, 2)
    g.fill(0x3a3f4a)
    g.roundRect(2, 6 + bounce - legSwing, 7, 12, 2)
    g.fill(0x3a3f4a)

    // shirt body
    g.roundRect(-11, -8 + bounce, 22, 18, 4)
    g.fill(0xf0efe8)
    // collar
    g.roundRect(-7, -8 + bounce, 14, 4, 2)
    g.fill(0xe0ded4)

    // head
    g.circle(facing * 1, -20 + bounce, 10)
    g.fill(0xffe0c4)
    // hair
    g.roundRect(facing * 1 - 10, -28 + bounce, 20, 8, 3)
    g.fill(0x2a2a30)

    // eyes
    g.circle(facing * 1 - 3, -20 + bounce, 1.2)
    g.circle(facing * 1 + 3, -20 + bounce, 1.2)
    g.fill(0x222222)

    // working arm
    if (state === 'working') {
      const armY = -4 + bounce + Math.sin(this.walkPhase * 3) * 2
      g.roundRect(facing * 12, armY, 8, 4, 2)
      g.fill(0xf0efe8)
    }

    // talking arm (waving)
    if (state === 'talking') {
      const wave = Math.sin(this.walkPhase * 5) * 6
      g.roundRect(facing * 12, -4 + bounce - Math.abs(wave), 6, 4, 2)
      g.fill(0xf0efe8)
    }

    // thinking dots
    if (state === 'thinking') {
      for (let i = 0; i < 3; i++) {
        const phase = Math.floor(this.walkPhase) % 3
        g.circle(facing * (14 + i * 6), -34 + bounce, 2)
        g.fill({ color: this.agent.color, alpha: i <= phase ? 1 : 0.3 })
      }
    }

    this.accent.roundRect(facing * 4 - 5, -2 + bounce, 10, 8, 2)
    this.accent.fill(this.agent.color)

    // counter-flip labels so text stays upright when character faces left
    const flip = facing
    this.statusLabel.scale.x = flip
    this.bubble.scale.x = flip

    this.scale.x = facing
  }
}
