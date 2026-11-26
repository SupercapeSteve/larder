import type { ReactNode } from 'react'
import { ArrowLeft, ShoppingBasket } from 'lucide-react'

export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
  onBack,
  backLabel = 'Back',
}: {
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
  /** Renders a back control. Omit on screens with genuinely nowhere to go. */
  onBack?: () => void
  backLabel?: string
}) {
  return (
    // `scroll-y` + `my-auto` on the inner column instead of `justify-center` on
    // the parent: when a short landscape viewport is shorter than the form,
    // `justify-center` overflows upward past scrollTop=0 and clips the heading.
    // `my-auto` centres when space allows and scrolls from the top when it doesn't.
    <div className="scroll-y safe-top safe-bottom safe-x flex h-full w-full flex-col bg-larder-50 px-3 py-5 min-[380px]:px-4 sm:py-10 dark:bg-larder-950">
      <div className="mx-auto my-auto w-full max-w-sm">
        {onBack ? (
          <div className="mb-2">
            <button
              type="button"
              onClick={onBack}
              className="tap -ml-2 gap-1 rounded-xl pl-2 pr-3 text-sm font-medium text-larder-700 hover:bg-larder-200/60 dark:text-larder-300 dark:hover:bg-larder-800/60"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              {backLabel}
            </button>
          </div>
        ) : null}

        <div className="mb-5 flex flex-col items-center text-center sm:mb-8">
          <div className="mb-2.5 flex h-12 w-12 items-center justify-center rounded-2xl bg-larder-600 text-white shadow-sm sm:mb-3 sm:h-14 sm:w-14 dark:bg-larder-500">
            <ShoppingBasket className="h-6 w-6 sm:h-7 sm:w-7" aria-hidden />
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-larder-950 sm:text-2xl dark:text-larder-50">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-1 text-sm text-larder-600 dark:text-larder-400">{subtitle}</p>
          ) : null}
        </div>

        <div className="card p-4 min-[380px]:p-5">{children}</div>

        {footer ? <div className="mt-4 text-center text-sm sm:mt-5">{footer}</div> : null}
      </div>
    </div>
  )
}
