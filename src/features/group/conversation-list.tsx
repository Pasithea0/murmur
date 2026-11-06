import { useEffect, useMemo, useRef, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { AnimatePresence, motion } from 'motion/react'
import { Link } from 'wouter'
import { MoreHorizontal, PencilLine, Trash2, type LucideIcon } from 'lucide-react'
import { Sheet } from '@/ui/sheet'
import { Button } from '@/ui/button'
import { SwipeAction, useSwipe, type Side, type SwipeOption } from '@/ui/swipe'
import { Skeleton } from '@/ui/skeleton'
import { cn } from '@/lib/cn'
import { useMedia } from '@/lib/use-media'
import { shortTime } from '@/features/home/time'
import { RowMenu, useLongPress, type MenuPlace } from '@/features/home/row-menu'
import { SearchField } from '@/features/search/search-field'
import type { ConversationRow } from '@shared/groups.ts'
import type { Group } from '@/state/groups'
import { RenameConversationSheet } from './rename-conversation'

// A group's conversations, as the group's own page lists them: most recently
// spoken in first, each with the first thing asked, when it last moved and how
// much has been said. Swipe left on one to delete it; touch and hold (or
// right-click, or its "…") for Rename and Delete too. Deleted conversations
// wait under Hidden, and can be brought back from there.

const SEARCH_FROM = 8

type Props = {
  /** Undefined until the group has loaded: nothing is listed before then. */
  group?: Group
  rows: ConversationRow[]
  /** Conversations deleted on this device, newest first. */
  deleted: ConversationRow[]
  /** The conversation a round is running in, if one is. */
  running?: string
  pending: boolean
  /** Start one: the pencil's job, and the empty list's button. */
  onNew: () => void
  onRename: (thread: string, title: string) => void
  onDelete: (thread: string) => void
  onRestore: (thread: string) => void
}

export function ConversationList({ group, rows, deleted, running, pending, onNew, onRename, onDelete, onRestore }: Props) {
  const [query, setQuery] = useState('')
  const [revealed, setRevealed] = useState<{ id: string; side: Side } | null>(null)
  const [renaming, setRenaming] = useState<ConversationRow | null>(null)
  const [hidden, setHidden] = useState(false)
  const touch = useMedia('(pointer: coarse)')

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? rows.filter((row) => row.title.toLowerCase().includes(q)) : rows
  }, [rows, query])

  // A swiped-open row closes when the list scrolls, as it would anywhere.
  useEffect(() => {
    if (!revealed) return
    const close = () => setRevealed(null)
    document.addEventListener('scroll', close, { capture: true, passive: true, once: true })
    return () => document.removeEventListener('scroll', close, { capture: true })
  }, [revealed])

  const options = (row: ConversationRow): { menu: Option[]; trailing: SwipeOption } => {
    const remove: Option = { label: 'Delete', icon: Trash2, run: () => onDelete(row.id), danger: true }
    return {
      menu: [{ label: 'Rename', icon: PencilLine, run: () => setRenaming(row) }, remove],
      trailing: { ...remove, tone: 'danger', removes: true },
    }
  }

  return (
    <section aria-labelledby="group-conversations">
      <h2 id="group-conversations" className="mb-2 flex items-baseline justify-between px-4 text-footnote font-medium text-ink-2">
        Conversations
        {!!rows.length && <span className="tabular-nums text-ink-3">{rows.length}</span>}
      </h2>
      {rows.length > SEARCH_FROM && (
        <SearchField
          value={query}
          onValueChange={setQuery}
          placeholder="Search this group’s conversations"
          className="mb-3"
          onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
        />
      )}
      {pending ? (
        <div role="status" className="list-group overflow-hidden rounded-xl bg-fill-1">
          <span className="sr-only">Loading conversations</span>
          {[58, 74, 46].map((w, i) => (
            <div key={i} className="py-2.5 pl-4">
              <span className="flex h-6 items-center">
                <Skeleton className="h-3.5 rounded-full" style={{ width: `${w}%` }} />
              </span>
              <span className="flex h-4.5 items-center">
                <Skeleton className="h-2.5 w-20 rounded-full" />
              </span>
            </div>
          ))}
        </div>
      ) : !rows.length ? (
        <div className="rounded-xl bg-fill-1 px-4 py-6 text-center">
          <p className="text-subhead text-ink-3">{deleted.length ? 'Every conversation is hidden.' : 'No conversations yet.'}</p>
          <button type="button" onClick={onNew} className="pressable mt-1 text-subhead font-medium text-accent">
            Start one
          </button>
        </div>
      ) : !shown.length ? (
        <p className="rounded-xl bg-fill-1 px-4 py-6 text-center text-subhead text-ink-3">
          No conversations match “{query.trim()}”.
        </p>
      ) : (
        <ul
          className="list-group animate-fade overflow-hidden rounded-xl bg-fill-1"
          // With a row swiped open, a tap anywhere else in the list just closes it.
          onClickCapture={(e) => {
            if (!revealed || (e.target as Element).closest('[data-swipe-action]')) return
            e.preventDefault()
            e.stopPropagation()
            setRevealed(null)
          }}
        >
          <AnimatePresence initial={false}>
            {shown.map((row) => (
              <Row
                key={row.id}
                group={group}
                row={row}
                working={row.id === running}
                options={options(row)}
                revealed={revealed?.id === row.id ? revealed.side : null}
                onReveal={(side) => setRevealed(side ? { id: row.id, side } : null)}
              />
            ))}
          </AnimatePresence>
        </ul>
      )}
      {touch && rows.length > 1 && !query && (
        <p className="mt-2 px-4 text-footnote text-ink-3">Swipe left on a conversation to delete it.</p>
      )}
      {!!deleted.length && !query && <HiddenRow count={deleted.length} onOpen={() => setHidden(true)} />}

      <HiddenSheet group={group} rows={deleted} open={hidden} onOpenChange={setHidden} onRestore={onRestore} />
      <RenameConversationSheet
        faces={{ hues: (group?.members ?? []).map((m) => m.hue), seeds: (group?.members ?? []).map((m) => m.id) }}
        conversation={renaming}
        onClose={() => setRenaming(null)}
        onRename={(title) => onRename(renaming!.id, title)}
      />
    </section>
  )
}

