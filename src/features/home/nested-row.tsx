import { Link } from 'wouter'
import { motion } from 'motion/react'
import { cn } from '@/lib/cn'
import type { useLongPress } from './row-menu'

// One row of a sidebar list tucked under a roster row: an agent's chats, a
// group's conversations. Text only, on the name column, so the list stays calm,
// and the sidebar's one selection glides between them.

export function Item({
  href,
  selected,
  open,
  muted,
  title,
  nav,
  press,
  className,
  children,
}: {
  href: string
  selected?: boolean
  /** Its menu is open. */
  open?: boolean
  muted?: boolean
  title?: string
  /** A chat ⌥↑/⌥↓ can land on. */
  nav?: boolean
  press?: ReturnType<typeof useLongPress>
  className?: string
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      title={title}
      data-nav={nav ? 'chat' : undefined}
      aria-current={selected ? 'page' : undefined}
      {...press}
      className={cn(
        'relative isolate flex h-8 items-center gap-1.5 rounded-md px-2.5 text-footnote select-none [-webkit-touch-callout:none]',
        'transition-colors duration-150 active:bg-fill-2',
        selected ? 'font-medium text-ink' : cn(muted ? 'text-ink-3' : 'text-ink-2', 'hover:bg-fill-1 hover:text-ink'),
        open && !selected && 'bg-fill-1 text-ink',
        className,
      )}
    >
      {/* The sidebar's one selection, gliding here from the agent's or group's row. */}
      {selected && (
        <motion.span
          layoutId="roster-selection"
          aria-hidden
          className="absolute inset-0 -z-10 rounded-md bg-accent-soft"
          transition={{ type: 'spring', duration: 0.38, bounce: 0.12 }}
        />
      )}
      {children}
    </Link>
  )
}
