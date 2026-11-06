// Reading a group's log the same way in the app (src/state/groups.ts) and on
// the server (server/watch.ts): whether a round is running, and the last
// thing said. Each group is a Hermes "hosted room" whose log is a list of events.

import { toNames, type Mentionable } from './mentions.ts'

type Actor = { kind: string; id: string; profile?: string; display_name?: string }

export type RoomEvent = {
  seq: number
  event_id: string
  kind: string
  actor: Actor
  payload: Record<string, unknown>
  created_at: number
}

/** "Atlas & Nova", "Atlas, Nova & Sol", "Atlas, Nova & 2 more": a group without a name of its own. */
export function joinNames(names: string[]) {
  if (names.length <= 1) return names.join('')
  if (names.length > 3) return `${names.slice(0, 2).join(', ')} & ${names.length - 2} more`
  return `${names.slice(0, -1).join(', ')} & ${names.at(-1)}`
}

/** What ends a round: Hermes wrapped it up, it was stopped, or the room is gone. */
export const TERMINAL = new Set(['room.activity', 'room.stop_requested', 'room.disbanded'])

/** The member an event is from. */
export const memberOf = (ev: RoomEvent) => String(ev.payload.member_id ?? ev.actor.id ?? '')

/** Hide a reply while it's still on its way to being "(pass)". */
export function visibleText(text: string) {
  const t = text.trim()
  if (!t) return ''
  if ('(pass)'.startsWith(t.toLowerCase()) || /^\(pass\)\.?$/i.test(t)) return ''
  return t
}

/** Markdown as one line of words. */
export const plain = (md: string) =>
  md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>~|]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()

/** A round is running if the latest message hasn't been wrapped up yet. */
export function liveFromLog(events: RoomEvent[], now = Date.now()) {
  const last = events.at(-1)
  // Hermes gives up on a turn after ~30 minutes; anything older is stale.
  if (!last || now - last.created_at * 1000 > 35 * 60_000) return false
  for (let i = events.length - 1; i >= 0; i--) {
    if (TERMINAL.has(events[i].kind)) return false
    if (events[i].kind === 'message.user') return true
  }
  return false
}

/** "Atlas: Sounds good" or "You: …", from the newest thing said; empty for a brand-new group. */
export function lastLine(events: RoomEvent[], roster: Mentionable[]) {
  const said = events.findLast(
    (e) => e.kind === 'message.user' || (e.kind === 'message.member' && visibleText(String(e.payload.text ?? ''))),
  )
  if (!said) return ''
  const who = said.kind === 'message.user' ? 'You' : (roster.find((m) => m.id === memberOf(said))?.name ?? 'Someone')
  return `${who}: ${plain(toNames(String(said.payload.text ?? ''), roster))}`.slice(0, 140)
}

// ── Conversations ───────────────────────────────────────────────────────────
// Hermes runs one room, and any number of conversations inside it ("threads" in
// its words): every event carries the thread it belongs to, the room keeps a
// read watermark and a slice of the transcript per thread and member, and a
// message that opens a new thread starts a fresh discussion with the same
// members. Murmur shows a group's threads as its conversations.

/** Murmur's own conversation: the thread its rooms are made with, unless a newer one is started. */
export const MAIN_THREAD = 'main'
/** Hermes's sentinel for room messages that predate threading. */
const LEGACY_THREAD = 'legacy'

/** The conversation an event belongs to. Untagged and legacy messages read as the main one. */
export function threadOf(event: { payload?: Record<string, unknown> }): string {
  const value = event.payload?.thread_id
  return typeof value === 'string' && value && value !== LEGACY_THREAD ? value : MAIN_THREAD
}

export type Conversation = {
  id: string
  /** The first thing asked in it, as one line of words; empty until you say something. */
  title: string
  /** When it opened and when it was last added to, in ms. */
  firstAt: number
  lastAt: number
  /** How much has been said in it, by you and the agents. */
  messages: number
}

