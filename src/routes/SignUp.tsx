import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthLayout } from '@/components/AuthLayout'
import { ErrorBanner, SubmitButton, SuccessBanner, TextField } from '@/components/ui'
import { MIN_PASSWORD_LENGTH, signUp, validateEmail, validatePassword } from '@/lib/auth'

export default function SignUp() {
  const navigate = useNavigate()
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<{ name?: string; email?: string; password?: string }>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [confirmationSent, setConfirmationSent] = useState(false)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)

    const next: typeof errors = {}
    if (displayName.trim().length === 0) next.name = 'Tell us what to call you.'
    const emailProblem = validateEmail(email)
    if (emailProblem) next.email = emailProblem
    const passwordProblem = validatePassword(password)
    if (passwordProblem) next.password = passwordProblem
    setErrors(next)
    if (Object.keys(next).length > 0) return

    setBusy(true)
    const result = await signUp({ email, password, displayName })
    setBusy(false)

    if (!result.ok) {
      setFormError(result.message)
      return
    }
    if (result.needsEmailConfirmation) {
      setConfirmationSent(true)
      return
    }
    navigate('/', { replace: true })
  }

  if (confirmationSent) {
    return (
      <AuthLayout title="Almost there" subtitle="One click and you're in.">
        <div className="space-y-4">
          <SuccessBanner>
            We sent a confirmation link to <strong>{email.trim()}</strong>. Open it, then come back
            and sign in.
          </SuccessBanner>
          <p className="text-sm text-larder-600 dark:text-larder-400">
            Nothing there? Check spam — confirmation mail from a fresh Supabase project often lands
            there the first time.
          </p>
          <Link to="/signin" className="btn-secondary w-full">
            Back to sign in
          </Link>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Create your Larder"
      subtitle="Then invite whoever does the shopping with you."
      footer={
        <span className="text-larder-600 dark:text-larder-400">
          Already have an account?{' '}
          <Link to="/signin" className="font-medium text-larder-700 underline dark:text-larder-300">
            Sign in
          </Link>
        </span>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {formError ? <ErrorBanner>{formError}</ErrorBanner> : null}

        <TextField
          label="Your name"
          hint="Shown next to items you add — so your housemate knows who wanted the olives."
          autoComplete="name"
          maxLength={60}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          error={errors.name}
          required
        />

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
          error={errors.email}
          required
        />

        <TextField
          label="Password"
          type="password"
          autoComplete="new-password"
          hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          required
        />

        <SubmitButton busy={busy}>Create account</SubmitButton>
      </form>
    </AuthLayout>
  )
}
