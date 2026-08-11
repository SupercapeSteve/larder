import { useEffect, useRef, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useKeyboardInset } from '@/hooks/useKeyboardInset'

type AppShellProps = {
  /** Sticky header content — sits below the status bar in standalone mode. */
  header?: ReactNode
  /** Pinned footer, e.g. the add-item bar. Already clears the home indicator. */
  footer?: ReactNode
  children: ReactNode
}

/**
 * Mobile-first page frame. Designed at 390px; desktop is the same layout with a
 * max width, not a different design.
 *
 * Safe-area handling lives here so no screen has to remember it. Without the
 * bottom inset the add-item bar sits underneath the iOS home indicator and is
 * physically unusable in standalone mode.
 */
export function AppShell({ header, footer, children }: AppShellProps) {
  const location = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  const keyboardInset = useKeyboardInset()

  // Land at the top of each screen. Without this the scroll position carries
  // over from the previous route and a new page opens half way down.
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0, behavior: 'auto' })
  }, [location.pathname])

  return (
    <div
      className="flex h-full flex-col bg-larder-50 dark:bg-larder-950"
      // Shrink by exactly the keyboard's overlap so the footer rides above it.
      style={keyboardInset > 0 ? { paddingBottom: keyboardInset } : undefined}
    >
      {header ? (
        <header className="safe-top safe-x sticky top-0 z-20 border-b border-larder-200 bg-larder-50/85 backdrop-blur-xl dark:border-larder-800 dark:bg-larder-950/85">
          <div className="mx-auto w-full max-w-2xl px-4">{header}</div>
        </header>
      ) : null}

      <main id="main" tabIndex={-1} ref={mainRef} className="scroll-y safe-x min-h-0 flex-1">
        {/* Keyed on the path so each screen fades in rather than snapping. */}
        <div key={location.pathname} className="animate-page mx-auto w-full max-w-2xl px-4">
          {children}
        </div>
      </main>

      {footer ? (
        <footer
          className="safe-x sticky bottom-0 z-20 border-t border-larder-200 bg-larder-50/95 backdrop-blur-xl dark:border-larder-800 dark:bg-larder-950/95"
          // The home indicator is irrelevant while the keyboard is up, and
          // keeping its inset would float the bar above the keys.
          style={{ paddingBottom: keyboardInset > 0 ? 0 : 'var(--sa-bottom)' }}
        >
          <div className="mx-auto w-full max-w-2xl px-4">{footer}</div>
        </footer>
      ) : null}
    </div>
  )
}
