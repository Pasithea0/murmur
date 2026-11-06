import { useState } from 'react'
import { Button } from '@/ui/button'
import { TextField } from '@/ui/field'
import { BuddyStack } from '@/ui/buddy'
import { Sheet } from '@/ui/sheet'

// Give a conversation a name of your own, from its row's menu. Hermes names a
// conversation after what was first asked and has no name of its own for one,
// so this is this device's: clearing it goes back to the first line.

/** A group's members, as its faces. */
export type Faces = { hues: number[]; seeds: string[] }

/** Hermes's longest title, which a conversation's is too. */
const MAX = 100

type Props = {
  /** The faces over the field: the group's members. */
  faces: Faces
  /** The conversation being renamed; null when the sheet is closed. */
  conversation: { id: string; title: string } | null
  onClose: () => void
  onRename: (title: string) => void
}

export function RenameConversationSheet({ faces, conversation, onClose, onRename }: Props) {
  // Kept while the sheet closes, so it doesn't empty as it goes.
  const [shown, setShown] = useState(conversation)
  const [name, setName] = useState(conversation?.title ?? '')
  if (conversation && conversation !== shown) {
    setShown(conversation)
    setName(conversation.title)
  }

  const save = () => {
    const title = name.trim().replace(/\s+/g, ' ')
    if (!shown) return
    if (title !== shown.title) onRename(title)
    onClose()
  }

  return (
    <Sheet open={!!conversation} onOpenChange={(open) => !open && onClose()} title="Rename conversation" width={380}>
      <form
        className="flex flex-col items-center pt-1"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <BuddyStack hues={faces.hues} seeds={faces.seeds} size={56} />
        <div className="mt-6 w-full">
          <TextField
            value={name}
            onChange={(e) => setName(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            maxLength={MAX}
            autoComplete="off"
            enterKeyHint="done"
            aria-label="Conversation name"
            placeholder="What was first asked"
            autoFocus
            className="text-center"
          />
        </div>
        <p className="mt-2 min-h-5 w-full text-center text-footnote text-pretty text-ink-3">
          Only this device. Hermes names a conversation after what was first asked.
        </p>
        <div className="mt-3 w-full">
          <Button type="submit" variant="accent" size="lg">
            Save
          </Button>
        </div>
      </form>
    </Sheet>
  )
}
