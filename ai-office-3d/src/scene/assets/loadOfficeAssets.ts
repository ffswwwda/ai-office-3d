import { Assets, type Texture } from 'pixi.js'

const BACKGROUND_URL = '/assets/office/office.png'
const DESK_URL = '/assets/office/desk.png'
const CHAIR_URL = '/assets/office/chair.png'

const BACKGROUND_ALIAS = 'office-background'
const DESK_ALIAS = 'office-desk'
const CHAIR_ALIAS = 'office-chair'

let backgroundTexture: Texture | null = null
let deskTexture: Texture | null = null
let chairTexture: Texture | null = null

export function getOfficeBackgroundTexture(): Texture | null {
  return backgroundTexture
}
export function getOfficeDeskTexture(): Texture | null {
  return deskTexture
}
export function getOfficeChairTexture(): Texture | null {
  return chairTexture
}
export function isOfficeAssetsReady(): boolean {
  return true
}

async function tryLoad(alias: string, url: string, timeoutMs = 3000): Promise<Texture | null> {
  try {
    if (!Assets.resolver.hasKey(alias)) {
      Assets.add({ alias, src: url })
    }
    const loadPromise = Assets.load(alias) as Promise<Texture>
    const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))
    const result = await Promise.race([loadPromise, timeoutPromise])
    if (result && (result as Texture).source) {
      ;(result as Texture).source.scaleMode = 'linear'
      return result as Texture
    }
    return null
  } catch {
    return null
  }
}

export async function loadOfficeAssets(): Promise<boolean> {
  const bg = await tryLoad(BACKGROUND_ALIAS, BACKGROUND_URL)
  backgroundTexture = bg
  if (bg) console.info('[Office] 办公室背景已加载')

  const [desk, chair] = await Promise.all([
    tryLoad(DESK_ALIAS, DESK_URL),
    tryLoad(CHAIR_ALIAS, CHAIR_URL),
  ])
  deskTexture = desk
  chairTexture = chair
  if (desk && chair) {
    console.info('[Office] 工位桌椅素材已加载')
    return true
  }
  console.info('[Office] 部分素材缺失，使用矢量回退')
  return false
}

