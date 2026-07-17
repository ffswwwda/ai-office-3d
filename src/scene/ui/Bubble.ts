import { Container, Graphics, Text, TextStyle } from 'pixi.js'

export class Bubble extends Container {
  static readonly TAIL_TIP_Y = 0
  private bg: Graphics
  private bubbleLabel: Text
  private timer = 0
  private text = ''

  constructor() {
    super()
    this.bg = new Graphics()
    this.bubbleLabel = new Text({
      text: '',
      style: new TextStyle({
        fontSize: 11, fill: 0x333333,
        fontFamily: '-apple-system,BlinkMacSystemFont,sans-serif',
        wordWrap: true, wordWrapWidth: 120,
        align: 'center',
      }),
    })
    this.addChild(this.bg, this.bubbleLabel)
    this.visible = false
  }

  show(text: string, duration = 4) {
    this.text = text
    this.timer = duration
    this.bubbleLabel.text = text
    this.drawBubble()
    this.visible = true
  }

  hide() {
    this.visible = false
    this.text = ''
  }

  update(dt: number) {
    if (!this.visible) return
    this.timer -= dt
    if (this.timer <= 0) {
      this.hide()
    }
  }

  private drawBubble() {
    const g = this.bg
    g.clear()
    const pw = this.bubbleLabel.width + 20
    const ph = this.bubbleLabel.height + 14
    const r = 10
    g.roundRect(-pw / 2, -ph - 4, pw, ph, r)
    g.fill({ color: 0xffffff, alpha: 0.95 })
    g.stroke({ color: 0xe0dcd4, width: 1 })
    // tail
    g.moveTo(-5, -3)
    g.lineTo(0, 4)
    g.lineTo(5, -3)
    g.closePath()
    g.fill({ color: 0xffffff, alpha: 0.95 })
    this.bubbleLabel.position.set(-this.bubbleLabel.width / 2, -this.bubbleLabel.height - 10)
  }
}
