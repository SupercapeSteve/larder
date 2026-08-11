import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { qk } from '@/lib/queryClient'
import { authErrorMessage } from '@/lib/authErrors'
import type { Profile } from '@/types/database'

export type AuthStatus = 'loading' | 'signed-in' | 'signed-out'

type AuthContextValue = {
  status: AuthStatus
  session: Session | null
  user: User | null
  /** True once a recovery link has been consumed and a new password is required. */
  recovering: boolean
  setRecovering: (value: boolean) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [recovering, setRecovering] = useState(false)
  const queryClient = useQueryClient()
  // Guards against React 18 StrictMode double-invocation clearing a live cache.
  const lastUserId = useRef<string | null>(null)

  useEffect(() => {
    let active = true

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active) return
        if (error) {
          // A corrupt/expired persisted session must not wedge the app on a
          // spinner — drop it and show the sign-in screen.
          console.warn('[larder] could not restore session:', authErrorMessage(error))
        }
        setSession(data.session ?? null)
        lastUserId.current = data.session?.user.id ?? null
        setStatus(data.session ? 'signed-in' : 'signed-out')
      })
      .catch(() => {
        if (!active) return
        setSession(null)
        setStatus('signed-out')
      })

    // Never await a Supabase call inside this callback — the auth client holds
    // a lock while dispatching and awaiting inside it deadlocks the SDK.
    const { data: sub } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return

      switch (event) {
        case 'SIGNED_OUT': {
          setSession(null)
          setStatus('signed-out')
          setRecovering(false)
          lastUserId.current = null
          queryClient.clear()
          break
        }
        case 'PASSWORD_RECOVERY': {
          setSession(nextSession)
          setStatus(nextSession ? 'signed-in' : 'signed-out')
          setRecovering(true)
          break
        }
        case 'TOKEN_REFRESHED': {
          // Same user, fresher token. Swap the session and leave the cache
          // alone — throwing it away here would blank the list mid-shop.
          setSession(nextSession)
          break
        }
        case 'SIGNED_IN':
        case 'USER_UPDATED':
        case 'INITIAL_SESSION':
        default: {
          const nextId = nextSession?.user.id ?? null
          if (lastUserId.current !== null && nextId !== null && lastUserId.current !== nextId) {
            queryClient.clear()
          }
          lastUserId.current = nextId
          setSession(nextSession)
          setStatus(nextSession ? 'signed-in' : 'signed-out')
          break
        }
      }
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [queryClient])

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      session,
      user: session?.user ?? null,
      recovering,
      setRecovering,
    }),
    [status, session, recovering],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

/** The signed-in user, or null. Convenience for screens that already know. */
export function useUser(): User | null {
  return useAuth().user
}

/** The signed-in user's profile row (display name for attribution). */
export function useProfile() {
  const user = useUser()
  return useQuery({
    queryKey: qk.profile(user?.id ?? 'anonymous'),
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Profile | null> => {
      if (!user) return null
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })
}
