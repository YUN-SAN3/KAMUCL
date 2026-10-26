import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { registerCommunitySearchIpc } from '../src/main/core/communitySearchIpc'
import { IPC, IPC_EVENT, type CommunityQuery, type CommunitySearchSnapshot } from '../src/shared/types'

const query: CommunityQuery = { keyword: '无尽', kind: 'mod', source: 'all', limit: 20, offset: 0 }
function setup() {
  const handlers = new Map<string, (...args: any[]) => any>(), calls: any[] = [], updates = new Map<number, (s: CommunitySearchSnapshot) => void>()
  const service = {
    startCommunitySearch(owner: number, requestId: string, q: CommunityQuery, notify: (s: CommunitySearchSnapshot) => void) {
      calls.push({ mode: 'start', owner, requestId, query: q }); updates.set(owner, notify)
      return { requestId, revision: 1, query: q, items: [], total: 0, offset: 0, limit: 20, phase: 'initial', discoveryHasMore: false, totalKind: 'confirmed' } as CommunitySearchSnapshot
    },
    continueCommunitySearch(owner: number, requestId: string, continuation: any) { calls.push({ mode: 'continue', owner, requestId, continuation }); return { requestId } as CommunitySearchSnapshot },
    cancelCommunitySearch(owner: number, requestId?: string) { calls.push({ mode: 'cancel', owner, requestId }); return true }
  }
  registerCommunitySearchIpc({ handle: (channel, callback) => { handlers.set(channel, callback); return undefined } } as any, service)
  const sender = (id: number) => {
    const emitter = new EventEmitter() as any; let closed = false
    emitter.id = id; emitter.messages = []; emitter.isDestroyed = () => closed
    emitter.send = (...args: any[]) => emitter.messages.push(args)
    emitter.close = () => { closed = true; emitter.emit('destroyed'); Object.defineProperty(emitter, 'id', { get: () => { throw Error('Owner already destroyed') } }) }
    return emitter
  }
  return { handlers, calls, updates, sender }
}
test('progress IPC emits only to its original renderer and captures an owner before destruction', () => {
  const rt = setup(), first = rt.sender(10), second = rt.sender(20)
  const a = rt.handlers.get(IPC.communitySearchStart)!({ sender: first }, 'first', query)
  rt.handlers.get(IPC.communitySearchStart)!({ sender: second }, 'second', query)
  rt.updates.get(10)!({ ...a, revision: 2 }); assert.equal(first.messages.length, 1); assert.equal(second.messages.length, 0)
  assert.equal(first.messages[0][0], IPC_EVENT.communitySearchUpdate)
  first.close(); rt.updates.get(10)!({ ...a, revision: 3 }); assert.equal(first.messages.length, 1)
  assert.deepEqual(rt.calls.at(-1), { mode: 'cancel', owner: 10, requestId: undefined })
})
test('a renderer receives one lifecycle hook across searches and continues/cancels with its own sender ID', () => {
  const rt = setup(), first = rt.sender(10)
  rt.handlers.get(IPC.communitySearchStart)!({ sender: first }, 'one', query)
  rt.handlers.get(IPC.communitySearchStart)!({ sender: first }, 'two', query)
  assert.equal(first.listenerCount('destroyed'), 1)
  const continuation = { mode: 'discover', cursor: 'cursor' }
  rt.handlers.get(IPC.communitySearchContinue)!({ sender: first }, 'two', continuation)
  rt.handlers.get(IPC.communitySearchCancel)!({ sender: first }, 'two')
  assert.deepEqual(rt.calls.slice(-2), [{ mode: 'continue', owner: 10, requestId: 'two', continuation }, { mode: 'cancel', owner: 10, requestId: 'two' }])
  assert.throws(() => rt.handlers.get(IPC.communitySearchCancel)!({ sender: first }, undefined), /标识无效/)
  assert.equal(rt.calls.at(-1).requestId, 'two', 'An absent request ID cannot cancel all renderer sessions')
})
