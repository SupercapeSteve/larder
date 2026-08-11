/**
 * Supabase auth errors are written for developers. Users get sentences.
 *
 * Nothing in here ever returns a raw Supabase string — the fallback is a
 * generic, honest message. Codes are matched first (stable across releases),
 * message heuristics second (for older/edge responses).
 */

type ErrorLike = {
  code?: string | undefined
  status?: number | undefined
  message?: string | undefined
  name?: string | undefined
}

function asErrorLike(error: unknown): ErrorLike {
  if (typeof error !== 'object' || error === null) return {}
  const e = error as Record<string, unknown>
  return {
    code: typeof e.code === 'string' ? e.code : undefined,
    status: typeof e.status === 'number' ? e.status : undefined,
    message: typeof e.message === 'string' ? e.message : undefined,
    name: typeof e.name === 'string' ? e.name : undefined,
  }
}

const BY_CODE: Record<string, string> = {
  invalid_credentials: 'That email and password don’t match. Check both and try again.',
  email_not_confirmed:
    'Confirm your email first — we sent you a link when you signed up. Check spam if it’s not there.',
  user_already_exists: 'There’s already an account with that email. Try signing in instead.',
  email_exists: 'There’s already an account with that email. Try signing in instead.',
  weak_password: 'That password is too easy to guess. Use at least 8 characters.',
  same_password: 'That’s already your password. Pick a different one.',
  over_request_rate_limit: 'Too many attempts. Wait a minute and try again.',
  over_email_send_rate_limit: 'We’ve sent a few emails already. Wait a minute before asking for another.',
  validation_failed: 'That doesn’t look like a valid email address.',
  signup_disabled: 'New sign-ups are turned off for this Larder instance.',
  session_not_found: 'Your session expired. Sign in again.',
  refresh_token_not_found: 'Your session expired. Sign in again.',
  otp_expired: 'That link has expired. Request a new one.',
  user_not_found: 'We couldn’t find an account with that email.',
}

const BY_MESSAGE: ReadonlyArray<readonly [RegExp, string]> = [
  [/invalid login credentials/i, 'That email and password don’t match. Check both and try again.'],
  [/email not confirmed/i, 'Confirm your email first — check your inbox for the link we sent.'],
  [/already registered|user already exists/i, 'There’s already an account with that email. Try signing in instead.'],
  [/password should be at least (\d+)/i, 'That password is too short. Use at least 8 characters.'],
  [/unable to validate email address/i, 'That doesn’t look like a valid email address.'],
  [/for security purposes.*after (\d+) seconds?/i, 'Too many attempts. Wait a moment and try again.'],
  [/rate limit/i, 'Too many attempts. Wait a minute and try again.'],
  [/failed to fetch|networkerror|network request failed|load failed/i,
    'Can’t reach Larder right now. Check your connection and try again.'],
  [/token has expired|expired/i, 'That link has expired. Request a new one.'],
]

export function authErrorMessage(error: unknown): string {
  const e = asErrorLike(error)

  if (e.code && BY_CODE[e.code]) return BY_CODE[e.code]

  if (e.message) {
    for (const [pattern, text] of BY_MESSAGE) {
      if (pattern.test(e.message)) return text
    }
  }

  if (e.status === 429) return 'Too many attempts. Wait a minute and try again.'
  if (e.status === 401 || e.status === 403) return 'Your session expired. Sign in again.'
  if (typeof e.status === 'number' && e.status >= 500) {
    return 'Larder’s backend is having a moment. Try again shortly.'
  }

  return 'Something went wrong. Try again — and if it keeps happening, sign out and back in.'
}

/**
 * Errors raised by our own RPCs, which throw bare sentinel strings so the UI
 * can decide the wording.
 */
const RPC_MESSAGES: Record<string, string> = {
  INVALID_CODE: 'No household has that code. Check the letters and try again.',
  NOT_AUTHENTICATED: 'Your session expired. Sign in again.',
  NOT_A_MEMBER: 'You’re not in that household any more.',
  INVALID_NAME: 'Give the household a name first.',
  JOIN_CODE_EXHAUSTED: 'Couldn’t generate a join code. Try again.',
  NOT_OWNER: 'Only an owner can do that.',
  INVALID_ROLE: 'That isn’t a role Larder recognises.',
  LAST_OWNER: 'A household needs at least one owner. Promote somebody else first.',
  LIST_HOUSEHOLD_IMMUTABLE: 'A list can’t be moved to another household.',
  ITEM_LIST_IMMUTABLE: 'An item can’t be moved to another list.',
}

export function rpcErrorMessage(error: unknown): string {
  const e = asErrorLike(error)
  const raw = e.message ?? ''

  for (const [sentinel, text] of Object.entries(RPC_MESSAGES)) {
    if (raw.includes(sentinel)) return text
  }

  if (/duplicate key|already exists/i.test(raw)) return 'You’re already in that household.'
  if (/row-level security|permission denied/i.test(raw)) {
    return 'You don’t have permission to do that.'
  }

  return authErrorMessage(error)
}
