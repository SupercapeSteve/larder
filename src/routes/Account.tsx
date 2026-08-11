import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, LogOut, Mail, User } from 'lucide-react'
import { AppShell } from '@/components/AppShell'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useAuth, useProfile } from '@/hooks/useAuth'
import { signOut } from '@/lib/auth'

export default function Account() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { data: profile } = useProfile()
  const [confirmSignOut, setConfirmSignOut] = useState(false)

  return (
    <AppShell
      header={
        <div className="flex min-h-tap items-center gap-1 py-3">
          <Link
            to="/"
            className="tap -ml-2 rounded-xl text-larder-700 dark:text-larder-300"
            aria-label="Back"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </Link>
          <h1 className="text-lg font-semibold tracking-tight">Account</h1>
        </div>
      }
    >
      <div className="space-y-6 py-4">
        <section className="card divide-y divide-larder-200 dark:divide-larder-800">
          <div className="flex items-center gap-3 px-4 py-4">
            <User className="h-5 w-5 shrink-0 text-larder-500" aria-hidden />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-xs text-larder-600 dark:text-larder-400">Name</span>
              <span className="truncate text-sm font-medium text-larder-950 dark:text-larder-50">
                {profile?.display_name ?? '—'}
              </span>
            </span>
          </div>
          <div className="flex items-center gap-3 px-4 py-4">
            <Mail className="h-5 w-5 shrink-0 text-larder-500" aria-hidden />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-xs text-larder-600 dark:text-larder-400">Email</span>
              <span className="truncate text-sm font-medium text-larder-950 dark:text-larder-50">
                {user?.email ?? '—'}
              </span>
            </span>
          </div>
        </section>

        <Link to="/households" className="btn-secondary w-full">
          Switch household
        </Link>

        <button
          type="button"
          onClick={() => setConfirmSignOut(true)}
          className="btn-ghost w-full gap-2 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
        >
          <LogOut className="h-4 w-4" aria-hidden />
          Sign out
        </button>
      </div>

      <ConfirmDialog
        open={confirmSignOut}
        title="Sign out?"
        body="You'll need your email and password to get back in."
        confirmLabel="Sign out"
        tone="danger"
        onCancel={() => setConfirmSignOut(false)}
        onConfirm={async () => {
          setConfirmSignOut(false)
          await signOut()
          navigate('/signin', { replace: true })
        }}
      />
    </AppShell>
  )
}
