import { Link } from 'react-router-dom'
import { ShoppingBasket } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="safe-top safe-bottom safe-x flex min-h-full flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-larder-100 dark:bg-larder-900">
        <ShoppingBasket className="h-7 w-7 text-larder-500" aria-hidden />
      </div>
      <h1 className="text-lg font-semibold text-larder-950 dark:text-larder-50">
        Nothing on this shelf
      </h1>
      <p className="mt-1.5 max-w-xs text-sm text-larder-600 dark:text-larder-400">
        That page doesn't exist.
      </p>
      <Link to="/" className="btn-primary mt-6">
        Back to the list
      </Link>
    </div>
  )
}
