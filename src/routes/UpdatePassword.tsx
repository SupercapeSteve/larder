import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthLayout } from '@/components/AuthLayout'
import { ErrorBanner, FullPageSpinner, SubmitButton, SuccessBanner, TextField } from '@/components/ui'
import {
  MIN_PASSWORD_LENGTH,
  consumeAuthTokensFromUrl,
  updatePassword,
  validatePassword,
} from '@/lib/auth'
import { useAuth } from '@/hooks/useAuth'

export default function UpdatePassword() {
  const navigate = useNavigate()
  const { status, setRecovering } = useAuth()
  const [checking, setChecking] = useState(true)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  // Recovery links carry their tokens in the URL fragment. `detectSessionInUrl`
  // is off globally so no stray URL can silently sign anyone in; this route is
  // the one place that opts in.
  useEffect(() => {
    let active = true
    consumeAuthTokensFromUrl().then((result) => {
      if (!active) return
      if (!result.ok) {
        setLinkError(result.message)
      } else if (result.consumed) {
        // The link signed them in, but they have not proved they know a
        // password yet. Pin them here until they set one.
        setRecovering(true)
      }
      setChecking(false)
    })
    return () => {
      active = false
    }
  }, [setRecovering])

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)

    const next: typeof errors = {}
    const problem = validatePassword(password)
    if (problem) next.password = problem
    if (confirm !== password) next.confirm = 'These don’t match.'
    setErrors(next)
    if (Object.keys(next).length > 0) return

    setBusy(true)
    const result = await updatePassword(password)
    setBusy(false)

    if (!result.ok) {
      setFormError(result.message)
      return
    }
    setRecovering(false)
    setDone(true)
  }

  if (checking) {
    return (
      <div className="h-full">
        <FullPageSpinner label="Checking your reset link" />
      </div>
    )
  }

  if (done) {
    return (
      <AuthLayout title="Password updated" subtitle="You're all set.">
        <div className="space-y-4">
          <SuccessBanner>Your new password is saved.</SuccessBanner>
          <p className="text-sm text-larder-600 dark:text-larder-400">
            If you got here from an email on your phone, reopen Larder from your home screen and
            sign in with the new password.
          </p>
          <button
            type="button"
            className="btn-primary w-full"
            onClick={() => navigate('/', { replace: true })}
          >
            Continue
          </button>
        </div>
      </AuthLayout>
    )
  }

  if (linkError || status === 'signed-out') {
    return (
      <AuthLayout title="That link didn't work" subtitle="Reset links expire quickly.">
        <div className="space-y-4">
          <ErrorBanner>{linkError ?? 'This reset link has expired or was already used.'}</ErrorBanner>
          <Link to="/forgot-password" className="btn-primary w-full">
            Send a new link
          </Link>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Choose a new password" subtitle="Make it one you'll remember.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {formError ? <ErrorBanner>{formError}</ErrorBanner> : null}

        <TextField
          label="New password"
          type="password"
          autoComplete="new-password"
          hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          required
        />

        <TextField
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={errors.confirm}
          required
        />

        <SubmitButton busy={busy}>Save password</SubmitButton>
      </form>
    </AuthLayout>
  )
}
