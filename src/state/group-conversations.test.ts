import { describe, expect, it, vi } from 'vitest'

// A group holds as many conversations as you like, and this device files them:
// which one a room shows, what you call it, which you've read, and which you're
// done with. (What the list then draws is shared/groups.test.ts.)

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

const {
  deleteConversation,
  deletedConversations,
  draftConversation,
  openConversation,
  openThread,
  renameConversation,
  sendToGroup,
  undoDeleteConversation,
  useGroupLive,
} = await import('./groups')

const ROOM = 'murmur-room-1'
const sent = () =>
  calls.filter((c) => c.method === 'groups.send').at(-1)!.params.payload as { thread_id: string; text: string }
const live = () => useGroupLive.getState().rooms[ROOM]

describe('a group’s conversations', () => {
  it('starts a room on its main one', () => {
    expect(openThread('murmur-untouched')).toBe('main')
  })

  it('gives a conversation being started an id Hermes takes, and files nothing yet', () => {
    const thread = draftConversation()
    expect(thread).not.toBe('main')
    // Hermes reads a thread id off the wire as an identifier: letters, digits, a few safe marks.
    expect(thread).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/)
    // Nothing has been said in it, so the room knows nothing of it.
    expect(live()).toBeUndefined()
  })

  it('files the conversation the first word is said in, and opens it', async () => {
    const thread = draftConversation()
    await sendToGroup(ROOM, 'Plan the trip', thread)
    expect(sent()).toMatchObject({ thread_id: thread, text: 'Plan the trip' })
    expect(openThread(ROOM)).toBe(thread)
    expect(live().threads).toContain(thread)
    // And it waits on screen in that conversation.
    expect(live().outgoing.at(-1)).toMatchObject({ thread, text: 'Plan the trip' })
  })

  it('keeps the others, and says in the one you go back to', async () => {
    openConversation(ROOM, 'main')
    await sendToGroup(ROOM, 'And dinner?')
    expect(sent()).toMatchObject({ thread_id: 'main' })
    expect(live().outgoing.at(-1)).toMatchObject({ thread: 'main' })
    expect(live().threads).toHaveLength(1)
  })

  it('deletes a conversation here, and brings it back', () => {
    const thread = live().threads[0]
    deleteConversation(ROOM, thread)
    expect(deletedConversations(ROOM)).toEqual([thread])
    expect(live().threads).not.toContain(thread)
    undoDeleteConversation(ROOM, thread)
    expect(deletedConversations(ROOM)).toEqual([])
  })

  it('goes back to the main conversation when the one on screen is deleted', () => {
    const thread = draftConversation()
    openConversation(ROOM, thread)
    expect(openThread(ROOM)).toBe(thread)
    deleteConversation(ROOM, thread)
    expect(openThread(ROOM)).toBe('main')
  })

  it('names a conversation, and hands it back to what was first asked', () => {
    const thread = live().threads[0]
    renameConversation(ROOM, thread, '  Trip  planning ')
    expect(live().names[thread]).toBe('Trip planning')
    renameConversation(ROOM, thread, '   ')
    expect(live().names[thread]).toBe('')
  })

  it('remembers all of it between visits', () => {
    expect([...kept.values()].join()).toContain(ROOM)
  })
})
