// SPDX-License-Identifier: MIT
// KAMUCL adapter around the attributed MIT skinview3d model, not HMCL/FCL geometry.
import { Group, Mesh, type Material, type Texture } from 'three'
import { SkinObject, CapeObject } from './vendor/skinview3d/model'

export type SkinPreviewAnimation = 'walk' | 'idle' | 'crouch' | 'fly'
export interface SkinPreviewStance { crouch: number; fly: number }

/** Reveal the horizontal body without replacing the user's orbit or skin data. */
export function skinPreviewYaw(yaw: number, flight: number, editing = false): number {
  return editing ? yaw : yaw - .9 * Math.max(0, Math.min(1, flight))
}

export function skinPreviewDistance(distance: number, flight: number, editing = false): number {
  return editing ? distance : distance * (1 + .12 * Math.max(0, Math.min(1, flight)))
}

export function skinPreviewPitch(pitch: number, flight: number, editing = false): number {
  return editing ? pitch : Math.max(-Math.PI * 5 / 12, Math.min(Math.PI * 5 / 12, pitch - .24 * Math.max(0, Math.min(1, flight))))
}

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
  pose(seconds: number, walking: number, yaw: number, stance: Partial<SkinPreviewStance> = {}): void {
    const crouch = Math.max(0, Math.min(1, stance.crouch || 0))
    const fly = Math.max(0, Math.min(1 - crouch, stance.fly || 0))
    this.rotation.set(0, yaw, 0)
    // Joint transforms only: UVs, geometry, skin proportions and textures stay intact.
    this.skin.position.set(0, 24 - 2 * crouch - 8 * fly, 8 * fly)
    this.skin.rotation.set(Math.PI / 2 * fly, 0, 0)
    this.skin.body.position.set(0, -6 + .75 * crouch, crouch ? -1.4 * crouch : 0)
    this.skin.body.rotation.set(.5 * crouch, 0, 0)
    this.skin.head.position.set(0, 0, 1.5 * crouch)
    this.skin.leftArm.position.set(5, -2 + .6 * crouch, .6 * crouch)
    this.skin.rightArm.position.set(-5, -2 + .6 * crouch, .6 * crouch)
    this.skin.leftLeg.position.set(1.9, -12 + 1.5 * crouch, -.1 - 4.3 * crouch)
    this.skin.rightLeg.position.set(-1.9, -12 + 1.5 * crouch, -.1 - 4.3 * crouch)
    const angle = Math.cos(seconds * 4.71) * Math.PI / 4 * walking
    const flightKick = Math.sin(seconds * 3) * .035 * fly
    this.skin.leftArm.rotation.set(angle + .25 * crouch - .12 * fly, 0, Math.PI * (.02 + .02 * fly))
    this.skin.rightArm.rotation.set(-angle + .25 * crouch - .12 * fly, 0, -Math.PI * (.02 + .02 * fly))
    this.skin.leftLeg.rotation.set(-angle - .15 * crouch + flightKick, 0, .015 * fly)
    this.skin.rightLeg.rotation.set(angle - .15 * crouch - flightKick, 0, -.015 * fly)
    this.skin.head.rotation.set(crouch || fly ? -.22 * crouch - .16 * fly : 0, 0, 0)
    this.cape.position.set(0, 24 - 2 * crouch - 6 * fly, -2 - 2 * crouch + 10 * fly)
    this.cape.rotation.set(Math.PI / 18 + .35 * crouch + Math.PI / 2 * fly, Math.PI, 0)
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
