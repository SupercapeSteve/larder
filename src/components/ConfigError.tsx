import { AlertTriangle } from 'lucide-react'
import type { MissingEnvError } from '@/lib/env'

/**
 * Shown instead of the app when the build has no Supabase credentials. The
 * alternative — and the historical behaviour of this stack — is a blank white
 * page with a cryptic error in the console nobody opens on a phone.
 */
export function ConfigError({ error }: { error: MissingEnvError }) {
  return (
    <div className="safe-top safe-bottom safe-x flex min-h-full flex-col items-center justify-center bg-larder-50 px-6 py-10 dark:bg-larder-950">
      <div className="w-full max-w-lg">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
          <AlertTriangle className="h-6 w-6" aria-hidden />
        </div>
        <h1 className="text-lg font-semibold text-larder-950 dark:text-larder-50">
          Larder is not configured
        </h1>
        <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-xl bg-white p-4 text-xs leading-relaxed text-larder-700 dark:bg-larder-900 dark:text-larder-300">
          {error.message}
        </pre>
      </div>
    </div>
  )
}
