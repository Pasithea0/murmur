import { describe, expect, it } from 'vitest'
import {
  activeThread,
  conversationsIn,
  lastLine,
  liveFromLog,
  mergeConversations,
  threadOf,
  type RoomEvent,
} from './groups.ts'

const now = 1_800_000_000_000
let seq = 0
const event = (kind: string, payload: Record<string, unknown> = {}, ago = 5): RoomEvent => ({
  seq: ++seq,
  event_id: `e${seq}`,
  kind,
  actor: { kind: kind === 'message.user' ? 'user' : 'member', id: String(payload.member_id ?? 'you') },
  payload,
  created_at: (now - ago * 1000) / 1000,
})
const roster = [
  { id: 'm1', name: 'Atlas', handle: 'atlas' },
  { id: 'm2', name: 'Nova', handle: 'nova' },
]

describe('liveFromLog', () => {
  it('is running from your message until Hermes wraps the round up', () => {
    const asked = [event('message.user', { text: 'Thoughts?' }), event('message.member', { member_id: 'm1', text: 'Yes' })]
    expect(liveFromLog(asked, now)).toBe(true)
    expect(liveFromLog([...asked, event('room.activity')], now)).toBe(false)
    expect(liveFromLog([...asked, event('room.stop_requested')], now)).toBe(false)
  })

  it('gives up on a round Hermes would have', () => {
    expect(liveFromLog([event('message.user', { text: 'Hello?' }, 40 * 60)], now)).toBe(false)
    expect(liveFromLog([], now)).toBe(false)
  })
})

describe('lastLine', () => {
  it('names who said the newest thing, with mentions by name', () => {
    const log = [event('message.user', { text: '@atlas plan the trip' }), event('message.member', { member_id: 'm2', text: '**Sure**, @atlas has it' })]
    expect(lastLine(log, roster)).toBe('Nova: Sure, @Atlas has it')
    expect(lastLine(log.slice(0, 1), roster)).toBe('You: @Atlas plan the trip')
  })

  it('skips a reply on its way to being a pass', () => {
    const log = [event('message.member', { member_id: 'm1', text: 'Done.' }), event('message.member', { member_id: 'm2', text: '(pass)' })]
    expect(lastLine(log, roster)).toBe('Atlas: Done.')
    expect(lastLine([], roster)).toBe('')
  })
})

describe('threadOf', () => {
  it('keeps Hermes’s own thread', () => {
    expect(threadOf(event('message.user', { text: 'Hi', thread_id: 'c-abc' }))).toBe('c-abc')
  })

  it('reads messages from before threading — and Murmur’s own main conversation — together', () => {
    expect(threadOf(event('message.user', { text: 'Hi', thread_id: 'main' }))).toBe('main')
    expect(threadOf(event('message.user', { text: 'Hi', thread_id: 'legacy' }))).toBe('main')
    expect(threadOf(event('message.user', { text: 'Hi' }))).toBe('main')
  })
})

describe('conversationsIn', () => {
  const log = [
    event('message.user', { text: 'Plan the trip', thread_id: 'c-one' }, 60),
    event('message.member', { member_id: 'm1', text: 'On it', thread_id: 'c-one' }, 55),
    event('message.user', { text: 'What’s for dinner?' }, 40),
    event('message.member', { member_id: 'm2', text: 'Pasta' }, 35),
    event('message.user', { text: 'Any news?', thread_id: 'c-two' }, 10),
  ]

  it('gathers each thread, newest spoken in first, named for what was first asked', () => {
    const found = conversationsIn(log)
    expect(found.map((c) => c.id)).toEqual(['c-two', 'main', 'c-one'])
    expect(found.map((c) => c.title)).toEqual(['Any news?', 'What’s for dinner?', 'Plan the trip'])
    expect(found.map((c) => c.messages)).toEqual([1, 2, 2])
  })

  it('counts only what was really said — a pass is not a message', () => {
    const passed = [event('message.user', { text: 'Hello', thread_id: 'c-one' }), event('message.member', { member_id: 'm1', text: '(pass)', thread_id: 'c-one' })]
    expect(conversationsIn(passed)[0].messages).toBe(1)
  })

  it('leaves a room with nothing in it empty', () => {
    expect(conversationsIn([])).toEqual([])
  })
})

describe('activeThread', () => {
  it('is the conversation you spoke in last, until Hermes wraps its round up', () => {
    // A member finishing a turn isn't the end of the round; room.activity is.
    const asked = [event('message.user', { text: 'Thoughts?', thread_id: 'c-one' }), event('message.member', { member_id: 'm1', text: 'Yes', thread_id: 'c-one' }), event('turn.settled', { member_id: 'm1', thread_id: 'c-one' })]
    expect(activeThread(asked, now)).toBe('c-one')
    expect(activeThread([...asked, event('room.activity', { thread_id: 'c-one' })], now)).toBeUndefined()
  })

  it('is the round you started most recently, not an older one still open', () => {
    const log = [
      event('message.user', { text: 'Hi', thread_id: 'c-one' }, 60),
      event('message.user', { text: 'And this?', thread_id: 'c-two' }, 40),
      event('message.member', { member_id: 'm2', text: 'Sure', thread_id: 'c-two' }, 35),
    ]
    expect(activeThread(log, now)).toBe('c-two')
  })

  it('knows a round wrapped up in one conversation doesn’t answer for another', () => {
    const log = [
      event('message.user', { text: 'Hi', thread_id: 'c-one' }, 60),
      event('message.user', { text: 'Here?', thread_id: 'c-two' }, 40),
      event('room.activity', { thread_id: 'c-two' }, 35),
    ]
    expect(activeThread(log, now)).toBe('c-one')
  })

  it('is nobody’s once the room is stopped or disbanded', () => {
    expect(activeThread([event('message.user', { text: 'Hi', thread_id: 'c-one' }), event('room.stop_requested')], now)).toBeUndefined()
    expect(activeThread([event('message.user', { text: 'Hi', thread_id: 'c-one' }), event('room.disbanded')], now)).toBeUndefined()
  })

  it('is none when the last word is long past', () => {
    expect(activeThread([event('message.user', { text: 'Hi', thread_id: 'c-one' }, 40 * 60)], now)).toBeUndefined()
  })
})

describe('mergeConversations', () => {
  it('keeps a remembered conversation, and the open one, above the log’s own', () => {
    const fromLog = conversationsIn([event('message.user', { text: 'Hi', thread_id: 'c-one' })])
    const listed = mergeConversations(fromLog, ['c-old'], 'c-abc')
    expect(listed.map((c) => c.id)).toEqual(['c-old', 'c-abc', 'c-one'])
    expect(listed[1]).toMatchObject({ title: '', messages: 0 })
  })

  it('never lists a conversation twice', () => {
    const fromLog = conversationsIn([event('message.user', { text: 'Hi', thread_id: 'c-one' })])
    expect(mergeConversations(fromLog, ['c-one', 'c-old', 'c-old'], 'c-one').map((c) => c.id)).toEqual(['c-old', 'c-one'])
  })
})
