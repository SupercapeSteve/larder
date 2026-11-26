import { useEffect, useRef, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useKeyboardInset } from '@/hooks/useKeyboardInset'

type AppShellProps = {
  /** Sticky header content — sits below the status bar in standalone mode. */
  header?: ReactNode
  /** Pinned footer, e.g. the add-item bar. Already clears the home indicator. */
  footer?: ReactNode
  /** Wider ceiling for multi-column screens on tablets, laptops and ultra-wides. */
  wide?: boolean
  children: ReactNode
}

/**
 * Universal page frame across every viewport ratio — from ultra-narrow watches
 * and folded cover screens (200–280px) to short landscape phones, square
 * foldables, tablets, and 21:9 / 32:9 desktop monitors.
 *
 * Safe-area handling lives here so no screen has to remember it. Without the
 * bottom inset the add-item bar sits underneath the iOS home indicator; without
 * `safe-x` landscape notches clip the left/right edges.
 */
export function AppShell({ header, footer, wide = false, children }: AppShellProps) {
  const location = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  const keyboardInset = useKeyboardInset()

  const widthClass = wide
    ? 'mx-auto w-full max-w-2xl px-3 min-[380px]:px-4 sm:px-6 lg:max-w-5xl lg:px-8 xl:max-w-6xl 2xl:max-w-7xl'
    : 'mx-auto w-full max-w-2xl px-3 min-[380px]:px-4 sm:px-6 lg:max-w-4xl lg:px-8'

  // Land at the top of each screen. Without this the scroll position carries
  // over from the previous route and a new page opens half way down.
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0, behavior: 'auto' })
  }, [location.pathname])

  return (
    <div
      className="flex h-full min-h-0 w-full flex-col bg-larder-50 dark:bg-larder-950"
      // Shrink by exactly the keyboard's overlap so the footer rides above it.
      style={keyboardInset > 0 ? { paddingBottom: keyboardInset } : undefined}
    >
      {header ? (
        <header className="shell-header safe-top safe-x sticky top-0 z-20 shrink-0 border-b border-larder-200 bg-larder-50/85 backdrop-blur-xl dark:border-larder-800 dark:bg-larder-950/85">
          <div className={widthClass}>{header}</div>
        </header>
      ) : null}

      <main id="main" tabIndex={-1} ref={mainRef} className="scroll-y safe-x min-h-0 flex-1">
        {/* Keyed on the path so each screen fades in rather than snapping. */}
        <div key={location.pathname} className={`animate-page ${widthClass}`}>
          {children}
        </div>
      </main>

      {footer ? (
        <footer
          className="safe-x sticky bottom-0 z-20 shrink-0 border-t border-larder-200 bg-larder-50/95 backdrop-blur-xl dark:border-larder-800 dark:bg-larder-950/95"
          // The home indicator is irrelevant while the keyboard is up, and
          // keeping its inset would float the bar above the keys.
          style={{ paddingBottom: keyboardInset > 0 ? 0 : 'var(--sa-bottom)' }}
        >
          <div className={`shell-footer-inner ${widthClass}`}>{footer}</div>
        </footer>
      ) : null}
    </div>
  )
}
