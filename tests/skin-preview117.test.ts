import test from 'node:test'
import assert from 'node:assert/strict'
import { Box3, Mesh, PerspectiveCamera, Raycaster, Texture, Vector2, Vector3 } from 'three'
import { PreviewPlayer, skinPreviewDistance, skinPreviewPitch, skinPreviewYaw } from '../src/renderer/src/skinModel'
import { resolveSkinPreview } from '../src/renderer/src/skinPreviewSelection'

const skinMatrices = (player: PreviewPlayer) => {
  player.updateMatrixWorld(true)
  const result: number[][] = []
  player.traverse(object => result.push(object.matrixWorld.toArray()))
  return result
}

test('neutral pose preserves all constructor joint positions and the pre-existing idle outward arm tilt', () => {
  for (const variant of ['default', 'slim'] as const) {
    const player = new PreviewPlayer()
    player.skin.modelType = variant
    const objects = [player.skin, player.skin.head, player.skin.body, player.skin.leftArm, player.skin.rightArm, player.skin.leftLeg, player.skin.rightLeg, player.cape]
    const positions = objects.map(object => object.position.toArray())
    const scales = objects.map(object => object.scale.toArray())
    player.pose(.43, 0, 0, { crouch: 1 })
    player.pose(.43, 0, 0, { fly: 1 })
    player.pose(.43, 0, 0)
    assert.deepEqual(objects.map(object => object.position.toArray()), positions)
    assert.deepEqual(objects.map(object => object.scale.toArray()), scales)
    assert.equal(player.skin.leftArm.rotation.z, Math.PI * .02)
    assert.equal(player.skin.rightArm.rotation.z, -Math.PI * .02)
    const legacyIdleAngle = Math.cos(.43 * 4.71) * Math.PI / 4 * 0
    assert.equal(player.skin.leftLeg.rotation.x, -legacyIdleAngle)
    assert.equal(player.skin.rightLeg.rotation.x, legacyIdleAngle)
    player.dispose()
  }
})

test('crouch lowers the character while feet stay on the floor and the torso bends without resizing meshes', () => {
  for (const variant of ['default', 'slim'] as const) {
    const player = new PreviewPlayer()
    player.skin.modelType = variant
    player.skin.setOuterLayerVisible(false)
    player.pose(0, 0, 0)
    const standing = new Box3().setFromObject(player.skin)
    const scale = player.skin.scale.clone()
    player.pose(0, 0, 0, { crouch: 1 })
    const crouched = new Box3().setFromObject(player.skin)
    assert(crouched.max.y < standing.max.y - 1, 'crouching must lower the head')
    assert(Math.abs(crouched.min.y) < 1, 'crouching must keep the feet at ground level')
    assert(player.skin.body.rotation.x > 0 && player.skin.head.rotation.x < 0, 'the face counteracts the torso bend')
    assert(player.skin.scale.equals(scale))
    player.dispose()
  }
})

test('flight lies horizontally, keeps the cape attached, and changes no mesh, UV or texture data', () => {
  const player = new PreviewPlayer(), skin = new Texture(), cape = new Texture()
  player.skin.map = skin; player.setCape(cape)
  const meshes: { mesh: Mesh; uv: number[]; scale: number[] }[] = []
  player.traverse(object => { if (object instanceof Mesh) meshes.push({ mesh: object, uv: Array.from(object.geometry.attributes.uv.array), scale: object.scale.toArray() }) })
  player.pose(1, 0, .5, { fly: 1 }); player.updateMatrixWorld(true)
  const axis = new Vector3(0, 1, 0).transformDirection(player.skin.matrixWorld)
  assert(Math.abs(axis.y) < 1e-12, 'flight must use a horizontal body axis')
  assert(new Box3().setFromObject(player.skin).getSize(new Vector3()).y < 13)
  assert(player.cape.position.distanceTo(player.skin.position) < 3, 'cape top follows the flying shoulder anchor')
  assert.equal(player.skin.map, skin); assert.equal(player.cape.map, cape); assert.equal(player.cape.visible, true)
  for (const { mesh, uv, scale } of meshes) {
    assert.deepEqual(Array.from(mesh.geometry.attributes.uv.array), uv)
    assert.deepEqual(mesh.scale.toArray(), scale)
  }
  player.dispose()
})

test('switching from crouch and flight returns exactly to prior walking, idle and editor-neutral transforms', () => {
  const player = new PreviewPlayer()
  for (const walking of [0, 1]) for (const yaw of [-.7, 2]) {
    player.pose(.43, walking, yaw)
    const expected = skinMatrices(player)
    for (const stance of [{ crouch: 1 }, { fly: 1 }, { crouch: .4, fly: .4 }]) {
      player.pose(1.7, 0, 1, stance)
      player.pose(.43, walking, yaw)
      assert.deepEqual(skinMatrices(player), expected, 'no residual position or rotation after changing pose')
    }
  }
  player.dispose()
})

