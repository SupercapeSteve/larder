import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthLayout } from '@/components/AuthLayout'
import { ErrorBanner, SubmitButton, TextField } from '@/components/ui'
import { signIn, validateEmail } from '@/lib/auth'

export default function SignIn() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)

    const problem = validateEmail(email)
    setEmailError(problem)
    if (problem) return

    setBusy(true)
    const result = await signIn({ email, password })
    setBusy(false)

    if (!result.ok) {
      setFormError(result.message)
      return
    }
    navigate('/', { replace: true })
  }

  return (
    <AuthLayout
      title="Larder"
      subtitle="Your household's grocery list, in real time."
      footer={
        <span className="text-larder-600 dark:text-larder-400">
          New here?{' '}
          <Link to="/signup" className="font-medium text-larder-700 underline dark:text-larder-300">
            Create an account
          </Link>
        </span>
      }
    >
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

        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        <SubmitButton busy={busy}>Sign in</SubmitButton>

        <div className="text-center">
          <Link
            to="/forgot-password"
            className="tap inline-flex px-2 text-sm text-larder-600 underline dark:text-larder-400"
          >
            Forgot your password?
          </Link>
        </div>
      </form>
    </AuthLayout>
  )
}
