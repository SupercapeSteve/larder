import type { ReactNode } from 'react'

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
  return (
    <div className="flex h-full flex-col bg-larder-50 dark:bg-larder-950">
      {header ? (
        <header className="safe-top safe-x sticky top-0 z-20 border-b border-larder-200 bg-larder-50/90 backdrop-blur-md dark:border-larder-800 dark:bg-larder-950/90">
          <div className="mx-auto w-full max-w-2xl px-4">{header}</div>
        </header>
      ) : null}

      <main className="safe-x min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-4">{children}</div>
      </main>

      {footer ? (
        <footer className="safe-bottom safe-x sticky bottom-0 z-20 border-t border-larder-200 bg-larder-50/95 backdrop-blur-md dark:border-larder-800 dark:bg-larder-950/95">
          <div className="mx-auto w-full max-w-2xl px-4">{footer}</div>
        </footer>
      ) : null}
    </div>
  )
}
