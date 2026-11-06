import { useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { AnimatePresence, motion, useIsPresent } from 'motion/react'
import { ArrowRight, MoreHorizontal, PencilLine, SquarePen, Trash2 } from 'lucide-react'
import { Grow } from '@/ui/grow'
import { Skeleton } from '@/ui/skeleton'
import { cn } from '@/lib/cn'
import { RowMenu, useLongPress } from './row-menu'
import { Item } from './nested-row'
import type { GroupRow } from './groups'
import { RenameConversationSheet } from '@/features/group/rename-conversation'
import { deleteConversation, renameConversation, useGroupChats } from '@/state/groups'
import type { ConversationRow } from '@shared/groups.ts'

// A group's latest conversations, tucked under its row in the sidebar, exactly
// as an agent's chats are: text only, on the row's name column, so the list
// stays calm. The one you're in holds the highlight, a dot marks the ones said
// in since you read them, and a round running in one says so. Right-click a
// conversation, or its "…", to rename or delete it — the same two things the
// group's own page offers — with "All conversations" under them for the rest.

const SHOWN = 4
const spring = { type: 'spring', duration: 0.34, bounce: 0 } as const

/** The newest conversations, as many as the sidebar has room to show. */
const sidebarConversations = (rows: ConversationRow[]) => rows.slice(0, SHOWN)

export function NestedConversations({
  id,
  group,
  open,
  openThreadId,
}: {
  id: string
  group: GroupRow
  open: boolean
  openThreadId?: string
}) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="conversations"
          id={id}
          data-nested-conversations=""
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0, transition: { ...spring, duration: 0.26 } }}
          transition={spring}
          className="overflow-hidden"
        >
          <List group={group} openThreadId={openThreadId} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function List({ group, openThreadId }: { group: GroupRow; openThreadId?: string }) {
  const { data, isPending } = useGroupChats(group.id)
  const rows = data ? sidebarConversations(data) : []
  const [renaming, setRenaming] = useState<ConversationRow | null>(null)
  // Folding away: out of reach while it goes.
  const leaving = !useIsPresent()
  return (
    // Content (and the row highlights) on the name column: 8px + 10px + a 40px face + 12px.
    <Grow>
      <ul
        className="space-y-px pt-0.5 pb-2 pl-13"
        aria-label={`${group.name}’s recent conversations`}
        data-leaving={leaving || undefined}
        inert={leaving}
      >
        {isPending ? (
          [64, 48, 56].map((w, i) => (
            <li key={i} className="flex h-8 items-center px-2.5">
              <Skeleton className="h-2.5 rounded-full" style={{ width: `${w}%` }} />
            </li>
          ))
        ) : rows.length === 0 ? (
          <li>
            <Item href={`/group/${group.id}/new`} muted>
              <SquarePen size={14} strokeWidth={2} aria-hidden className="flex-none" />
              <span className="truncate">Start a conversation</span>
            </Item>
          </li>
        ) : (
          rows.map((row) => (
            <li key={row.id}>
              <Conversation
                group={group}
                row={row}
                selected={row.id === openThreadId}
                live={group.liveThread === row.id}
                onRename={() => setRenaming(row)}
                onDelete={() => deleteConversation(group.id, row.id)}
              />
            </li>
          ))
        )}
        {!isPending && rows.length > 0 && (
          <li>
            <Item href={`/group/${group.id}`} muted>
              <span className="truncate">All conversations</span>
              <ArrowRight size={13} strokeWidth={2} aria-hidden className="flex-none" />
            </Item>
          </li>
        )}
      </ul>
      <RenameConversationSheet
        faces={{ hues: group.memberHues, seeds: group.memberIds }}
        conversation={renaming}
        onClose={() => setRenaming(null)}
        onRename={(title) => {
          if (renaming) renameConversation(group.id, renaming.id, title)
        }}
      />
    </Grow>
  )
}

// While the "…" shows, the trailing marks step aside for it and the title ends short of it.
const makesWay =
  'transition-opacity [@media(hover:hover)]:group-hover/chat:opacity-0 [@media(hover:hover)]:group-has-[:focus-visible]/chat:opacity-0 [@media(hover:hover)]:group-has-[[data-open]]/chat:opacity-0'
const clearsMore =
  '[@media(hover:hover)]:group-hover/chat:pr-8 [@media(hover:hover)]:group-has-[:focus-visible]/chat:pr-8 [@media(hover:hover)]:group-has-[[data-open]]/chat:pr-8'

function Conversation({
  group,
  row,
  selected,
  live,
  onRename,
  onDelete,
}: {
  group: GroupRow
  row: ConversationRow
  selected: boolean
  /** A round is running in it. */
  live: boolean
  onRename: () => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const press = useLongPress(() => setOpen(true))
  const title = row.title || 'New conversation'
  const menu = [
    { label: 'Rename', icon: <PencilLine size={18} strokeWidth={1.85} />, onSelect: onRename },
    { label: 'Delete', icon: <Trash2 size={18} strokeWidth={1.85} />, onSelect: onDelete, danger: true },
  ]
  return (
    <Popover.Root open={open} onOpenChange={setOpen} modal>
      <Popover.Anchor asChild>
        <div className="group/chat relative">
          <Item
            href={`/group/${group.id}/${encodeURIComponent(row.id)}`}
            selected={selected}
            open={open}
            title={title}
            press={press}
            className={clearsMore}
            nav
          >
            <span
              className={cn(
                'min-w-0 flex-1 truncate',
                row.unread && 'font-medium text-ink',
                live && 'text-shimmer',
              )}
            >
              {title}
              {live && <span className="sr-only">, working</span>}
            </span>
            {/* Trailing, so every title keeps the list's left edge. */}
            <span className={cn('flex flex-none items-center gap-1.5', makesWay)}>
              {row.unread && <span aria-label="New messages" className="size-1.5 flex-none rounded-full bg-accent" />}
            </span>
          </Item>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={`More for “${title}”`}
            aria-haspopup="menu"
            data-open={open || undefined}
            className={cn(
              'pressable absolute top-1/2 right-1 hidden size-6 -translate-y-1/2 place-items-center rounded-full text-ink-3 hover:bg-fill-2 hover:text-ink',
              'opacity-0 transition-opacity duration-150 ease-out group-hover/chat:opacity-100 focus-visible:opacity-100 data-open:opacity-100 [@media(hover:hover)]:grid',
            )}
          >
            <MoreHorizontal size={14} strokeWidth={2} aria-hidden />
          </button>
        </div>
      </Popover.Anchor>
      <RowMenu open={open} name={title} roomy={false} close={() => setOpen(false)} items={menu} />
    </Popover.Root>
  )
}
