import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { FullPageSpinner } from '@/components/ui'

/**
 * Gate for everything behind sign-in.
 *
 * `status === 'loading'` covers the moment between page load and the persisted
 * session being restored. Redirecting during that window would bounce a
 * signed-in user to the sign-in screen on every cold start of the PWA.
 */
export function ProtectedRoute() {
  const { status, recovering } = useAuth()
  const location = useLocation()

  if (status === 'loading') return <FullPageSpinner label="Opening your Larder" />

  if (status === 'signed-out') {
    return <Navigate to="/signin" replace state={{ from: location.pathname }} />
  }

  // A recovery link establishes a session, but the user has not proved they
  // know a password yet. Park them on the password screen until they set one.
  if (recovering && location.pathname !== '/update-password') {
    return <Navigate to="/update-password" replace />
  }

  return <Outlet />
}

/** Inverse gate: sign-in / sign-up should not be reachable while signed in. */
export function PublicOnlyRoute() {
  const { status, recovering } = useAuth()

  if (status === 'loading') return <FullPageSpinner label="Opening your Larder" />
  if (status === 'signed-in' && !recovering) return <Navigate to="/" replace />

  return <Outlet />
}
