import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Check, MoreHorizontal, Trash2 } from 'lucide-react'
import type { Item } from '@/types/database'

const SWIPE_TRIGGER_PX = 80
const SWIPE_MAX_PX = 120
const MOVE_TOLERANCE_PX = 8
const LONG_PRESS_MS = 500

type ItemRowProps = {
  item: Item
  /** Display name for a user id — used for "who added / who checked". */
  nameFor: (userId: string | null) => string | null
  onToggle: (item: Item) => void
  onEdit: (item: Item) => void
  onDelete: (item: Item) => void
}

export function ItemRow({ item, nameFor, onToggle, onEdit, onDelete }: ItemRowProps) {
  const [offset, setOffset] = useState(0)
  const [swiping, setSwiping] = useState(false)
  const start = useRef<{ x: number; y: number } | null>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const gestureHandled = useRef(false)

  function cancelLongPress() {
    if (longPressTimer.current !== null) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return

    // Presses that land on a real control belong to that control. Without this
    // the row's own tap handler fires *as well as* the button's onClick — the
    // checkbox toggles twice and nets out to nothing, and the edit button
    // toggles the item on its way to opening the sheet. Bailing out before
    // setPointerCapture also matters: capturing here can swallow the click.
    if (event.target instanceof Element && event.target.closest('button') !== null) {
      start.current = null
      return
    }

    start.current = { x: event.clientX, y: event.clientY }
    gestureHandled.current = false
    event.currentTarget.setPointerCapture(event.pointerId)

    longPressTimer.current = setTimeout(() => {
      gestureHandled.current = true
      longPressTimer.current = null
      // A press that turns into an edit should feel like something happened.
      if ('vibrate' in navigator) navigator.vibrate?.(10)
      onEdit(item)
    }, LONG_PRESS_MS)
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!start.current) return
    const dx = event.clientX - start.current.x
    const dy = event.clientY - start.current.y

    if (Math.abs(dx) > MOVE_TOLERANCE_PX || Math.abs(dy) > MOVE_TOLERANCE_PX) cancelLongPress()

    // Vertical intent belongs to the scroller, not to us.
    if (Math.abs(dy) > Math.abs(dx)) return
    if (dx >= 0) {
      setOffset(0)
      setSwiping(false)
      return
    }

    setSwiping(true)
    setOffset(Math.max(dx, -SWIPE_MAX_PX))
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    cancelLongPress()
    const origin = start.current
    start.current = null
    // The press started on a button; that button's click handler owns it.
    if (!origin) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    const wasSwiping = swiping
    setSwiping(false)

    if (offset <= -SWIPE_TRIGGER_PX) {
      setOffset(0)
      onDelete(item)
      return
    }
    setOffset(0)

    if (gestureHandled.current || wasSwiping) return

    const dx = Math.abs(event.clientX - origin.x)
    const dy = Math.abs(event.clientY - origin.y)
    if (dx <= MOVE_TOLERANCE_PX && dy <= MOVE_TOLERANCE_PX) onToggle(item)
  }

  function onPointerCancel() {
    cancelLongPress()
    start.current = null
    setSwiping(false)
    setOffset(0)
  }

  const addedBy = nameFor(item.added_by)
  const checkedBy = nameFor(item.checked_by)
  const attribution = item.checked && checkedBy ? `Checked by ${checkedBy}` : addedBy ? `Added by ${addedBy}` : null

  return (
    <li className="relative overflow-hidden">
      {/* Revealed behind the row as it slides away. */}
      <div
        aria-hidden
        className="absolute inset-y-0 right-0 flex w-[120px] items-center justify-center bg-red-600 text-white"
      >
        <Trash2 className="h-5 w-5" aria-hidden />
      </div>

      <div
        role="group"
        className="relative flex touch-pan-y items-center gap-3 bg-white px-3 dark:bg-larder-900"
        style={{
          transform: `translateX(${offset}px)`,
          transition: swiping ? 'none' : 'transform 180ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onToggle(item)
          }}
          aria-pressed={item.checked}
          aria-label={`${item.checked ? 'Uncheck' : 'Check off'} ${item.name}`}
          className="tap -ml-1 shrink-0 rounded-xl"
        >
          <span
            aria-hidden
            className={`flex h-6 w-6 items-center justify-center rounded-full border-2 transition-colors ${
              item.checked
                ? 'border-larder-600 bg-larder-600 text-white dark:border-larder-400 dark:bg-larder-400 dark:text-larder-950'
                : 'border-larder-300 dark:border-larder-600'
            }`}
          >
            {item.checked ? <Check className="h-4 w-4" strokeWidth={3} /> : null}
          </span>
        </button>

        <span className="flex min-h-[48px] min-w-0 flex-1 flex-col justify-center py-2">
          <span className="flex items-baseline gap-2">
            <span
              className={`min-w-0 truncate text-[15px] ${
                item.checked
                  ? 'text-larder-400 line-through dark:text-larder-500'
                  : 'text-larder-950 dark:text-larder-50'
              }`}
            >
              {item.name}
            </span>
            {item.quantity ? (
              <span className="shrink-0 rounded-md bg-larder-100 px-1.5 py-0.5 text-xs font-medium text-larder-700 dark:bg-larder-800 dark:text-larder-300">
                {item.quantity}
              </span>
            ) : null}
          </span>

          {item.note || attribution ? (
            <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-larder-500 dark:text-larder-400">
              {item.note ? <span className="truncate">{item.note}</span> : null}
              {item.note && attribution ? <span aria-hidden>·</span> : null}
              {attribution ? (
                <span className="flex shrink-0 items-center gap-1">
                  <span
                    aria-hidden
                    className="flex h-4 w-4 items-center justify-center rounded-full bg-larder-200 text-[9px] font-bold text-larder-700 dark:bg-larder-700 dark:text-larder-200"
                  >
                    {(item.checked && checkedBy ? checkedBy : (addedBy ?? '?')).charAt(0).toUpperCase()}
                  </span>
                  {attribution}
                </span>
              ) : null}
              {item.source === 'siri' ? (
                <span className="shrink-0 text-larder-400" title="Added by voice">
                  · via Siri
                </span>
              ) : null}
            </span>
          ) : null}
        </span>

        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onEdit(item)
          }}
          aria-label={`Edit ${item.name}`}
          className="tap shrink-0 rounded-xl text-larder-400 hover:text-larder-700 dark:hover:text-larder-200"
        >
          <MoreHorizontal className="h-5 w-5" aria-hidden />
        </button>
      </div>
    </li>
  )
}
