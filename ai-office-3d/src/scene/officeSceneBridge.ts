/** OfficeScene ↔ React 桥接 */
import type { OfficeScene } from '@/scene/OfficeScene'

let _scene: OfficeScene | null = null

export function bindOfficeScene(scene: OfficeScene | null) {
  _scene = scene
}

export function getOfficeScene(): OfficeScene | null {
  return _scene
}
