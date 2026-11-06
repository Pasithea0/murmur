import { useState, type CSSProperties } from 'react'
import { useLocation } from 'wouter'
import { MotionConfig } from 'motion/react'
import { ChevronRight, SquarePen } from 'lucide-react'
import { IconButton } from '@/ui/button'
import { cn } from '@/lib/cn'
import { NotFound } from '@/features/chat-screen/not-found'
import { PageBar } from '@/features/agent-page/page-bar'
import { usePageScroll } from '@/features/agent-page/scroll'
import { MemberRow } from '@/features/group/member-row'
import { GroupSheet } from '@/features/group/group-sheet'
import { ConversationList } from '@/features/group/conversation-list'
import {
  deleteConversation,
  deleteGroup,
  renameConversation,
  renameGroup,
  undoDeleteConversation,
  useGroupPage,
} from '@/state/groups'

// A group's conversations: what has been talked about here, newest first.
// Tapping one opens it; the pencil starts a new one; a conversation can be
// renamed or deleted from its row, exactly as an agent's chats can. The
// group's own name, its members and deleting it live in Group info, which the
// card at the top opens.

const HUE = 278

export function GroupChatsScreen({ groupId }: { groupId: string }) {
  const { group, rows, deleted, loaded, missing, running } = useGroupPage(groupId)
  const [, navigate] = useLocation()
  const [sheet, setSheet] = useState(false)
  const { page, title, scrolled, under, onScroll } = usePageScroll<HTMLHeadingElement>(`group:${groupId}`)

  if (missing)
    return (
      <div className="grid h-dvh place-items-center bg-bg">
        <NotFound
          title="This group isn’t here anymore"
          body="It may have been deleted on another device."
          action="Back to chats"
          onAction={() => navigate('/', { replace: true })}
        />
      </div>
    )

  return (
    <MotionConfig reducedMotion="user">
      <div
        ref={page}
        onScroll={onScroll}
        className="hue-scope relative h-dvh overflow-y-auto overscroll-contain bg-bg"
        style={{ '--hue': HUE } as CSSProperties}
      >
        <PageBar
          title={group?.name ?? 'Group'}
          scrolled={scrolled}
          under={under}
          back={{ href: '/', label: 'Back' }}
          trailing={
            <IconButton size="lg" label="New conversation" onClick={() => navigate(`/group/${groupId}/new`)}>
              <SquarePen size={20} strokeWidth={1.85} />
            </IconButton>
          }
        />

        <div className="mx-auto w-full max-w-[40rem] px-5 pt-1 pb-[max(40px,env(safe-area-inset-bottom))]">
          {/* The group itself: its faces, its name, and the way to what it holds. */}
          <button
            type="button"
            onClick={() => setSheet(true)}
            disabled={!group}
            aria-label={group ? `${group.name}, group details` : 'Group'}
            className="pressable -mx-2 mb-6 flex items-center gap-3.5 rounded-2xl p-2 text-left hover:bg-fill-1 disabled:opacity-60"
          >
            {group ? (
              <MemberRow members={group.members} size={52} max={4} />
            ) : (
              <span className="h-[52px] w-24 flex-none rounded-full bg-fill-2" />
            )}
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-0.5">
                <h1
                  ref={title}
                  className="truncate text-large font-semibold tracking-[-0.025em] [overflow-wrap:anywhere]"
                >
                  {group?.name ?? ' '}
                </h1>
                <ChevronRight size={20} strokeWidth={2.25} aria-hidden className="mt-0.5 flex-none text-ink-3" />
              </span>
              <span className={cn('block truncate text-subhead text-ink-2')}>
                {group ? `${group.members.length} agents` : ' '}
              </span>
            </span>
          </button>

          <ConversationList
            group={group}
            rows={rows}
            deleted={deleted}
            running={running}
            pending={!loaded}
            onNew={() => navigate(`/group/${groupId}/new`)}
            onRename={(thread, name) => renameConversation(groupId, thread, name)}
            onDelete={(thread) => deleteConversation(groupId, thread)}
            onRestore={(thread) => undoDeleteConversation(groupId, thread)}
          />
        </div>

        {group && (
          <GroupSheet
            open={sheet}
            onOpenChange={setSheet}
            group={group}
            onRename={(name) => renameGroup(groupId, name)}
            onDelete={async () => {
              await deleteGroup(groupId)
              setSheet(false)
              navigate('/', { replace: true })
            }}
            onOpenMember={(id) => {
              setSheet(false)
              navigate(`/chat/${encodeURIComponent(id)}`)
            }}
          />
        )}
      </div>
    </MotionConfig>
  )
}
