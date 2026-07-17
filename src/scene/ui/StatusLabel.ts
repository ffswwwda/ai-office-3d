import { Container, Graphics, Text, TextStyle } from 'pixi.js'
import type { AgentState } from '@/types/agent'

const STATE_LABELS: Record<string, string> = {
  idle: '空闲',
  walking: '走动中',
  working: '工作中',
  talking: '对话中',
  thinking: '思考中',
}

const STATE_COLORS: Record<string, number> = {
  idle: 0x999999,
  walking: 0x00d4ff,
  working: 0x34c759,
  talking: 0xa855f7,
  thinking: 0xf5c542,
}

export class StatusLabel extends Container {
  private nameText: Text
  private stateText: Text
  private taskText: Text
  private bg: Graphics

  constructor(name: string) {
    super()
    this.bg = new Graphics()
    this.nameText = new Text({
      text: name,
      style: new TextStyle({
        fontSize: 12, fill: 0x222222,
        fontFamily: '-apple-system,BlinkMacSystemFont,sans-serif',
        fontWeight: '700',
      }),
    })
    this.stateText = new Text({
      text: '',
      style: new TextStyle({
        fontSize: 10, fill: 0x888888,
        fontFamily: '-apple-system,BlinkMacSystemFont,sans-serif',
      }),
    })
    this.taskText = new Text({
      text: '',
      style: new TextStyle({
        fontSize: 9, fill: 0xaaaaaa,
        fontFamily: '-apple-system,BlinkMacSystemFont,sans-serif',
      }),
    })
    this.addChild(this.bg, this.nameText, this.stateText, this.taskText)
  }

  setName(name: string) {
    this.nameText.text = name
  }

  setState(state: AgentState) {
    this.stateText.text = STATE_LABELS[state] ?? state
  }

  setTask(task?: string) {
    this.taskText.text = task ?? ''
  }

  /** 返回名称标签顶部在 headOffsetY 之上的 Y 位置 */
  getLabelTopY(headOffsetY: number): number {
    return headOffsetY - (this.nameText.height + this.stateText.height + this.taskText.height + 8)
  }

  layout(headOffsetY: number) {
    const gap = 2
    const topY = headOffsetY - this.nameText.height - gap
    this.nameText.position.set(-this.nameText.width / 2, topY)
    this.stateText.position.set(-this.stateText.width / 2, topY + this.nameText.height + gap)
    this.taskText.position.set(-this.taskText.width / 2, topY + this.nameText.height + this.stateText.height + gap * 2)

    // background pill
    this.bg.clear()
    const w = Math.max(this.nameText.width, this.stateText.width, this.taskText.width) + 16
    const h = this.nameText.height + this.stateText.height + this.taskText.height + 10
    this.bg.roundRect(-w / 2, topY - 3, w, h, 6)
    this.bg.fill({ color: 0xffffff, alpha: 0.85 })
    this.bg.stroke({ color: 0xe8e6e0, width: 0.5 })
  }
}
