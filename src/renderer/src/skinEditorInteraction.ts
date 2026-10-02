/** A gesture keeps its operation and owner until that initiating button ends. */
export type SkinGesture = { pointerId: number; buttonMask: number; operation: 'draw' | 'rotate' }
export class SkinGestureOwner {
  active: SkinGesture | undefined
  begin(event: Pick<PointerEvent, 'pointerId' | 'pointerType' | 'button' | 'altKey'>, editing: boolean, mode?: 'draw' | 'rotate') {
    if (this.active || ![0, 1].includes(event.button) || event.button === 1 && event.pointerType !== 'mouse') return
    this.active = { pointerId: event.pointerId, buttonMask: event.button === 1 ? 4 : 1, operation: !editing || mode === 'rotate' || event.button === 1 || event.altKey ? 'rotate' : 'draw' }
    return this.active
  }
  owns(pointerId: number) { return this.active?.pointerId === pointerId }
  finish(pointerId?: number) {
    if (!this.active || pointerId !== undefined && !this.owns(pointerId)) return
    const gesture = this.active; this.active = undefined; return gesture
  }
}

export type SkinCloseIntent<Route extends string = string> = { kind: 'editor' | 'window' | 'quit' } | { kind: 'navigate'; destination: Route }
/** Native quit/close requests survive duplicate local close actions until cancelled. */
export function mergeSkinCloseIntent<Route extends string>(current: SkinCloseIntent<Route> | undefined, next: SkinCloseIntent<Route>): SkinCloseIntent<Route> {
  const priority = { editor: 0, navigate: 1, window: 2, quit: 3 }
  return current && priority[current.kind] > priority[next.kind] ? current : next
}
