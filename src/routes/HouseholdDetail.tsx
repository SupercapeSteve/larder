import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Check,
  Copy,
  Crown,
  DoorOpen,
  Mic,
  Pencil,
  RefreshCw,
  ShieldCheck,
  UserMinus,
} from 'lucide-react'
import { AppShell } from '@/components/AppShell'
import { Avatar } from '@/components/Avatar'
import { ErrorBanner, FullPageSpinner, Spinner, TextField } from '@/components/ui'
import { ErrorState } from '@/components/ErrorState'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { SettingsSection } from '@/components/settings'
import { useToast } from '@/components/Toast'
import {
  useHouseholds,
  useLeaveHousehold,
  useMembers,
  useRegenerateJoinCode,
  useRemoveMember,
  useRenameHousehold,
  useSetMemberRole,
  type MemberWithProfile,
} from '@/hooks/useHouseholds'
import { copyToClipboard } from '@/lib/clipboard'
import { LAST_HOUSEHOLD_KEY, removeLocal } from '@/lib/storage'

export default function HouseholdDetail() {
  const { householdId } = useParams<{ householdId: string }>()
  const navigate = useNavigate()
  const { showToast } = useToast()

  const householdsQuery = useHouseholds()
  const membersQuery = useMembers(householdId)
  const removeMember = useRemoveMember(householdId ?? '')
  const setMemberRole = useSetMemberRole(householdId ?? '')
  const regenerateCode = useRegenerateJoinCode(householdId ?? '')
  const leaveHousehold = useLeaveHousehold()

  const [copied, setCopied] = useState(false)
  const [pendingRemoval, setPendingRemoval] = useState<MemberWithProfile | null>(null)
  const [pendingDemotion, setPendingDemotion] = useState<MemberWithProfile | null>(null)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [confirmRegenerate, setConfirmRegenerate] = useState(false)

  if (householdsQuery.isPending || membersQuery.isPending) {
    return <FullPageSpinner label="Loading household" />
  }

  const household = householdsQuery.data?.find((h) => h.id === householdId)
  if (!household) {
    return (
      <ErrorState
        title="Household not found"
        message="You're not a member of this household, or it no longer exists."
        onRetry={() => navigate('/', { replace: true })}
      />
    )
  }

  const members = membersQuery.data ?? []
  const isOwner = household.role === 'owner'
  const ownerCount = members.filter((m) => m.role === 'owner').length

  async function onCopyCode() {
    if (!household) return
    const ok = await copyToClipboard(household.join_code)
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      showToast({ message: 'Join code copied.' })
    } else {
      showToast({ message: 'Couldn’t copy — read it out instead.', tone: 'error' })
    }
  }

  function changeRole(member: MemberWithProfile, role: 'owner' | 'member') {
    setMemberRole.mutate(
      { userId: member.userId, role },
      {
        onSuccess: () =>
          showToast({
            message:
              role === 'owner'
                ? `${member.isYou ? 'You are' : `${member.displayName} is`} now an owner.`
                : `${member.isYou ? 'You are' : `${member.displayName} is`} now a member.`,
          }),
        onError: (error) => showToast({ message: (error as Error).message, tone: 'error' }),
      },
    )
  }

  return (
    <AppShell
      header={
        <div className="flex min-h-tap items-center gap-1 py-3">
          <Link
            to={`/h/${household.id}`}
            className="tap -ml-2 rounded-xl text-larder-700 dark:text-larder-300"
            aria-label="Back to the list"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </Link>
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight">
            {household.name}
          </h1>
        </div>
      }
    >
      <div className="space-y-6 py-4 pb-12">
        <NameSection
          householdId={household.id}
          name={household.name}
          canEdit={isOwner}
        />

        {/* ── Join code ─────────────────────────────────────────────────── */}
        <SettingsSection
          title="Invite code"
          description="Read it out or send it over. No ambiguous letters — there's no O, I, L, 0 or 1 in a Larder code."
        >
          <div className="px-4 py-4">
            <div className="flex items-center gap-3">
              <output
                className="flex-1 rounded-xl bg-larder-100 py-3 text-center font-mono text-2xl font-semibold tracking-[0.3em] text-larder-900 dark:bg-larder-950 dark:text-larder-50"
                aria-label={`Join code ${household.join_code.split('').join(' ')}`}
              >
                {household.join_code}
              </output>
              <button
                type="button"
                onClick={onCopyCode}
                className="btn-secondary shrink-0 gap-2"
                aria-label="Copy join code"
              >
                {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>

            {isOwner ? (
              <button
                type="button"
                onClick={() => setConfirmRegenerate(true)}
                disabled={regenerateCode.isPending}
                className="btn-ghost mt-3 w-full gap-2 text-sm"
              >
                {regenerateCode.isPending ? <Spinner /> : <RefreshCw className="h-4 w-4" aria-hidden />}
                Generate a new code
              </button>
            ) : null}
          </div>
        </SettingsSection>

        {/* ── Members ───────────────────────────────────────────────────── */}
        <SettingsSection
          title={`${members.length} ${members.length === 1 ? 'member' : 'members'}`}
          description={isOwner ? 'Owners can rename the household, rotate the code and manage members.' : undefined}
        >
          {members.map((member) => (
            <div key={member.userId} className="flex items-center gap-3 px-4 py-3">
              <Avatar
                userId={member.userId}
                displayName={member.displayName}
                emoji={member.avatarEmoji}
                color={member.avatarColor}
                imageUrl={member.avatarUrl}
                size="md"
              />

              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-larder-950 dark:text-larder-50">
                  {member.displayName}
                  {member.isYou ? <span className="text-larder-500"> (you)</span> : null}
                </span>
                <span className="mt-0.5 flex items-center gap-1 text-xs text-larder-600 dark:text-larder-400">
                  {member.role === 'owner' ? (
                    <>
                      <Crown className="h-3 w-3" aria-hidden />
                      Owner
                    </>
                  ) : (
                    'Member'
                  )}
                </span>
              </span>

              {isOwner ? (
                <div className="flex shrink-0 items-center gap-1">
                  {member.role === 'member' ? (
                    <button
                      type="button"
                      onClick={() => changeRole(member, 'owner')}
                      className="tap rounded-xl text-larder-600 dark:text-larder-400"
                      aria-label={`Make ${member.displayName} an owner`}
                      title="Make owner"
                    >
                      <ShieldCheck className="h-5 w-5" aria-hidden />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setPendingDemotion(member)}
                      disabled={ownerCount <= 1}
                      className="tap rounded-xl text-larder-600 disabled:opacity-30 dark:text-larder-400"
                      aria-label={`Remove owner rights from ${member.displayName}`}
                      title={ownerCount <= 1 ? 'A household needs an owner' : 'Make member'}
                    >
                      <Crown className="h-5 w-5" aria-hidden />
                    </button>
                  )}

                  {!member.isYou ? (
                    <button
                      type="button"
                      onClick={() => setPendingRemoval(member)}
                      className="tap rounded-xl text-red-600 dark:text-red-400"
                      aria-label={`Remove ${member.displayName}`}
                    >
                      <UserMinus className="h-5 w-5" aria-hidden />
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </SettingsSection>

        <Link to={`/h/${household.id}/siri`} className="card flex items-center gap-3 px-4 py-4">
          <Mic className="h-5 w-5 shrink-0 text-larder-600 dark:text-larder-400" aria-hidden />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-sm font-medium text-larder-950 dark:text-larder-50">
              Siri &amp; Shortcuts
            </span>
            <span className="text-xs text-larder-600 dark:text-larder-400">
              Add to the list by voice
            </span>
          </span>
        </Link>

        <button
          type="button"
          onClick={() => setConfirmLeave(true)}
          className="btn-ghost w-full gap-2 text-red-600 dark:text-red-400"
        >
          <DoorOpen className="h-4 w-4" aria-hidden />
          Leave this household
        </button>
      </div>

      <ConfirmDialog
        open={confirmRegenerate}
        title="Generate a new invite code?"
        body="The current code stops working immediately. Anyone already in the household stays in — they just can't re-share the old code."
        confirmLabel="Generate"
        onCancel={() => setConfirmRegenerate(false)}
        onConfirm={() => {
          setConfirmRegenerate(false)
          regenerateCode.mutate(undefined, {
            onSuccess: (code) => showToast({ message: `New code: ${code}` }),
            onError: (error) => showToast({ message: (error as Error).message, tone: 'error' }),
          })
        }}
      />

      <ConfirmDialog
        open={pendingDemotion !== null}
        title={`Remove owner rights from ${pendingDemotion?.isYou ? 'yourself' : (pendingDemotion?.displayName ?? 'this member')}?`}
        body={
          pendingDemotion?.isYou
            ? "You'll no longer be able to rename the household, rotate the code, or manage members."
            : "They'll keep access to the list but lose the ability to manage the household."
        }
        confirmLabel="Make member"
        tone="danger"
        onCancel={() => setPendingDemotion(null)}
        onConfirm={() => {
          const target = pendingDemotion
          setPendingDemotion(null)
          if (target) changeRole(target, 'member')
        }}
      />

      <ConfirmDialog
        open={pendingRemoval !== null}
        title={`Remove ${pendingRemoval?.displayName ?? 'this member'}?`}
        body="They'll lose access to this list immediately, and any Siri tokens they made for it stop working. They can rejoin with the code."
        confirmLabel="Remove"
        tone="danger"
        busy={removeMember.isPending}
        onCancel={() => setPendingRemoval(null)}
        onConfirm={() => {
          const target = pendingRemoval
          setPendingRemoval(null)
          if (!target) return
          removeMember.mutate(target.userId, {
            onSuccess: () => showToast({ message: `${target.displayName} removed.` }),
            onError: (error) => showToast({ message: (error as Error).message, tone: 'error' }),
          })
        }}
      />

      <ConfirmDialog
        open={confirmLeave}
        title={`Leave ${household.name}?`}
        body={
          isOwner && members.length > 1
            ? "You're an owner. The longest-standing member becomes owner when you go."
            : members.length === 1
              ? 'You are the only member, so the household and its list will be deleted.'
              : "You'll need the code to get back in."
        }
        confirmLabel="Leave"
        tone="danger"
        busy={leaveHousehold.isPending}
        onCancel={() => setConfirmLeave(false)}
        onConfirm={() => {
          setConfirmLeave(false)
          leaveHousehold.mutate(household.id, {
            onSuccess: () => {
              removeLocal(LAST_HOUSEHOLD_KEY)
              showToast({ message: `Left ${household.name}.` })
              navigate('/', { replace: true })
            },
            onError: (error) => showToast({ message: (error as Error).message, tone: 'error' }),
          })
        }}
      />
    </AppShell>
  )
}

/* ── Household name ───────────────────────────────────────────────────────── */

function NameSection({
  householdId,
  name,
  canEdit,
}: {
  householdId: string
  name: string
  canEdit: boolean
}) {
  const rename = useRenameHousehold(householdId)
  const { showToast } = useToast()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(name)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => setValue(name), [name])

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (value.trim().length === 0) {
      setError('Give the household a name.')
      return
    }
    setError(null)
    rename.mutate(value, {
      onSuccess: () => {
        setEditing(false)
        showToast({ message: 'Household renamed.' })
      },
      onError: (e) => setError((e as Error).message),
    })
  }

  return (
    <SettingsSection title="Household name">
      {editing ? (
        <form onSubmit={save} className="space-y-3 px-4 py-3" noValidate>
          {error ? <ErrorBanner>{error}</ErrorBanner> : null}
          <TextField
            label="Name"
            value={value}
            maxLength={60}
            autoFocus
            onChange={(e) => setValue(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-secondary flex-1"
              onClick={() => {
                setEditing(false)
                setError(null)
                setValue(name)
              }}
            >
              Cancel
            </button>
            <button type="submit" className="btn-primary flex-1 gap-2" disabled={rename.isPending}>
              {rename.isPending ? <Spinner /> : <Check className="h-4 w-4" aria-hidden />}
              Save
            </button>
          </div>
        </form>
      ) : (
        <div className="flex items-center gap-3 px-4 py-3">
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-larder-950 dark:text-larder-50">
            {name}
          </span>
          {canEdit ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="tap shrink-0 gap-1.5 rounded-xl px-2 text-sm font-medium text-larder-700 dark:text-larder-300"
            >
              <Pencil className="h-4 w-4" aria-hidden />
              Edit
            </button>
          ) : (
            <span className="shrink-0 text-xs text-larder-500">Owners only</span>
          )}
        </div>
      )}
    </SettingsSection>
  )
}