/** Every conversation a room's log holds, most recently spoken in first. */
export function conversationsIn(events: RoomEvent[]): Conversation[] {
  const found = new Map<string, Conversation>()
  for (const event of events) {
    const id = threadOf(event)
    const at = event.created_at * 1000
    let conversation = found.get(id)
    if (!conversation) found.set(id, (conversation = { id, title: '', firstAt: at, lastAt: at, messages: 0 }))
    conversation.lastAt = Math.max(conversation.lastAt, at)
    if (event.kind === 'message.member' ? visibleText(String(event.payload.text ?? '')) : event.kind === 'message.user') {
      conversation.messages++
    }
    if (!conversation.title && event.kind === 'message.user') {
      conversation.title = plain(String(event.payload.text ?? '')).slice(0, 140)
    }
  }
  return [...found.values()].sort((a, b) => b.lastAt - a.lastAt)
}

/**
 * The log's conversations, plus any a device knows about that the log no longer
 * shows (a long conversation scrolls out of the window it is read through).
 * Ones with nothing in the log are new, and read from the top.
 */
export function mergeConversations(fromLog: Conversation[], known: string[], open: string): Conversation[] {
  const seen = new Set(fromLog.map((c) => c.id))
  const rest: Conversation[] = []
  for (const thread of [...known, open]) {
    if (!thread || seen.has(thread)) continue
    seen.add(thread)
    rest.push({ id: thread, title: '', firstAt: 0, lastAt: 0, messages: 0 })
  }
  return [...rest, ...fromLog]
}

export type ConversationRow = Conversation & {
  /** What a device calls it: its own name for it, else the first line asked. */
  title: string
  /** An agent said something in it since that device last looked. */
  unread: boolean
}

/**
 * A room's conversations as a list shows them: newest first, the ones this
 * device deleted left out, each named and marked read as that device has it. A
 * conversation is one once something has been said in it (the log) or this
 * device remembers saying so — a conversation merely being started is neither.
 */
export function conversationRows(
  fromLog: Conversation[],
  {
    known = [],
    open,
    deleted = [],
    names = {},
    seen = {},
    events = [],
  }: {
    /** Ids a device remembers that the log no longer shows. */
    known?: string[]
    /** The conversation that device is showing. */
    open?: string
    /** Conversations that device has deleted. */
    deleted?: string[]
    /** Names that device gave them. */
    names?: Record<string, string>
    /** How far into each that device has read. */
    seen?: Record<string, number>
    /** The room's log, for unread marks. */
    events?: RoomEvent[]
  } = {},
): ConversationRow[] {
  const gone = new Set(deleted)
  const real = new Set([...fromLog.map((c) => c.id), ...known])
  return mergeConversations(fromLog, known, open ?? '')
    .filter((conversation) => real.has(conversation.id) && !gone.has(conversation.id))
    .map((conversation) => {
      const last = events.findLast((e) => e.kind === 'message.member' && threadOf(e) === conversation.id)?.seq ?? 0
      return {
        ...conversation,
        title: names[conversation.id] || conversation.title,
        unread: last > (seen[conversation.id] ?? 0),
      }
    })
}

/**
 * The conversation the room is working in right now, if a round is running
 * there: the newest thing you said whose thread hasn't been wrapped up since.
 * A Stop or a disband speaks for the whole room, so nothing is running then.
 */
export function activeThread(events: RoomEvent[], now = Date.now()): string | undefined {
  const last = events.at(-1)
  if (!last || now - last.created_at * 1000 > 35 * 60_000) return undefined
  const ended = new Set<string>()
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (event.kind === 'room.stop_requested' || event.kind === 'room.disbanded') return undefined
    if (TERMINAL.has(event.kind)) ended.add(threadOf(event))
    else if (event.kind === 'message.user' && !ended.has(threadOf(event))) return threadOf(event)
  }
  return undefined
}