// ── What you can do to a conversation ───────────────────────────────────────

type Option = { label: string; icon: LucideIcon; run: () => void; danger?: boolean }

function Row({
  group,
  row,
  working,
  options,
  revealed,
  onReveal,
}: {
  group?: Group
  row: ConversationRow
  working: boolean
  options: { menu: Option[]; trailing: SwipeOption }
  revealed: Side | null
  onReveal: (side: Side | null) => void
}) {
  const { menu, trailing } = options
  const [open, setOpen] = useState(false)
  // Hung under the row from a hold, under the "…" from it, at the pointer from a right-click.
  const [place, setPlace] = useState<MenuPlace>('row')
  const line = useRef<HTMLLIElement>(null)
  const anchor = useRef<{ getBoundingClientRect: () => DOMRect }>(undefined)
  const openMenu = (at: 'row' | HTMLElement | { x: number; y: number }) => {
    const rect =
      at === 'row'
        ? () => line.current!.getBoundingClientRect()
        : at instanceof HTMLElement
          ? () => at.getBoundingClientRect()
          : () => new DOMRect(at.x, at.y, 0, 0)
    anchor.current = { getBoundingClientRect: rect }
    setPlace(at === 'row' ? 'row' : at instanceof HTMLElement ? 'button' : 'point')
    setOpen(true)
  }
  const press = useLongPress((at) => openMenu(at ?? 'row'))
  const { row: swipeRow, x, armed, dragged, run, drag } = useSwipe<HTMLLIElement>({ trailing, revealed, onReveal })
  const title = row.title || 'New conversation'

  return (
    <Popover.Root open={open} onOpenChange={setOpen} modal>
      <Popover.Anchor virtualRef={anchor as React.RefObject<{ getBoundingClientRect: () => DOMRect }>} />
      <motion.li
        ref={swipeRow}
        layout
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, height: 0 }}
        transition={{ type: 'spring', stiffness: 420, damping: 40 }}
        className="group relative overflow-hidden"
      >
        {/* Above the sliding row, inset to the text like every grouped list. */}
        <span aria-hidden className="pointer-events-none absolute top-0 right-0 left-4 z-10 h-[0.5px] bg-line-strong group-first:hidden" />
        <SwipeAction side="trailing" action={trailing} x={x} armed={armed === 'trailing'} shown={revealed === 'trailing'} onPress={() => run('trailing')} />
        <motion.div
          {...drag}
          className={cn(
            'relative flex items-center bg-elevated [background-image:linear-gradient(var(--fill-1),var(--fill-1))]',
            // One fill for the whole row, its "…" included, under its contents.
            'before:pointer-events-none before:absolute before:inset-0 before:transition-colors before:duration-150',
            'hover:before:bg-fill-1 has-[a:active]:before:bg-fill-2',
            open && 'before:bg-fill-2 hover:before:bg-fill-2',
          )}
        >
          <Link
            href={`/group/${encodeURIComponent(group?.id ?? '')}/${encodeURIComponent(row.id)}`}
            draggable={false}
            {...press}
            onPointerDown={(e) => {
              dragged.current = false
              press.onPointerDown(e)
            }}
            onClick={(e) => {
              press.onClick(e)
              // A swipe, or a tap on a row showing its action, never opens the conversation.
              if (dragged.current || revealed) {
                e.preventDefault()
                if (revealed && !dragged.current) onReveal(null)
              }
              dragged.current = false
            }}
            className="relative flex min-h-15 min-w-0 flex-1 items-center gap-3 py-2.5 pr-2 pl-4 text-left select-none [-webkit-touch-callout:none] focus-visible:-outline-offset-2"
          >
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span
                  title={title}
                  className={cn('min-w-0 flex-1 truncate text-body', row.unread && 'font-semibold', working && 'text-shimmer')}
                >
                  {title}
                  {working && <span className="sr-only">, working</span>}
                </span>
                {row.unread && <span aria-label="New messages" className="size-2 flex-none self-center rounded-full bg-accent" />}
              </span>
              <span className="flex min-w-0 items-center gap-1 text-footnote text-ink-3">
                {working ? (
                  <span className="flex-none font-medium text-accent">Working…</span>
                ) : (
                  <>
                    <span className="flex-none">{row.lastAt ? shortTime(row.lastAt) : 'Just now'}</span>
                    {!!row.messages && (
                      <span className="min-w-0 truncate">
                        · {row.messages} {row.messages === 1 ? 'message' : 'messages'}
                      </span>
                    )}
                  </>
                )}
              </span>
            </span>
          </Link>
          <button
            type="button"
            onClick={(e) => openMenu(e.currentTarget)}
            aria-label={`More for “${title}”`}
            aria-haspopup="menu"
            data-open={open || undefined}
            className={cn(
              'pressable relative mr-2 hidden size-9 flex-none items-center justify-center rounded-full text-ink-3 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-fill-2 hover:text-ink focus-visible:opacity-100 data-open:opacity-100 [@media(hover:hover)]:flex',
              revealed && 'invisible',
            )}
          >
            <MoreHorizontal size={18} strokeWidth={2} aria-hidden />
          </button>
        </motion.div>
      </motion.li>
      <RowMenu
        open={open}
        name={title}
        roomy
        place={place}
        close={() => setOpen(false)}
        items={menu.map((o) => ({ label: o.label, icon: <o.icon size={18} strokeWidth={1.85} />, onSelect: o.run, danger: o.danger }))}
      />
    </Popover.Root>
  )
}

