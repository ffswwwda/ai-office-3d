import { Container, FillGradient, Graphics, Sprite } from 'pixi.js'
import type { Desk } from '@/types/agent'
import { SEAT_OFFSET_Y } from '@/scene/layout/officeLayout'
import { getOfficeDeskTexture, getOfficeChairTexture } from '@/scene/assets/loadOfficeAssets'
import { computeChairLayerZ, computeDeskLayerZ } from '@/scene/systems/deskDepthSort'

const STYLE = {
  shadow: { color: 0x3d4f6e, alpha: 0.1 },
  deskTop: 0xfaf8f4,
  deskEdge: 0xe8e0d4,
  deskStroke: 0xd8d0c4,
  chairDark: 0x556b7d,
  chair: 0x7a8fa3,
  chairWheel: 0x3d4a56,
  monitor: 0x2e3238,
  screenTop: 0x7ec8ff,
  screenBottom: 0x4a8fd9,
  keyboard: 0xeeedea,
  keyboardStroke: 0xd0ccc4,
  mouse: 0xf5f4f1,
} as const

const DESK_BASE_WIDTH = 152
const CHAIR_BASE_WIDTH = 104
const DESK_ANCHOR_Y = 0.62
const DESK_TARGET_WIDTH = (DESK_BASE_WIDTH * 2) / 3
const CHAIR_ANCHOR_Y = 0.36
const CHAIR_TARGET_WIDTH = CHAIR_BASE_WIDTH / 2
const CHAIR_DEPTH_AHEAD = 2

export class DeskEntity {
  readonly deskId: string
  readonly shadowGfx = new Graphics()
  readonly deskLayer = new Container()
  readonly chairLayer = new Container()
  readonly occupiedIndicator = new Graphics()

  private desk: Desk

  constructor(desk: Desk) {
    this.deskId = desk.id
    this.desk = desk
    for (const part of [this.shadowGfx, this.deskLayer, this.chairLayer, this.occupiedIndicator]) {
      part.position.set(desk.x, desk.y)
    }
    this.drawShadow()
    this.mountSprites()
  }

  remountSprites() {
    this.deskLayer.removeChildren()
    this.chairLayer.removeChildren()
    this.mountSprites()
  }

  updateDepthZ(agentPositions: { x: number; y: number }[]) {
    this.deskLayer.zIndex = computeDeskLayerZ(this.desk, agentPositions)
    this.shadowGfx.zIndex = this.deskLayer.zIndex - 0.5
    this.chairLayer.zIndex = computeChairLayerZ(this.desk, agentPositions, CHAIR_DEPTH_AHEAD)
    this.occupiedIndicator.zIndex = this.chairLayer.zIndex + 0.5
  }

  setOccupied(occupied: boolean) {
    this.occupiedIndicator.clear()
    if (occupied) {
      this.occupiedIndicator.circle(0, SEAT_OFFSET_Y - 4, 5.5)
      this.occupiedIndicator.fill({ color: 0x50b86c, alpha: 0.85 })
      this.occupiedIndicator.stroke({ color: 0xffffff, width: 1.5, alpha: 0.6 })
    }
  }

  getSeatPosition() { return { x: this.desk.seatX, y: this.desk.seatY } }

  private mountSprites() {
    const deskTex = getOfficeDeskTexture()
    const chairTex = getOfficeChairTexture()

    if (deskTex) {
      const desk = new Sprite(deskTex)
      desk.anchor.set(0.5, DESK_ANCHOR_Y)
      desk.position.set(0, SEAT_OFFSET_Y - 14)
      desk.scale.set(DESK_TARGET_WIDTH / deskTex.width)
      this.deskLayer.addChild(desk)
    } else {
      this.drawDeskFallback()
    }

    if (chairTex) {
      const chair = new Sprite(chairTex)
      chair.anchor.set(0.5, CHAIR_ANCHOR_Y)
      chair.position.set(0, SEAT_OFFSET_Y)
      chair.scale.set(CHAIR_TARGET_WIDTH / chairTex.width)
      this.chairLayer.addChild(chair)
    } else {
      this.drawChairFallback()
    }
  }

  private drawShadow() {
    const g = this.shadowGfx
    g.clear()
    g.ellipse(0, SEAT_OFFSET_Y + 20, 54, 14)
    g.fill(STYLE.shadow)
  }

  private drawChairFallback() {
    const g = new Graphics()
    const seatY = 30
    const backTop = 40; const backBottom = 58; const baseY = 64

    g.ellipse(0, baseY, 30, 11)
    g.fill(STYLE.chairDark)
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2
      g.circle(Math.cos(a) * 24, baseY + Math.sin(a) * 6, 3.5)
      g.fill(STYLE.chairWheel)
    }
    g.roundRect(-24, backTop, 48, backBottom - backTop, 14)
    g.fill(STYLE.chair)
    g.roundRect(-22, seatY, 44, 14, 8)
    g.fill(STYLE.chair)
    g.position.set(0, SEAT_OFFSET_Y - 36)
    this.chairLayer.addChild(g)
  }

  private drawDeskFallback() {
    const g = new Graphics()

    // 桌面阴影
    g.ellipse(0, 14, 50, 10)
    g.fill({ color: 0x000000, alpha: 0.06 })

    // 桌面主体（带渐变质感）
    g.roundRect(-46, -6, 92, 34, 10)
    g.fill(0xfaf8f4)
    g.stroke({ color: STYLE.deskStroke, width: 1.5, alpha: 0.55 })
    // 桌面边缘厚度
    g.roundRect(-44, 22, 88, 8, 4)
    g.fill(0xe8e0d4)

    // 显示器底座
    g.ellipse(0, -12, 12, 4)
    g.fill({ color: 0x444444, alpha: 0.3 })
    // 显示器支架
    g.roundRect(-3, -48, 6, 36, 2)
    g.fill(0x444444)
    // 显示器屏幕
    g.roundRect(-22, -48, 44, 30, 6)
    g.fill(STYLE.monitor)
    // 屏幕渐变
    const screenGrad = new FillGradient({
      type: 'linear',
      start: { x: 0, y: 0 }, end: { x: 0, y: 1 },
      colorStops: [
        { offset: 0, color: STYLE.screenTop },
        { offset: 1, color: STYLE.screenBottom },
      ],
      textureSpace: 'local',
    })
    g.roundRect(-18, -44, 36, 22, 4)
    g.fill(screenGrad)

    // 键盘
    g.roundRect(-20, 0, 40, 8, 4)
    g.fill(STYLE.keyboard)
    g.stroke({ color: STYLE.keyboardStroke, width: 0.5, alpha: 0.4 })
    // 鼠标
    g.ellipse(18, 6, 5, 7)
    g.fill(STYLE.mouse)

    // 桌面小装饰：笔记本
    g.roundRect(24, -2, 12, 9, 2)
    g.fill({ color: 0x00d4ff, alpha: 0.15 })
    g.stroke({ color: 0x00d4ff, width: 0.5, alpha: 0.3 })

    // 三色渐变装饰线（品牌元素）
    g.moveTo(-36, 6)
    g.lineTo(-28, 6)
    g.stroke({ color: 0x00d4ff, width: 2, alpha: 0.5 })
    g.moveTo(-28, 6)
    g.lineTo(-20, 6)
    g.stroke({ color: 0xa855f7, width: 2, alpha: 0.5 })
    g.moveTo(-20, 6)
    g.lineTo(-12, 6)
    g.stroke({ color: 0xff6b9d, width: 2, alpha: 0.5 })

    this.deskLayer.addChild(g)
  }
}
