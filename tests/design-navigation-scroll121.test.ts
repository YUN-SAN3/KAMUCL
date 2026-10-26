import test from 'node:test'
import assert from 'node:assert/strict'
import { captureDesignNavigationScroll, restoreDesignNavigationScroll } from '../src/renderer/src/designNavigationScroll'

function navigation(options: { height?: number; scale?: number; itemTop?: number; itemHeight?: number; connected?: boolean } = {}) {
  const height = options.height ?? 300, scale = options.scale ?? 1
  let scroll = 128, itemTop = options.itemTop ?? 370, focusCalls = 0
  const itemHeight = options.itemHeight ?? 48
  const active = {
    getClientRects: () => [1], closest: () => null, focus: () => { focusCalls++ },
    getBoundingClientRect: () => { const top = 100 + (1 + itemTop - scroll) * scale; return { top, bottom: top + itemHeight * scale, height: itemHeight * scale } }
  }
  const nav = {
    isConnected: options.connected ?? true, scrollLeft: 7, offsetHeight: height, clientHeight: height - 2, clientTop: 1,
    get scrollTop() { return scroll }, set scrollTop(value: number) { scroll = Math.max(0, Math.min(600 - height, value)) },
    querySelector: (selector: string) => { assert.equal(selector, '[aria-current="page"]'); return active },
    getBoundingClientRect: () => ({ top: 100, height: height * scale })
  }
  return { nav: nav as unknown as HTMLElement, active, focusCalls: () => focusCalls, setCurrentTop: (value: number) => { itemTop = value } }
}

test('editor exit restores the real pre-Teleport nav scroll after its preview viewport changed the range', () => {
  const fixture = navigation(), snapshot = captureDesignNavigationScroll(fixture.nav)
  fixture.nav.scrollTop = 44; fixture.nav.scrollLeft = 0
  restoreDesignNavigationScroll(snapshot)
  assert.equal(fixture.nav.scrollTop, 128); assert.equal(fixture.nav.scrollLeft, 7)
  assert.equal(fixture.focusCalls(), 0)
})

test('preview navigation reveals the new current item with minimal local scrolling instead of restoring it outside the clip', () => {
  const fixture = navigation(), snapshot = captureDesignNavigationScroll(fixture.nav)
  fixture.setCurrentTop(0)
  restoreDesignNavigationScroll(snapshot)
  assert.equal(fixture.nav.scrollTop, 0); assert.equal(fixture.focusCalls(), 0)
  const short = navigation({ height: 210 }), shortSnapshot = captureDesignNavigationScroll(short.nav)
  restoreDesignNavigationScroll(shortSnapshot)
  assert.equal(short.nav.scrollTop, 210)
  assert.equal(short.active.getBoundingClientRect().bottom, 309)
})

test('clipped items use actual ancestor scale and border/client viewport; a disconnected node is untouched', () => {
  const fixture = navigation({ height: 210, scale: .575403 }), snapshot = captureDesignNavigationScroll(fixture.nav)
  restoreDesignNavigationScroll(snapshot)
  assert(Math.abs(fixture.nav.scrollTop - 210) < .00001)
  assert.equal(fixture.focusCalls(), 0)
  const disconnected = navigation({ connected: false }), saved = captureDesignNavigationScroll(disconnected.nav)
  disconnected.nav.scrollTop = 44
  restoreDesignNavigationScroll(saved)
  assert.equal(disconnected.nav.scrollTop, 44)
  restoreDesignNavigationScroll(undefined)
})
