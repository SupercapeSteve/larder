import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Bell, Check, Download, KeyRound, LogOut, Mail, Pencil, Trash2, Users } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { usePushNotifications } from '@/hooks/usePushNotifications'
import { AppShell } from '@/components/AppShell'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ErrorBanner, Spinner, SuccessBanner, TextField } from '@/components/ui'
import { ChoiceRow, InfoRow, SettingsSection, ToggleRow } from '@/components/settings'
import { useToast } from '@/components/Toast'
import { useAuth, useProfile, useUpdateProfile } from '@/hooks/useAuth'
import { Avatar } from '@/components/Avatar'
import { AvatarPicker } from '@/components/AvatarPicker'
import { useRemoveAvatar, useUploadAvatar } from '@/hooks/useAvatarUpload'
import { AccentPicker } from '@/components/AccentPicker'
import { usePreferences, type TextSize, type ThemeChoice } from '@/hooks/usePreferences'
import { useHouseholds } from '@/hooks/useHouseholds'
import { MIN_PASSWORD_LENGTH, signOut, updatePassword, validatePassword } from '@/lib/auth'

const THEME_CHOICES: ReadonlyArray<{ value: ThemeChoice; label: string; hint?: string }> = [
  { value: 'system', label: 'System', hint: 'Follow iOS' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

const TEXT_SIZE_CHOICES: ReadonlyArray<{ value: TextSize; label: string; hint?: string }> = [
  { value: 'normal', label: 'Normal' },
  { value: 'large', label: 'Large' },
  { value: 'x-large', label: 'Largest' },
]

export default function Account() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { data: profile } = useProfile()
  const { data: households } = useHouseholds()
  const { preferences, setPreference, resetPreferences } = usePreferences()
  const { showToast } = useToast()

  const [confirmSignOut, setConfirmSignOut] = useState(false)

  return (
    <AppShell
      header={
        <div className="flex min-h-tap items-center gap-1 py-3">
          <Link
            to="/"
            className="tap -ml-2 rounded-xl text-larder-700 dark:text-larder-300"
            aria-label="Back to the list"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </Link>
          <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
        </div>
      }
    >
      <div className="space-y-6 py-4 pb-12">
        <NameSection />
        <AvatarSection />

        <SettingsSection title="Account">
          <InfoRow icon={<Mail className="h-5 w-5" aria-hidden />} label="Email" value={user?.email ?? '—'} />
          <InfoRow
            icon={<Users className="h-5 w-5" aria-hidden />}
            label="Households"
            value={`${(households ?? []).length} joined`}
          />
        </SettingsSection>

        <PasswordSection />

        <SettingsSection title="Appearance" description="Applies on this device only.">
          <AccentPicker
            value={preferences.accent}
            onChange={(next) => setPreference('accent', next)}
          />
          <ChoiceRow
            label="Theme"
            value={preferences.theme}
            choices={THEME_CHOICES}
            onChange={(next) => setPreference('theme', next)}
          />
          <ChoiceRow
            label="Text size"
            description="Scales the whole app, not just item names."
            value={preferences.textSize}
            choices={TEXT_SIZE_CHOICES}
            onChange={(next) => setPreference('textSize', next)}
          />
        </SettingsSection>

        <SettingsSection title="The list">
          <ToggleRow
            label="Group by aisle"
            description="Off shows one flat list in the order things were added."
            checked={preferences.groupByCategory}
            onChange={(next) => setPreference('groupByCategory', next)}
          />
          <ToggleRow
            label="Show aisle icons"
            checked={preferences.showEmoji}
            onChange={(next) => setPreference('showEmoji', next)}
          />
          <ToggleRow
            label="Show who added what"
            description="The small name and initial under each item."
            checked={preferences.showAttribution}
            onChange={(next) => setPreference('showAttribution', next)}
          />
          <ToggleRow
            label="Collapse checked items"
            description="Off keeps them in place, ticked, instead of moving them to the bottom."
            checked={preferences.autoCollapseChecked}
            onChange={(next) => setPreference('autoCollapseChecked', next)}
          />
          <ToggleRow
            label="Haptics"
            description="A short tap when you long-press or check something off."
            checked={preferences.haptics}
            onChange={(next) => setPreference('haptics', next)}
          />
        </SettingsSection>

        <div className="space-y-2">
          <Link to="/households" className="btn-secondary w-full gap-2">
            <Users className="h-4 w-4" aria-hidden />
            Switch household
          </Link>

          <button
            type="button"
            onClick={() => {
              resetPreferences()
              showToast({ message: 'Preferences reset.' })
            }}
            className="btn-ghost w-full text-sm"
          >
            Reset preferences
          </button>

          <button
            type="button"
            onClick={() => setConfirmSignOut(true)}
            className="btn-ghost w-full gap-2 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
          >
            <LogOut className="h-4 w-4" aria-hidden />
            Sign out
          </button>
        </div>

        <NotificationsSection />
        <PrivacySection />

        <p className="px-1 text-center text-xs text-larder-500">
          Larder v1.1.0 · signed in as {profile?.display_name ?? user?.email ?? 'you'}
        </p>
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

/* ── Notifications ────────────────────────────────────────────────────────── */

function NotificationsSection() {
  const { state, subscribe, unsubscribe } = usePushNotifications()
  const { showToast } = useToast()

  const copy: Record<typeof state, string> = {
    working: 'Checking…',
    unsupported: 'This browser does not support notifications.',
    'needs-install': 'Add Larder to your home screen first — iOS only delivers notifications to installed apps, never to a Safari tab.',
    denied: 'Blocked. Turn notifications back on for Larder in your device settings.',
    unsubscribed: 'Get a nudge when somebody else adds to the list.',
    subscribed: "You'll be notified when the list changes.",
  }

  const actionable = state === 'unsubscribed' || state === 'subscribed'

  return (
    <SettingsSection title="Notifications">
      <div className="flex items-center gap-3 px-4 py-3">
        <Bell className="h-5 w-5 shrink-0 text-larder-500" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-larder-950 dark:text-larder-50">
            Push notifications
          </span>
          <span className="mt-0.5 block text-xs text-larder-600 dark:text-larder-400">
            {copy[state]}
          </span>
        </span>

        {actionable ? (
          <button
            type="button"
            onClick={async () => {
              if (state === 'subscribed') {
                await unsubscribe()
                showToast({ message: 'Notifications turned off.' })
                return
              }
              const problem = await subscribe()
              showToast(
                problem
                  ? { message: problem, tone: 'error' }
                  : { message: 'Notifications on.' },
              )
            }}
            className="btn-secondary shrink-0 text-sm"
          >
            {state === 'subscribed' ? 'Turn off' : 'Turn on'}
          </button>
        ) : state === 'working' ? (
          <Spinner />
        ) : null}
      </div>
    </SettingsSection>
  )
}

/* ── Your data ────────────────────────────────────────────────────────────── */

function PrivacySection() {
  const navigate = useNavigate()
  const { showToast } = useToast()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)

  async function exportData() {
    setBusy(true)
    const { data, error } = await supabase.rpc('export_my_data')
    setBusy(false)

    if (error || !data) {
      showToast({ message: 'Could not build your export. Try again.', tone: 'error' })
      return
    }

    // Built and downloaded entirely in the browser — the export never touches
    // a third party, and nothing is stored anywhere to leak later.
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `larder-export-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    showToast({ message: 'Export downloaded.' })
  }

  return (
    <SettingsSection
      title="Your data"
      description="Everything Larder holds about you, and how to remove it."
    >
      <button
        type="button"
        onClick={exportData}
        disabled={busy}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-larder-100 dark:hover:bg-larder-800"
      >
        {busy ? <Spinner /> : <Download className="h-5 w-5 shrink-0 text-larder-500" aria-hidden />}
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-larder-950 dark:text-larder-50">
            Download my data
          </span>
          <span className="text-xs text-larder-600 dark:text-larder-400">
            Profile, households, items and history as JSON
          </span>
        </span>
      </button>

      <button
        type="button"
        onClick={() => setConfirmDelete(true)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
      >
        <Trash2 className="h-5 w-5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Delete my account</span>
          <span className="text-xs opacity-80">Permanent. Cannot be undone.</span>
        </span>
      </button>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete your account?"
        body="Your profile, avatar and Siri tokens are removed, and you leave every household. A household with nobody left in it is deleted with its list. This cannot be undone."
        confirmLabel="Delete for ever"
        tone="danger"
        busy={busy}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          setConfirmDelete(false)
          setBusy(true)
          const { error } = await supabase.rpc('delete_my_account')
          setBusy(false)
          if (error) {
            showToast({ message: 'Could not delete your account. Try again.', tone: 'error' })
            return
          }
          await signOut()
          navigate('/signin', { replace: true })
        }}
      />
    </SettingsSection>
  )
}

/* ── Display name ─────────────────────────────────────────────────────────── */

function AvatarSection() {
  const { user } = useAuth()
  const { data: profile } = useProfile()
  const updateProfile = useUpdateProfile()
  const uploadAvatar = useUploadAvatar()
  const removeAvatar = useRemoveAvatar()
  const { showToast } = useToast()

  const onError = (error: unknown) =>
    showToast({ message: (error as Error).message, tone: 'error' })

  return (
    <SettingsSection title="Your avatar">
      <AvatarPicker
        userId={user?.id ?? null}
        displayName={profile?.display_name ?? null}
        emoji={profile?.avatar_emoji ?? null}
        color={profile?.avatar_color ?? null}
        imageUrl={profile?.avatar_url ?? null}
        uploading={uploadAvatar.isPending || removeAvatar.isPending}
        onChange={(next) =>
          updateProfile.mutate(
            {
              ...(next.emoji !== undefined ? { avatarEmoji: next.emoji } : {}),
              ...(next.color !== undefined ? { avatarColor: next.color } : {}),
            },
            { onError },
          )
        }
        onUpload={(blob) =>
          uploadAvatar.mutate(blob, {
            onSuccess: () => showToast({ message: 'Photo updated.' }),
            onError,
          })
        }
        onError={(message) => showToast({ message, tone: 'error' })}
        onRemoveImage={() =>
          removeAvatar.mutate(undefined, {
            onSuccess: () => showToast({ message: 'Photo removed.' }),
            onError,
          })
        }
      />
    </SettingsSection>
  )
}

function NameSection() {
  const { user } = useAuth()
  const { data: profile } = useProfile()
  const updateName = useUpdateProfile()
  const { showToast } = useToast()

  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (profile) setName(profile.display_name)
  }, [profile])

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (name.trim().length === 0) {
      setError('Your name can’t be empty.')
      return
    }
    setError(null)
    updateName.mutate(
      { displayName: name },
      {
        onSuccess: () => {
          setEditing(false)
          showToast({ message: 'Name updated.' })
        },
        onError: (e) => setError((e as Error).message),
      },
    )
  }

  return (
    <SettingsSection title="Your name" description="Shown next to every item you add.">
      {editing ? (
        <form onSubmit={save} className="space-y-3 px-4 py-3" noValidate>
          {error ? <ErrorBanner>{error}</ErrorBanner> : null}
          <TextField
            label="Display name"
            value={name}
            maxLength={60}
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-secondary flex-1"
              onClick={() => {
                setEditing(false)
                setError(null)
                if (profile) setName(profile.display_name)
              }}
            >
              Cancel
            </button>
            <button type="submit" className="btn-primary flex-1 gap-2" disabled={updateName.isPending}>
              {updateName.isPending ? <Spinner /> : <Check className="h-4 w-4" aria-hidden />}
              Save
            </button>
          </div>
        </form>
      ) : (
        <div className="flex items-center gap-3 px-4 py-3">
          <Avatar
            userId={user?.id ?? null}
            displayName={profile?.display_name ?? null}
            emoji={profile?.avatar_emoji ?? null}
            color={profile?.avatar_color ?? null}
            imageUrl={profile?.avatar_url ?? null}
            size="md"
          />
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-larder-950 dark:text-larder-50">
            {profile?.display_name ?? '—'}
          </span>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="tap shrink-0 gap-1.5 rounded-xl px-2 text-sm font-medium text-larder-700 dark:text-larder-300"
          >
            <Pencil className="h-4 w-4" aria-hidden />
            Edit
          </button>
        </div>
      )}
    </SettingsSection>
  )
}

/* ── Password ─────────────────────────────────────────────────────────────── */

function PasswordSection() {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    const problem = validatePassword(password)
    if (problem) {
      setError(problem)
      return
    }
    if (password !== confirm) {
      setError('These don’t match.')
      return
    }

    setBusy(true)
    const result = await updatePassword(password)
    setBusy(false)

    if (!result.ok) {
      setError(result.message)
      return
    }
    setPassword('')
    setConfirm('')
    setOpen(false)
    setDone(true)
  }

  return (
    <SettingsSection title="Password">
      {done ? (
        <div className="px-4 py-3">
          <SuccessBanner>Password changed.</SuccessBanner>
        </div>
      ) : null}

      {open ? (
        <form onSubmit={save} className="space-y-3 px-4 py-3" noValidate>
          {error ? <ErrorBanner>{error}</ErrorBanner> : null}
          <TextField
            label="New password"
            type="password"
            autoComplete="new-password"
            hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <TextField
            label="Confirm password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-secondary flex-1"
              onClick={() => {
                setOpen(false)
                setError(null)
                setPassword('')
                setConfirm('')
              }}
            >
              Cancel
            </button>
            <button type="submit" className="btn-primary flex-1" disabled={busy}>
              {busy ? <Spinner className="mr-2 h-4 w-4" /> : null}
              Save password
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => {
            setOpen(true)
            setDone(false)
          }}
          className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-larder-100 dark:hover:bg-larder-800"
        >
          <KeyRound className="h-5 w-5 shrink-0 text-larder-500" aria-hidden />
          <span className="min-w-0 flex-1 text-sm font-medium text-larder-950 dark:text-larder-50">
            Change password
          </span>
        </button>
      )}
    </SettingsSection>
  )
}
