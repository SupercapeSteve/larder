import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

/**
 * Catches an emailed auth link that landed on the wrong route.
 *
 * Supabase replaces a `redirect_to` it does not recognise with the project's
 * Site URL — silently, with no error. The tokens then arrive on `/`, where
 * nothing consumes them, and the link looks broken. That is exactly what was
 * happening before the redirect allow-list was fixed.
 *
 * The allow-list is correct now, so this should never fire. It stays as a
 * safety net: a new deploy origin, a preview URL, or somebody re-pointing the
 * Site URL would otherwise reintroduce a silent, confusing failure. Routing on
 * the fragment costs nothing and keeps the link working anywhere.
 */
export function useAuthLinkLanding(): void {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    const raw = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : ''
    if (raw.length === 0) return

    const params = new URLSearchParams(raw)
    const hasTokens = params.has('access_token')
    const hasError = params.has('error_description') || params.has('error_code')
    if (!hasTokens && !hasError) return

    // These two routes already know how to consume a fragment.
    if (location.pathname === '/update-password' || location.pathname === '/confirm') return

    // `recovery` gets the password screen, which offers a fresh link on
    // failure. Everything else — signup, email change, a bare error — goes to
    // the confirmation screen, which explains itself either way.
    const target = params.get('type') === 'recovery' ? '/update-password' : '/confirm'

    navigate(`${target}${window.location.hash}`, { replace: true })
  }, [navigate, location.pathname])
}
