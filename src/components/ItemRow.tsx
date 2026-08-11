import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Check, MoreHorizontal, Trash2 } from 'lucide-react'
import { useHaptic, usePreferences } from '@/hooks/usePreferences'
import { Avatar } from '@/components/Avatar'
import type { Item } from '@/types/database'

const SWIPE_TRIGGER_PX = 96
const SWIPE_SOFT_MAX_PX = 132
const MOVE_TOLERANCE_PX = 8
const LONG_PRESS_MS = 480
/** iOS owns the left screen edge for its back gesture — don't fight it. */
const EDGE_GUARD_PX = 24

export type RowMember = {
  displayName: string
  avatarEmoji: string | null
  avatarColor: string | null
}

type ItemRowProps = {
  item: Item
  /** Resolves a user id to who they are — used for "who added / who checked". */
  memberFor: (userId: string | null) => RowMember | null
  onToggle: (item: Item) => void
  onEdit: (item: Item) => void
  onDelete: (item: Item) => void
}

/** Rubber-band resistance past the trigger point, so the row never runs away. */
function damped(dx: number): number {
  const distance = Math.abs(dx)
  if (distance <= SWIPE_TRIGGER_PX) return dx
  const overshoot = distance - SWIPE_TRIGGER_PX
  const resisted = SWIPE_TRIGGER_PX + overshoot * 0.35
  return -Math.min(resisted, SWIPE_SOFT_MAX_PX)
}

