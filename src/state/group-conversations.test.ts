import { describe, expect, it, vi } from 'vitest'

// A group holds as many conversations as you like. This is the store's side of
// it: which one a room shows, and which one what you say goes to.

const calls: { method: string; params: Record<string, unknown> }[] = []
vi.mock('@/hermes/rest', () => ({ api: { get: async () => ({ profiles: [] }) }, HermesError: class extends Error {} }))
vi.mock('@/hermes/gateway', () => ({
  gateway: { onEvent: () => {}, onRequest: () => {}, onState: () => {} },
  rpc: async (method: string, params: Record<string, unknown>) => {
    calls.push({ method, params })
    return method === 'groups.send' ? { event: { event_id: 'e-sent' } } : {}
  },
  useConnection: Object.assign(() => undefined, { getState: () => ({ state: 'open' }) }),
  whenOpen: async () => {},
}))
vi.stubGlobal('document', { cookie: '', addEventListener: () => {}, visibilityState: 'visible' })
vi.stubGlobal('window', { addEventListener: () => {}, setTimeout })
vi.stubGlobal('addEventListener', () => {})
vi.stubGlobal('removeEventListener', () => {})

const kept = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => kept.get(key) ?? null,
  setItem: (key: string, value: string) => void kept.set(key, value),
  removeItem: (key: string) => void kept.delete(key),
})

const { groupConversations, newConversation, openConversation, openThread, sendToGroup, useGroupLive } = await import(
  './groups'
)

const ROOM = 'murmur-room-1'
const said = () => calls.filter((c) => c.method === 'groups.send').at(-1)!.params.payload as { thread_id: string; text: string }

describe('a group’s conversations', () => {
  it('starts a room on its main one', () => {
    expect(openThread('murmur-untouched')).toBe('main')
  })

  it('starts a new one without touching the group, and shows it', () => {
    const thread = newConversation(ROOM)
    expect(thread).not.toBe('main')
    expect(openThread(ROOM)).toBe(thread)
    // Hermes reads a thread id off the wire as an identifier: letters, digits, a few safe marks.
    expect(thread).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/)
    expect(groupConversations(ROOM).map((c) => c.id)).toEqual([thread])
  })

  it('sends what you say to the conversation you are in', async () => {
    const thread = openThread(ROOM)
    await sendToGroup(ROOM, 'Plan the trip')
    expect(said()).toMatchObject({ thread_id: thread, text: 'Plan the trip' })
    // And it waits on screen in that conversation, not the others.
    expect(useGroupLive.getState().rooms[ROOM].outgoing.at(-1)).toMatchObject({ thread, text: 'Plan the trip' })
  })

  it('keeps the older ones, and says in the one you go back to', async () => {
    openConversation(ROOM, 'main')
    expect(openThread(ROOM)).toBe('main')
    await sendToGroup(ROOM, 'And what’s for dinner?')
    expect(said()).toMatchObject({ thread_id: 'main' })
    expect(useGroupLive.getState().rooms[ROOM].outgoing.at(-1)).toMatchObject({ thread: 'main' })
    expect(groupConversations(ROOM)).toHaveLength(2)
  })

  it('remembers which conversation a room shows, and which it has', () => {
    // A fresh visit to the store: what's on disk decides.
    expect(openThread('murmur-untouched')).toBe('main')
    const stored = [...kept.values()].join()
    expect(stored).toContain(ROOM)
  })
})