/** The way into Hidden, after the conversations. */
function HiddenRow({ count, onOpen }: { count: number; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      className="mt-3 flex min-h-12 w-full items-center gap-3 rounded-xl bg-fill-1 px-4 text-left transition-colors select-none hover:bg-fill-2 focus-visible:-outline-offset-2 active:bg-fill-3"
    >
      <Trash2 size={18} strokeWidth={1.85} aria-hidden className="flex-none text-ink-3" />
      <span className="min-w-0 flex-1 truncate text-body">Hidden</span>
      <span className="flex-none text-subhead text-ink-3 tabular-nums">{count}</span>
    </button>
  )
}

/** Conversations deleted here: bring one back, or leave them be. */
function HiddenSheet({
  group,
  rows,
  open,
  onOpenChange,
  onRestore,
}: {
  group?: Group
  rows: ConversationRow[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onRestore: (thread: string) => void
}) {
  const many = (group?.members.length ?? 1) > 1
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Hidden" width={420}>
      <div className="pb-2">
        {rows.map((row) => (
          <div key={row.id} className="flex min-h-13 items-center gap-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body">{row.title || 'Conversation'}</span>
              <span className="block text-footnote text-ink-3">
                {row.messages ? `${row.messages} ${row.messages === 1 ? 'message' : 'messages'}` : 'Nothing said in it'}
              </span>
            </span>
            <Button
              variant="secondary"
              onClick={() => onRestore(row.id)}
            >
              Bring back
            </Button>
          </div>
        ))}
        <p className="mt-2 text-footnote text-pretty text-ink-3">
          Hidden here only. Hermes keeps every word in the group’s log, and {many ? 'its agents' : 'its agent'} still{' '}
          {many ? 'remember' : 'remembers'} them. Bring one back and it is where it was.
        </p>
      </div>
    </Sheet>
  )
}
