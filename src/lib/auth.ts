import { supabase } from '@/lib/supabase'
import { authErrorMessage } from '@/lib/authErrors'

export const MIN_PASSWORD_LENGTH = 8

export type AuthResult =
  | { ok: true; needsEmailConfirmation?: boolean }
  | { ok: false; message: string }

export function validateEmail(value: string): string | null {
  const email = value.trim()
  if (email.length === 0) return 'Enter your email address.'
  // Deliberately permissive — the server is the authority on deliverability.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'That doesn’t look like a valid email address.'
  return null
}

export function validatePassword(value: string): string | null {
  if (value.length === 0) return 'Enter a password.'
  if (value.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`
  }
  return null
}

export async function signUp(params: {
  email: string
  password: string
  displayName: string
}): Promise<AuthResult> {
  const displayName = params.displayName.trim()
  if (displayName.length === 0) return { ok: false, message: 'Tell us what to call you.' }

  const { data, error } = await supabase.auth.signUp({
    email: params.email.trim(),
    password: params.password,
    options: {
      // Read by the handle_new_user trigger to seed public.profiles.
      data: { display_name: displayName.slice(0, 60) },
      emailRedirectTo: `${window.location.origin}/signin`,
    },
  })

  if (error) return { ok: false, message: authErrorMessage(error) }

  // Supabase returns a user with no session when email confirmation is on.
  return { ok: true, needsEmailConfirmation: data.session === null }
}

export async function signIn(params: { email: string; password: string }): Promise<AuthResult> {
  const { error } = await supabase.auth.signInWithPassword({
    email: params.email.trim(),
    password: params.password,
  })
  if (error) return { ok: false, message: authErrorMessage(error) }
  return { ok: true }
}

export async function signOut(): Promise<AuthResult> {
  const { error } = await supabase.auth.signOut()
  if (error) return { ok: false, message: authErrorMessage(error) }
  return { ok: true }
}

export async function requestPasswordReset(email: string): Promise<AuthResult> {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: `${window.location.origin}/update-password`,
  })
  if (error) return { ok: false, message: authErrorMessage(error) }
  return { ok: true }
}

export async function updatePassword(newPassword: string): Promise<AuthResult> {
  const problem = validatePassword(newPassword)
  if (problem) return { ok: false, message: problem }

  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) return { ok: false, message: authErrorMessage(error) }
  return { ok: true }
}

/**
 * Consume a recovery link's tokens.
 *
 * `detectSessionInUrl` is off globally so that no stray URL can ever establish
 * a session behind the user's back. The recovery route opts in explicitly.
 * Implicit flow puts the tokens in the fragment, which — unlike a PKCE code —
 * needs no verifier from the originating browser, so the link still works when
 * iOS opens it in Safari rather than the installed app.
 */
export async function consumeRecoveryLink(): Promise<
  { ok: true; consumed: boolean } | { ok: false; message: string }
> {
  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : ''
  if (hash.length === 0) return { ok: true, consumed: false }

  const params = new URLSearchParams(hash)

  const errorDescription = params.get('error_description')
  if (errorDescription) {
    // Supabase URL-encodes a human sentence here; still route it through the
    // mapper so the user never sees a raw backend string.
    return { ok: false, message: authErrorMessage({ message: errorDescription }) }
  }

  const accessToken = params.get('access_token')
  const refreshToken = params.get('refresh_token')
  if (!accessToken || !refreshToken) return { ok: true, consumed: false }

  const { error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  })

  // Strip the tokens out of the address bar either way.
  window.history.replaceState(null, '', window.location.pathname + window.location.search)

  if (error) return { ok: false, message: authErrorMessage(error) }
  return { ok: true, consumed: true }
}
