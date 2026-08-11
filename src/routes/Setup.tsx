import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Home, LogOut, Users } from 'lucide-react'
import { AuthLayout } from '@/components/AuthLayout'
import { ErrorBanner, SubmitButton, TextField } from '@/components/ui'
import { useCreateHousehold, useJoinHousehold } from '@/hooks/useHouseholds'
import { useProfile } from '@/hooks/useAuth'
import { signOut } from '@/lib/auth'

const JOIN_CODE_PATTERN = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/

type Mode = 'choose' | 'create' | 'join'

export default function Setup() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('choose')
  const { data: profile } = useProfile()

  const firstName = profile?.display_name.split(' ')[0]

  if (mode === 'create') return <CreateHousehold onBack={() => setMode('choose')} />
  if (mode === 'join') return <JoinHousehold onBack={() => setMode('choose')} />

  return (
    <AuthLayout
      title={firstName ? `Hi, ${firstName}` : 'One more step'}
      subtitle="Start a household, or join the one you've been invited to."
    >
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => setMode('create')}
          className="btn-secondary w-full justify-start gap-3 py-4 text-left"
        >
          <Home className="h-5 w-5 shrink-0 text-larder-600 dark:text-larder-400" aria-hidden />
          <span className="flex min-w-0 flex-col">
            <span className="font-semibold">Start a household</span>
            <span className="text-xs font-normal text-larder-600 dark:text-larder-400">
              You'll get a code to share
            </span>
          </span>
        </button>

        <button
          type="button"
          onClick={() => setMode('join')}
          className="btn-secondary w-full justify-start gap-3 py-4 text-left"
        >
          <Users className="h-5 w-5 shrink-0 text-larder-600 dark:text-larder-400" aria-hidden />
          <span className="flex min-w-0 flex-col">
            <span className="font-semibold">Join with a code</span>
            <span className="text-xs font-normal text-larder-600 dark:text-larder-400">
              Six characters from your housemate
            </span>
          </span>
        </button>

        <button
          type="button"
          onClick={async () => {
            await signOut()
            navigate('/signin', { replace: true })
          }}
          className="btn-ghost w-full gap-2 text-sm"
        >
          <LogOut className="h-4 w-4" aria-hidden />
          Sign out
        </button>
      </div>
    </AuthLayout>
  )
}

function CreateHousehold({ onBack }: { onBack: () => void }) {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const createHousehold = useCreateHousehold()

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (name.trim().length === 0) {
      setFieldError('Give it a name — "Home" works fine.')
      return
    }
    setFieldError(null)
    try {
      const created = await createHousehold.mutateAsync(name)
      navigate(`/h/${created.household_id}`, { replace: true })
    } catch {
      /* surfaced through createHousehold.error */
    }
  }

  return (
    <AuthLayout title="Name your household" subtitle="Only the people you invite will see it.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {createHousehold.isError ? (
          <ErrorBanner>{(createHousehold.error as Error).message}</ErrorBanner>
        ) : null}

        <TextField
          label="Household name"
          placeholder="Home"
          autoFocus
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={fieldError}
          required
        />

        <SubmitButton busy={createHousehold.isPending}>Create household</SubmitButton>

        <button type="button" onClick={onBack} className="btn-ghost w-full text-sm">
          Back
        </button>
      </form>
    </AuthLayout>
  )
}

function JoinHousehold({ onBack }: { onBack: () => void }) {
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const joinHousehold = useJoinHousehold()

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const clean = code.trim().toUpperCase()

    if (!JOIN_CODE_PATTERN.test(clean)) {
      setFieldError(
        clean.length === 6
          ? 'Codes never contain O, I, L, 0 or 1 — check for a lookalike.'
          : 'Join codes are exactly six characters.',
      )
      return
    }
    setFieldError(null)

    try {
      const householdId = await joinHousehold.mutateAsync(clean)
      navigate(`/h/${householdId}`, { replace: true })
    } catch {
      /* surfaced through joinHousehold.error */
    }
  }

  return (
    <AuthLayout title="Enter the code" subtitle="Six characters, from whoever set it up.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {joinHousehold.isError ? (
          <ErrorBanner>{(joinHousehold.error as Error).message}</ErrorBanner>
        ) : null}

        <TextField
          label="Join code"
          placeholder="K7QM2X"
          autoFocus
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          error={fieldError}
          className="text-center font-mono text-2xl uppercase tracking-[0.35em]"
          required
        />

        <SubmitButton busy={joinHousehold.isPending}>Join household</SubmitButton>

        <button type="button" onClick={onBack} className="btn-ghost w-full text-sm">
          Back
        </button>
      </form>
    </AuthLayout>
  )
}
