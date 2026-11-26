import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Check, Sparkles } from 'lucide-react'
import { AppShell } from '@/components/AppShell'
import { CURRENT_VERSION, LAST_SEEN_VERSION_KEY, PATCH_NOTES } from '@/lib/changelog'
import { writeLocal } from '@/lib/storage'
import { useEffect } from 'react'

export default function PatchNotes() {
  const navigate = useNavigate()

  useEffect(() => {
    writeLocal(LAST_SEEN_VERSION_KEY, CURRENT_VERSION)
  }, [])

  return (
    <AppShell
      header={
        <div className="shell-header-inner flex min-h-tap items-center gap-1 py-2.5 sm:py-3">
          <button
            type="button"
            onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/account'))}
            className="tap -ml-2 rounded-xl text-larder-700 dark:text-larder-300"
            aria-label="Back"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </button>
          <h1 className="truncate text-lg font-semibold tracking-tight">Patch notes</h1>
        </div>
      }
    >
      <div className="space-y-4 py-4 pb-12">
        {PATCH_NOTES.map((release, index) => {
          const isLatest = index === 0
          return (
            <article key={release.version} className="card p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      isLatest
                        ? 'bg-larder-600 text-white dark:bg-larder-500 dark:text-larder-950'
                        : 'bg-larder-100 text-larder-700 dark:bg-larder-800 dark:text-larder-300'
                    }`}
                  >
                    {isLatest ? <Sparkles className="h-3 w-3" aria-hidden /> : null}
                    v{release.version}
                  </span>
                  {isLatest ? (
                    <span className="text-xs font-medium text-larder-600 dark:text-larder-400">
                      Current release
                    </span>
                  ) : null}
                </div>
                <span className="text-xs text-larder-500">{release.date}</span>
              </div>

              <h2 className="mt-2.5 text-base font-semibold text-larder-950 dark:text-larder-50">
                {release.title}
              </h2>
              <p className="mt-1 text-xs text-larder-600 dark:text-larder-400">{release.summary}</p>

              <ul className="mt-3.5 space-y-2 border-t border-larder-100 pt-3.5 text-sm text-larder-800 dark:border-larder-800 dark:text-larder-200">
                {release.highlights.map((item) => (
                  <li key={item} className="flex items-start gap-2.5">
                    <Check
                      className="mt-1 h-4 w-4 shrink-0 text-larder-600 dark:text-larder-400"
                      strokeWidth={2.5}
                      aria-hidden
                    />
                    <span className="leading-snug">{item}</span>
                  </li>
                ))}
              </ul>
            </article>
          )
        })}
      </div>
    </AppShell>
  )
}
