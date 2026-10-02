// SPDX-License-Identifier: MIT
// KAMUCL adapter around the attributed MIT skinview3d model, not HMCL/FCL geometry.
import { Group, Mesh, type Material, type Texture } from 'three'
import { SkinObject, CapeObject } from './vendor/skinview3d/model'

export class PreviewPlayer extends Group {
  readonly skin = new SkinObject()
  readonly cape = new CapeObject()
  constructor() {
    super()
    this.skin.position.y = 24
    this.cape.position.set(0, 24, -2)
    this.cape.rotation.set(Math.PI / 18, Math.PI, 0)
    this.cape.visible = false
    this.add(this.skin, this.cape)
  }
  setCape(texture: Texture | null): void {
    this.cape.map = texture
    this.cape.visible = !!texture
  }
  pose(seconds: number, walking: number, yaw: number): void {
    this.rotation.set(0, yaw, 0)
    const angle = Math.cos(seconds * 4.71) * Math.PI / 4 * walking
    this.skin.leftArm.rotation.set(angle, 0, Math.PI * .02)
    this.skin.rightArm.rotation.set(-angle, 0, -Math.PI * .02)
    this.skin.leftLeg.rotation.set(-angle, 0, 0)
    this.skin.rightLeg.rotation.set(angle, 0, 0)
    this.skin.head.rotation.set(0, 0, 0)
  }
  dispose(): void {
    const materials = new Set<Material>()
    this.traverse(object => {
      if (!(object instanceof Mesh)) return
      object.geometry.dispose()
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material)
    })
    for (const material of materials) material.dispose()
    this.removeFromParent()
  }
}
