import { describe, expect, it } from 'vitest'
import {
  activeThread,
  conversationRows,
  conversationsIn,
  lastLine,
  liveFromLog,
  mergeConversations,
  queuedThreads,
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

  it('is the round you started first, not the one you spoke in last', () => {
    // Hermes runs a room's conversations one at a time, oldest first, so a
    // conversation started while another is mid-round waits its turn.
    const log = [
      event('message.user', { text: 'Hi', thread_id: 'c-one' }, 60),
      event('message.user', { text: 'And this?', thread_id: 'c-two' }, 40),
      event('message.member', { member_id: 'm2', text: 'Sure', thread_id: 'c-two' }, 35),
    ]
    expect(activeThread(log, now)).toBe('c-one')
    // Both are waiting: c-two's round hasn't been wrapped up either.
    expect(queuedThreads(log, now)).toEqual(['c-one', 'c-two'])
  })

  it('hands over to the next conversation once a round is wrapped up', () => {
    const first = event('message.user', { text: 'Hi', thread_id: 'c-one' }, 60)
    const log = [
      first,
      event('message.user', { text: 'And this?', thread_id: 'c-two' }, 40),
      event('room.activity', { thread_id: 'c-one', discussion_event_id: first.event_id }, 30),
    ]
    expect(activeThread(log, now)).toBe('c-two')
  })

  it('queues every conversation waiting its turn, oldest first', () => {
    const log = [
      event('message.user', { text: 'One', thread_id: 'c-one' }, 90),
      event('message.user', { text: 'Two', thread_id: 'c-two' }, 60),
      event('message.user', { text: 'Three', thread_id: 'c-three' }, 30),
    ]
    expect(queuedThreads(log, now)).toEqual(['c-one', 'c-two', 'c-three'])
    // Only the last thing said in a conversation is the round that runs for it,
    // so saying it again moves that conversation to the back of the queue.
    expect(queuedThreads([...log, event('message.user', { text: 'Two again', thread_id: 'c-two' }, 20)], now))
      .toEqual(['c-one', 'c-three', 'c-two'])
  })

  it('lets a message said after a Stop start a round', () => {
    const log = [
      event('message.user', { text: 'Hi', thread_id: 'c-one' }, 60),
      event('room.stop_requested', {}, 50),
      event('message.user', { text: 'Again', thread_id: 'c-two' }, 40),
    ]
    expect(activeThread(log, now)).toBe('c-two')
    expect(queuedThreads(log, now)).toEqual(['c-two'])
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

describe('conversationRows', () => {
  const log = [
    event('message.user', { text: 'Plan the trip', thread_id: 'c-one' }, 60),
    event('message.member', { member_id: 'm1', text: 'On it', thread_id: 'c-one' }, 55),
    event('message.user', { text: 'What’s for dinner?' }, 30),
    event('message.member', { member_id: 'm2', text: 'Pasta' }, 25),
  ]
  const conversations = conversationsIn(log)
  // Their seqs are what a device's read marks are compared against.
  const one = { asked: log[0], reply: log[1] }
  const dinner = { asked: log[2], reply: log[3] }

  it('leaves out the ones this device deleted, and keeps the rest newest first', () => {
    const rows = conversationRows(conversations, { deleted: ['main'] })
    expect(rows.map((row) => row.id)).toEqual(['c-one'])
  })

  it('calls a conversation what this device named it, else what was first asked', () => {
    const rows = conversationRows(conversations, { names: { 'c-one': 'Trip' } })
    // Most recently spoken in first: dinner (main) moved last.
    expect(rows.map((row) => row.title)).toEqual(['What’s for dinner?', 'Trip'])
  })

  it('marks a conversation unread until this device has read that far', () => {
    // Read up to the newest thing in each: nothing to catch up on.
    const read = { 'c-one': one.reply.seq, main: dinner.reply.seq }
    expect(conversationRows(conversations, { seen: read, events: log }).every((row) => !row.unread)).toBe(true)
    // Read up to the message before the agents answered: the reply is unseen.
    const behind = { 'c-one': one.asked.seq }
    expect(conversationRows(conversations, { seen: behind, events: log }).find((r) => r.id === 'c-one')?.unread).toBe(true)
    // Never read at all: an agent's reply alone counts as news.
    expect(conversationRows(conversations, { events: log }).find((r) => r.id === 'c-one')?.unread).toBe(true)
  })

  it('still lists a conversation the log has scrolled past', () => {
    expect(conversationRows([], { known: ['c-old'], open: 'c-old' }).map((row) => row.id)).toEqual(['c-old'])
  })

  it('leaves out a conversation merely being started, before anything is said in it', () => {
    expect(conversationRows(conversations, { open: 'c-being-started' }).map((row) => row.id)).toEqual(['main', 'c-one'])
  })
})
