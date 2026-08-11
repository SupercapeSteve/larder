import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Check, Copy, KeyRound, Mic, Plus, Trash2 } from 'lucide-react'
import { AppShell } from '@/components/AppShell'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ErrorBanner, FullPageSpinner, Spinner, TextField } from '@/components/ui'
import { ErrorState } from '@/components/ErrorState'
import { useToast } from '@/components/Toast'
import { useDefaultList } from '@/hooks/useHouseholds'
import { useApiTokens, useCreateApiToken, useRevokeApiToken } from '@/hooks/useApiTokens'
import { copyToClipboard } from '@/lib/clipboard'
import { functionsBaseUrl } from '@/lib/env'
import type { ApiToken } from '@/types/database'

const ENDPOINT = `${functionsBaseUrl}/siri`

export default function SiriSettings() {
  const { householdId } = useParams<{ householdId: string }>()
  const { list, isPending } = useDefaultList(householdId)
  const { showToast } = useToast()

  const tokensQuery = useApiTokens(list?.id)
  const createToken = useCreateApiToken(list?.id ?? '')
  const revokeToken = useRevokeApiToken()

  const [label, setLabel] = useState('')
  const [minted, setMinted] = useState<string | null>(null)
  const [copiedToken, setCopiedToken] = useState(false)
  const [pendingRevoke, setPendingRevoke] = useState<ApiToken | null>(null)

  if (isPending) return <FullPageSpinner label="Loading" />
  if (!list) {
    return (
      <ErrorState
        title="No list here"
        message="This household doesn't have a list yet, so there's nothing to connect Siri to."
      />
    )
  }

  const tokens = tokensQuery.data ?? []

  async function copy(text: string, what: string) {
    const ok = await copyToClipboard(text)
    showToast({
      message: ok ? `${what} copied.` : `Couldn't copy the ${what.toLowerCase()}.`,
      tone: ok ? 'neutral' : 'error',
    })
    return ok
  }

  return (
    <AppShell
      header={
        <div className="flex min-h-tap items-center gap-1 py-3">
          <Link
            to={`/h/${householdId}/household`}
            className="tap -ml-2 rounded-xl text-larder-700 dark:text-larder-300"
            aria-label="Back"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </Link>
          <h1 className="text-lg font-semibold tracking-tight">Siri &amp; Shortcuts</h1>
        </div>
      }
    >
      <div className="space-y-6 py-4 pb-10">
        {/* ── The one-time reveal ───────────────────────────────────────── */}
        {minted ? (
          <section className="card border-amber-300 p-5 dark:border-amber-800">
            <div className="mb-3 flex items-start gap-2">
              <AlertTriangle
                className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400"
                aria-hidden
              />
              <div>
                <h2 className="text-sm font-semibold text-larder-950 dark:text-larder-50">
                  Copy this now — it will never be shown again
                </h2>
                <p className="mt-1 text-xs text-larder-600 dark:text-larder-400">
                  Larder stores only a SHA-256 hash of this token. Nobody, including you, can read
                  it back. Lose it and you make a new one.
                </p>
              </div>
            </div>

            <code className="block break-all rounded-xl bg-larder-100 p-3 font-mono text-sm text-larder-900 dark:bg-larder-950 dark:text-larder-100">
              {minted}
            </code>

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="btn-primary flex-1 gap-2"
                onClick={async () => {
                  const ok = await copy(minted, 'Token')
                  if (ok) {
                    setCopiedToken(true)
                    setTimeout(() => setCopiedToken(false), 2000)
                  }
                }}
              >
                {copiedToken ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
                {copiedToken ? 'Copied' : 'Copy token'}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setMinted(null)}>
                Done
              </button>
            </div>
          </section>
        ) : null}

        {/* ── Create ────────────────────────────────────────────────────── */}
        <section className="card p-5" aria-labelledby="new-token-heading">
          <h2
            id="new-token-heading"
            className="text-sm font-semibold text-larder-950 dark:text-larder-50"
          >
            New token
          </h2>
          <p className="mt-1 text-xs text-larder-600 dark:text-larder-400">
            One per device is tidiest — you can revoke a phone without breaking the others.
          </p>

          {createToken.isError ? (
            <div className="mt-3">
              <ErrorBanner>{(createToken.error as Error).message}</ErrorBanner>
            </div>
          ) : null}

          <div className="mt-3 flex items-end gap-2">
            <div className="flex-1">
              <TextField
                label="Label"
                placeholder="Nick's iPhone"
                maxLength={60}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            <button
              type="button"
              disabled={createToken.isPending}
              className="btn-primary shrink-0 gap-2"
              onClick={() => {
                createToken.mutate(label, {
                  onSuccess: (result) => {
                    setMinted(result.plaintext)
                    setLabel('')
                  },
                })
              }}
            >
              {createToken.isPending ? <Spinner /> : <Plus className="h-4 w-4" aria-hidden />}
              Generate
            </button>
          </div>
        </section>

        {/* ── Existing tokens ───────────────────────────────────────────── */}
        <section aria-labelledby="tokens-heading">
          <h2
            id="tokens-heading"
            className="mb-2 px-1 text-sm font-medium text-larder-700 dark:text-larder-300"
          >
            Your tokens
          </h2>

          {tokensQuery.isPending ? (
            <div className="card space-y-3 p-4" aria-hidden>
              <div className="skeleton h-4 w-32" />
              <div className="skeleton h-3 w-48" />
            </div>
          ) : tokens.length === 0 ? (
            <p className="card px-4 py-6 text-center text-sm text-larder-600 dark:text-larder-400">
              No tokens yet. Generate one above to let Siri talk to this list.
            </p>
          ) : (
            <ul className="card divide-y divide-larder-200 dark:divide-larder-800">
              {tokens.map((token) => (
                <li key={token.id} className="flex items-center gap-3 px-4 py-3">
                  <KeyRound className="h-5 w-5 shrink-0 text-larder-400" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-larder-950 dark:text-larder-50">
                      {token.label}
                      {token.revoked_at ? (
                        <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs font-normal text-red-700 dark:bg-red-950 dark:text-red-300">
                          revoked
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block text-xs text-larder-600 dark:text-larder-400">
                      Created {formatDate(token.created_at)} ·{' '}
                      {token.last_used_at ? `last used ${formatDate(token.last_used_at)}` : 'never used'}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setPendingRevoke(token)}
                    className="tap shrink-0 rounded-xl text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/50"
                    aria-label={`Revoke ${token.label}`}
                  >
                    <Trash2 className="h-5 w-5" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Setup instructions ────────────────────────────────────────── */}
        <section className="card p-5" aria-labelledby="setup-heading">
          <h2 id="setup-heading" className="text-sm font-semibold text-larder-950 dark:text-larder-50">
            Build the Shortcut
          </h2>
          <ol className="mt-3 space-y-3 text-sm text-larder-700 dark:text-larder-300">
            <li>
              <strong>1.</strong> Shortcuts app → <em>+</em> → add the action{' '}
              <em>Get Contents of URL</em>.
            </li>
            <li>
              <strong>2.</strong> URL:
              <CopyRow value={ENDPOINT} onCopy={() => copy(ENDPOINT, 'Endpoint URL')} />
            </li>
            <li>
              <strong>3.</strong> Method: <code className="font-mono">POST</code>
            </li>
            <li>
              <strong>4.</strong> Headers — add two. Key on the left, value on the right:
              {minted ? (
                <CopyRow
                  value={`Bearer ${minted}`}
                  label="Authorization"
                  onCopy={() => copy(`Bearer ${minted}`, 'Authorization value')}
                />
              ) : (
                <span className="mt-1.5 block rounded-lg bg-larder-100 px-2 py-1.5 font-mono text-xs text-larder-600 dark:bg-larder-950 dark:text-larder-400">
                  Authorization: Bearer &lt;generate a token above to copy this&gt;
                </span>
              )}
              <CopyRow
                value="application/json"
                label="Content-Type"
                onCopy={() => copy('application/json', 'Content-Type value')}
              />
            </li>
            <li>
              <strong>5.</strong> Request Body → JSON, with <code className="font-mono">action</code>{' '}
              set to <code className="font-mono">add</code> and <code className="font-mono">text</code>{' '}
              set to a <em>Dictated Text</em> or <em>Ask Each Time</em> variable.
            </li>
            <li>
              <strong>6.</strong> Add <em>Get Dictionary Value</em> for the key{' '}
              <code className="font-mono">spoken</code>, then <em>Speak Text</em> with the result.
            </li>
            <li>
              <strong>7.</strong> Name it something you'd actually say — "Add to Larder" — and
              that phrase becomes the Siri trigger.
            </li>
          </ol>

          <a href="shortcuts://create-shortcut" className="btn-secondary mt-4 w-full gap-2">
            <Mic className="h-4 w-4" aria-hidden />
            Open Shortcuts
          </a>

          <p className="mt-4 text-xs text-larder-600 dark:text-larder-400">
            Set <code className="font-mono">action</code> to{' '}
            <code className="font-mono">read</code> to have Siri read the list back, or{' '}
            <code className="font-mono">check</code> with{' '}
            <code className="font-mono">text</code> to tick something off.
          </p>

          <p className="mt-3 text-xs text-larder-500">
            Larder can't build the shortcut for you: Apple requires imported shortcut files to be
            cryptographically signed, and signing can't happen on-device. These steps are the
            shortest path there is.
          </p>
        </section>
      </div>

      <ConfirmDialog
        open={pendingRevoke !== null}
        title={`Revoke ${pendingRevoke?.label ?? 'this token'}?`}
        body="Any Shortcut using it stops working immediately. This can't be undone."
        confirmLabel="Revoke"
        tone="danger"
        busy={revokeToken.isPending}
        onCancel={() => setPendingRevoke(null)}
        onConfirm={() => {
          const target = pendingRevoke
          setPendingRevoke(null)
          if (!target) return
          revokeToken.mutate(target.id, {
            onSuccess: () => showToast({ message: `${target.label} revoked.` }),
            onError: (error) => showToast({ message: (error as Error).message, tone: 'error' }),
          })
        }}
      />
    </AppShell>
  )
}

function CopyRow({
  value,
  label,
  onCopy,
}: {
  value: string
  label?: string
  onCopy: () => void
}) {
  return (
    <span className="mt-1.5 flex items-center gap-2">
      {label ? (
        <code className="shrink-0 rounded-lg bg-larder-200 px-1.5 py-1.5 font-mono text-[11px] text-larder-800 dark:bg-larder-800 dark:text-larder-200">
          {label}
        </code>
      ) : null}
      <code className="min-w-0 flex-1 break-all rounded-lg bg-larder-100 px-2 py-1.5 font-mono text-xs text-larder-900 dark:bg-larder-950 dark:text-larder-100">
        {value}
      </code>
      <button
        type="button"
        onClick={onCopy}
        className="tap shrink-0 rounded-lg text-larder-500 hover:text-larder-800 dark:hover:text-larder-200"
        aria-label={`Copy ${value}`}
      >
        <Copy className="h-4 w-4" aria-hidden />
      </button>
    </span>
  )
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'unknown'
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}
