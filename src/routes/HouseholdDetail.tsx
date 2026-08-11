import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Check, Copy, Crown, DoorOpen, Mic, UserMinus } from 'lucide-react'
import { AppShell } from '@/components/AppShell'
import { FullPageSpinner } from '@/components/ui'
import { ErrorState } from '@/components/ErrorState'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useToast } from '@/components/Toast'
import {
  useHouseholds,
  useLeaveHousehold,
  useMembers,
  useRemoveMember,
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
  const leaveHousehold = useLeaveHousehold()

  const [copied, setCopied] = useState(false)
  const [pendingRemoval, setPendingRemoval] = useState<MemberWithProfile | null>(null)
  const [confirmLeave, setConfirmLeave] = useState(false)

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
      <div className="space-y-6 py-4 pb-10">
        {/* ── Join code ─────────────────────────────────────────────────── */}
        <section className="card p-5" aria-labelledby="join-code-heading">
          <h2 id="join-code-heading" className="text-sm font-medium text-larder-700 dark:text-larder-300">
            Invite code
          </h2>
          <p className="mt-1 text-xs text-larder-600 dark:text-larder-400">
            Read it out or send it over. No ambiguous letters — there's no O, I, L, 0 or 1 in a
            Larder code.
          </p>

          <div className="mt-4 flex items-center gap-3">
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
        </section>

        {/* ── Members ───────────────────────────────────────────────────── */}
        <section aria-labelledby="members-heading">
          <h2
            id="members-heading"
            className="mb-2 px-1 text-sm font-medium text-larder-700 dark:text-larder-300"
          >
            {members.length} {members.length === 1 ? 'member' : 'members'}
          </h2>

          <ul className="card divide-y divide-larder-200 dark:divide-larder-800">
            {members.map((member) => (
              <li key={member.userId} className="flex items-center gap-3 px-4 py-3">
                <span
                  aria-hidden
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-larder-200 text-sm font-semibold text-larder-800 dark:bg-larder-800 dark:text-larder-100"
                >
                  {member.displayName.charAt(0).toUpperCase()}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-larder-950 dark:text-larder-50">
                    {member.displayName}
                    {member.isYou ? <span className="text-larder-500"> (you)</span> : null}
                  </span>
                  {member.role === 'owner' ? (
                    <span className="mt-0.5 flex items-center gap-1 text-xs text-larder-600 dark:text-larder-400">
                      <Crown className="h-3 w-3" aria-hidden />
                      Owner
                    </span>
                  ) : null}
                </span>

                {isOwner && !member.isYou ? (
                  <button
                    type="button"
                    onClick={() => setPendingRemoval(member)}
                    className="tap shrink-0 rounded-xl text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/50"
                    aria-label={`Remove ${member.displayName}`}
                  >
                    <UserMinus className="h-5 w-5" aria-hidden />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>

        {/* ── Siri ──────────────────────────────────────────────────────── */}
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

        {/* ── Leave ─────────────────────────────────────────────────────── */}
        <button
          type="button"
          onClick={() => setConfirmLeave(true)}
          className="btn-ghost w-full gap-2 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
        >
          <DoorOpen className="h-4 w-4" aria-hidden />
          Leave this household
        </button>
      </div>

      <ConfirmDialog
        open={pendingRemoval !== null}
        title={`Remove ${pendingRemoval?.displayName ?? 'this member'}?`}
        body="They'll lose access to this list immediately. They can rejoin with the code."
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
            onError: (error) =>
              showToast({ message: (error as Error).message, tone: 'error' }),
          })
        }}
      />

      <ConfirmDialog
        open={confirmLeave}
        title={`Leave ${household.name}?`}
        body={
          isOwner && members.length > 1
            ? "You're the owner. The longest-standing member becomes owner when you go."
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