export function ItemRow({ item, memberFor, onToggle, onEdit, onDelete }: ItemRowProps) {
  const { preferences } = usePreferences()
  const haptic = useHaptic()

  const [offset, setOffset] = useState(0)
  const [swiping, setSwiping] = useState(false)
  const [pressed, setPressed] = useState(false)
  const [justChecked, setJustChecked] = useState(false)

  const start = useRef<{ x: number; y: number } | null>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const gestureHandled = useRef(false)
  const armed = useRef(false)
  const wasChecked = useRef(item.checked)

  // A small flourish when an item gets ticked — it confirms the tap landed
  // even though the row is about to move to another section.
  useEffect(() => {
    if (item.checked && !wasChecked.current) {
      setJustChecked(true)
      const timer = setTimeout(() => setJustChecked(false), 300)
      wasChecked.current = item.checked
      return () => clearTimeout(timer)
    }
    wasChecked.current = item.checked
  }, [item.checked])

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
    armed.current = false
    setPressed(true)
    event.currentTarget.setPointerCapture(event.pointerId)

    longPressTimer.current = setTimeout(() => {
      gestureHandled.current = true
      longPressTimer.current = null
      setPressed(false)
      haptic(12)
      onEdit(item)
    }, LONG_PRESS_MS)
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!start.current) return
    const dx = event.clientX - start.current.x
    const dy = event.clientY - start.current.y

    if (Math.abs(dx) > MOVE_TOLERANCE_PX || Math.abs(dy) > MOVE_TOLERANCE_PX) {
      cancelLongPress()
      setPressed(false)
    }

    // Vertical intent belongs to the scroller, not to us.
    if (Math.abs(dy) > Math.abs(dx)) return
    // Swipes beginning at the screen edge are the system back gesture.
    if (start.current.x < EDGE_GUARD_PX) return
    if (dx >= 0) {
      setOffset(0)
      setSwiping(false)
      return
    }

    setSwiping(true)
    const next = damped(dx)
    // One tick the moment the row is far enough to delete, so you know before
    // you let go rather than after.
    if (!armed.current && Math.abs(next) >= SWIPE_TRIGGER_PX) {
      armed.current = true
      haptic(10)
    } else if (armed.current && Math.abs(next) < SWIPE_TRIGGER_PX) {
      armed.current = false
    }
    setOffset(next)
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    cancelLongPress()
    setPressed(false)
    const origin = start.current
    start.current = null
    // The press started on a button; that button's click handler owns it.
    if (!origin) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    const wasSwiping = swiping
    setSwiping(false)

    if (Math.abs(offset) >= SWIPE_TRIGGER_PX) {
      // Let it finish sliding out rather than vanishing mid-gesture.
      setOffset(-SWIPE_SOFT_MAX_PX)
      onDelete(item)
      return
    }
    setOffset(0)

    if (gestureHandled.current || wasSwiping) return

    const dx = Math.abs(event.clientX - origin.x)
    const dy = Math.abs(event.clientY - origin.y)
    if (dx <= MOVE_TOLERANCE_PX && dy <= MOVE_TOLERANCE_PX) {
      haptic(8)
      onToggle(item)
    }
  }

  function onPointerCancel() {
    cancelLongPress()
    start.current = null
    setPressed(false)
    setSwiping(false)
    setOffset(0)
  }

  const addedBy = memberFor(item.added_by)
  const checkedBy = memberFor(item.checked_by)
  // Who to show: whoever last acted on it.
  const actor = item.checked && checkedBy ? checkedBy : addedBy
  const actorId = item.checked && checkedBy ? item.checked_by : item.added_by
  const attribution = !preferences.showAttribution
    ? null
    : item.checked && checkedBy
      ? `Checked by ${checkedBy.displayName}`
      : addedBy
        ? `Added by ${addedBy.displayName}`
        : null

  const progress = Math.min(1, Math.abs(offset) / SWIPE_TRIGGER_PX)
  const willDelete = Math.abs(offset) >= SWIPE_TRIGGER_PX

  return (
    <li className="animate-row-in relative overflow-hidden">
      {/* Revealed behind the row as it slides away. */}
      <div
        aria-hidden
        className="absolute inset-y-0 right-0 flex items-center justify-center transition-colors"
        style={{
          width: SWIPE_SOFT_MAX_PX,
          backgroundColor: willDelete ? '#dc2626' : '#b91c1c',
          opacity: progress,
        }}
      >
        <Trash2
          className="h-5 w-5 text-white transition-transform"
          style={{ transform: `scale(${0.8 + progress * 0.35})` }}
          aria-hidden
        />
      </div>

      <div
        role="group"
        className={`pressable relative flex touch-pan-y items-center gap-3 ${
          pressed ? 'bg-larder-100 dark:bg-larder-800' : 'bg-white dark:bg-larder-900'
        }`}
        style={{
          paddingLeft: 12,
          paddingRight: 12,
          transform: `translateX(${offset}px)`,
          transition: swiping ? 'none' : 'transform 260ms cubic-bezier(0.16, 1, 0.3, 1)',
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
            haptic(8)
            onToggle(item)
          }}
          aria-pressed={item.checked}
          aria-label={`${item.checked ? 'Uncheck' : 'Check off'} ${item.name}`}
          className="tap -ml-1 shrink-0 rounded-xl"
        >
          <span
            aria-hidden
            className={`flex h-[26px] w-[26px] items-center justify-center rounded-full border-2 ${
              justChecked ? 'animate-pop' : ''
            } ${
              item.checked
                ? 'border-larder-600 bg-larder-600 text-white dark:border-larder-400 dark:bg-larder-400 dark:text-larder-950'
                : 'border-larder-300 dark:border-larder-600'
            }`}
            style={{ transition: 'background-color 160ms ease, border-color 160ms ease' }}
          >
            <Check
              className="h-4 w-4"
              strokeWidth={3}
              style={{
                opacity: item.checked ? 1 : 0,
                transform: item.checked ? 'scale(1)' : 'scale(0.6)',
                transition: 'opacity 140ms ease, transform 160ms cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            />
          </span>
        </button>

        <span className="flex min-h-[52px] min-w-0 flex-1 flex-col justify-center py-2">
          <span className="flex items-baseline gap-2">
            <span
              className="min-w-0 truncate text-[15px]"
              style={{
                color: item.checked ? undefined : undefined,
                transition: 'opacity 160ms ease',
                opacity: item.checked ? 0.45 : 1,
                textDecoration: item.checked ? 'line-through' : 'none',
              }}
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
                  <Avatar
                    userId={actorId}
                    displayName={actor?.displayName ?? null}
                    emoji={actor?.avatarEmoji ?? null}
                    color={actor?.avatarColor ?? null}
                    size="xs"
                  />
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
          className="tap shrink-0 rounded-xl text-larder-400"
        >
          <MoreHorizontal className="h-5 w-5" aria-hidden />
        </button>
      </div>
    </li>
  )
}
