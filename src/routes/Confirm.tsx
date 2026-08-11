import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthLayout } from '@/components/AuthLayout'
import { ErrorBanner, FullPageSpinner, SuccessBanner } from '@/components/ui'
import { consumeAuthTokensFromUrl } from '@/lib/auth'
import { useAuth } from '@/hooks/useAuth'

type State = 'checking' | 'confirmed' | 'already' | 'failed'

/**
 * Landing page for the sign-up confirmation email.
 *
 * The link used to point at /signin, which meant the tokens in the fragment
 * were never consumed and the page looked like it had done nothing — the
 * reported "clicking the link doesn't open anything". Now the tokens are read
 * here deliberately, the session is established, and the user is told plainly
 * that it worked.
 */
export default function Confirm() {
  const navigate = useNavigate()
  const { status } = useAuth()
  const [state, setState] = useState<State>('checking')
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    consumeAuthTokensFromUrl().then((result) => {
      if (!active) return

      if (!result.ok) {
        setMessage(result.message)
        setState('failed')
        return
      }

      if (result.consumed) {
        setState('confirmed')
        return
      }

      // No tokens in the URL. Either the link was already used (Supabase
      // consumes it server-side on first click) or somebody navigated here
      // directly. Both are benign, and neither is an error worth alarming over.
      setState('already')
    })

    return () => {
      active = false
    }
  }, [])

  if (state === 'checking') return <FullPageSpinner label="Confirming your email" />

  if (state === 'failed') {
    return (
      <AuthLayout title="That link didn't work" subtitle="Confirmation links expire.">
        <div className="space-y-4">
          <ErrorBanner>{message ?? 'This confirmation link has expired or was already used.'}</ErrorBanner>
          <p className="text-sm text-larder-600 dark:text-larder-400">
            Try signing in anyway — if your email was already confirmed on an earlier click, it will
            just work.
          </p>
          <Link to="/signin" className="btn-primary w-full">
            Go to sign in
          </Link>
        </div>
      </AuthLayout>
    )
  }

  if (state === 'confirmed') {
    return (
      <AuthLayout title="Email confirmed" subtitle="You're all set.">
        <div className="space-y-4">
          <SuccessBanner>Your account is active and you're signed in.</SuccessBanner>
          <p className="text-sm text-larder-600 dark:text-larder-400">
            On iPhone this opened in Safari rather than the installed app — that's expected. You can
            carry on here, or reopen Larder from your home screen and sign in there.
          </p>
          <button
            type="button"
            className="btn-primary w-full"
            onClick={() => navigate('/', { replace: true })}
          >
            Continue to my list
          </button>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Already confirmed" subtitle="Nothing left to do.">
      <div className="space-y-4">
        <SuccessBanner>This link has already been used — your email is confirmed.</SuccessBanner>
        <Link
          to={status === 'signed-in' ? '/' : '/signin'}
          className="btn-primary w-full"
        >
          {status === 'signed-in' ? 'Continue to my list' : 'Go to sign in'}
        </Link>
      </div>
    </AuthLayout>
  )
}