test('flight presentation reveals the torso and both legs to the real preview camera without replacing manual orbit or editor view', () => {
  const base = -.35
  assert.equal(skinPreviewYaw(base, 0), base)
  assert.equal(skinPreviewYaw(base, 1, true), base, 'editor angles must not receive decorative presentation offsets')
  assert.equal(skinPreviewDistance(48, 0), 48); assert.equal(skinPreviewDistance(48, 1, true), 48)
  assert.equal(skinPreviewPitch(.1, 0), .1); assert.equal(skinPreviewPitch(.1, 1, true), .1)
  assert.equal(skinPreviewYaw(.75, 1) - skinPreviewYaw(base, 1), .75 - base, 'manual rotation must retain its complete delta')
  assert.equal(skinPreviewYaw(base, .5), (skinPreviewYaw(base, 0) + skinPreviewYaw(base, 1)) / 2, 'presentation follows the same smooth stance blend')
  for (const variant of ['default', 'slim'] as const) for (const aspect of [.8, 1.3]) {
    const player = new PreviewPlayer(); player.skin.modelType = variant; player.skin.setOuterLayerVisible(false)
    player.pose(0, 0, skinPreviewYaw(base, 1), { fly: 1 }); player.updateMatrixWorld(true)
    const camera = new PerspectiveCamera(45, aspect, .5, 500)
    const d = skinPreviewDistance(Math.max(20, 10 / aspect) / Math.tan(camera.fov * Math.PI / 360), 1), elevation = skinPreviewPitch(0, 1)
    camera.position.set(0, 16 + Math.sin(elevation) * d, Math.cos(elevation) * d); camera.lookAt(0, 16, 0); camera.updateMatrixWorld(true)
    const objects: Mesh[] = []; player.skin.traverseVisible(object => { if (object instanceof Mesh) objects.push(object) })
    for (const part of [player.skin.body, player.skin.leftLeg, player.skin.rightLeg]) {
      const vertices: Vector3[] = []
      part.innerLayer.traverseVisible(object => {
        if (!(object instanceof Mesh)) return
        const positions = object.geometry.attributes.position
        for (let i = 0; i < positions.count; i++) vertices.push(new Vector3().fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld).project(camera))
      })
      const left = Math.min(...vertices.map(point => point.x)), right = Math.max(...vertices.map(point => point.x))
      const bottom = Math.min(...vertices.map(point => point.y)), top = Math.max(...vertices.map(point => point.y))
      assert(left > -1 && right < 1 && bottom > -1 && top < 1, `torso and both legs must stay entirely inside the preview: ${variant} ${aspect} ${part.name} ${[left, right, bottom, top]}`)
      let exposed = 0
      const ray = new Raycaster()
      for (let x = 0; x < 9; x++) for (let y = 0; y < 9; y++) {
        ray.setFromCamera(new Vector2(left + (right - left) * (x + .5) / 9, bottom + (top - bottom) * (y + .5) / 9), camera)
        let first: any = ray.intersectObjects(objects, false)[0]?.object
        while (first && first !== part && first !== player.skin) first = first.parent
        if (first === part) exposed++
      }
      assert(exposed >= 3, `the real camera must show a visible region of the torso and each leg: ${variant} ${aspect} ${[player.skin.body, player.skin.leftLeg, player.skin.rightLeg].indexOf(part)} ${exposed}`)
    }
    player.dispose()
  }
})

test('saved unused skin previews locally with its own model without changing account, history or active cape', () => {
  const current = Object.freeze({ dataUrl: 'data:current', variant: 'classic' })
  const item = Object.freeze({ id: 'saved', dataUrl: 'data:saved', variant: 'slim' as const, time: 1, name: '未使用皮肤.png' })
  const history = Object.freeze([item])
  const selected = resolveSkinPreview(current, history, 'saved', 'data:cape')
  assert.deepEqual(selected, { source: 'data:saved', variant: 'slim', cape: '', history: item })
  assert.equal(current.dataUrl, 'data:current'); assert.equal(history[0], item)
  assert.deepEqual(resolveSkinPreview(current, history, '', 'data:cape'), { source: 'data:current', variant: 'classic', cape: 'data:cape', history: undefined })
})

test('local saved skin previews without login, and deleting the selected skin safely restores current preview', () => {
  const item = { id: 'local', dataUrl: 'data:local', variant: 'classic' as const, time: 1 }
  assert.equal(resolveSkinPreview(null, [item], 'local', '').source, 'data:local')
  assert.deepEqual(resolveSkinPreview(null, [], 'local', ''), { source: '', variant: 'classic', cape: '', history: undefined })
  assert.deepEqual(resolveSkinPreview({ dataUrl: 'data:current', variant: 'slim' }, [], 'local', 'cape'), { source: 'data:current', variant: 'slim', cape: 'cape', history: undefined })
})
