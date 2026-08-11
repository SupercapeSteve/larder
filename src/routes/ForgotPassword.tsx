import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { AuthLayout } from '@/components/AuthLayout'
import { ErrorBanner, SubmitButton, SuccessBanner, TextField } from '@/components/ui'
import { requestPasswordReset, validateEmail } from '@/lib/auth'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)

    const problem = validateEmail(email)
    setEmailError(problem)
    if (problem) return

    setBusy(true)
    const result = await requestPasswordReset(email)
    setBusy(false)

    if (!result.ok) {
      setFormError(result.message)
      return
    }
    setSent(true)
  }

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="We'll email you a link to set a new one."
      footer={
        <Link to="/signin" className="font-medium text-larder-700 underline dark:text-larder-300">
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <div className="space-y-4">
          <SuccessBanner>
            If there's an account for <strong>{email.trim()}</strong>, a reset link is on its way.
          </SuccessBanner>
          <p className="text-sm text-larder-600 dark:text-larder-400">
            On iPhone the link opens in Safari, not in the installed app — that's expected. Set your
            new password there, then reopen Larder from your home screen and sign in with it.
          </p>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {formError ? <ErrorBanner>{formError}</ErrorBanner> : null}
          <TextField
            label="Email"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={emailError}
            required
          />
          <SubmitButton busy={busy}>Send reset link</SubmitButton>
        </form>
      )}
    </AuthLayout>
  )
}
