import type { ReactNode } from 'react'
import { ShoppingBasket } from 'lucide-react'

export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="safe-top safe-bottom safe-x flex min-h-full flex-col justify-center bg-larder-50 px-4 py-10 dark:bg-larder-950">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-larder-600 text-white shadow-sm dark:bg-larder-500">
            <ShoppingBasket className="h-7 w-7" aria-hidden />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-larder-950 dark:text-larder-50">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-1.5 text-sm text-larder-600 dark:text-larder-400">{subtitle}</p>
          ) : null}
        </div>

        <div className="card p-5">{children}</div>

        {footer ? <div className="mt-5 text-center text-sm">{footer}</div> : null}
      </div>
    </div>
  )
}
