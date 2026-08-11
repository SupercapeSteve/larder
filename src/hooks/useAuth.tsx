import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { qk } from '@/lib/queryClient'
import { authErrorMessage } from '@/lib/authErrors'
import type { Profile, TablesUpdate } from '@/types/database'

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

export type ProfileEdits = {
  displayName?: string
  avatarEmoji?: string | null
  avatarColor?: string | null
  avatarUrl?: string | null
}

/**
 * Edit your own profile — name and avatar.
 *
 * The display name and avatar are what housemates see next to every item you
 * add, so both are worth changing without making a new account.
 */
export function useUpdateProfile() {
  const user = useUser()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (edits: ProfileEdits): Promise<Profile> => {
      if (!user) throw new Error('Your session expired. Sign in again.')

      // Typed against the table so a typo in a column name fails to compile
      // rather than silently no-opping at runtime.
      const patch: TablesUpdate<'profiles'> = {}

      if (edits.displayName !== undefined) {
        const trimmed = edits.displayName.trim()
        if (trimmed.length === 0) throw new Error('Your name can’t be empty.')
        patch.display_name = trimmed.slice(0, 60)
      }
      if (edits.avatarEmoji !== undefined) patch.avatar_emoji = edits.avatarEmoji
      if (edits.avatarColor !== undefined) patch.avatar_color = edits.avatarColor
      if (edits.avatarUrl !== undefined) patch.avatar_url = edits.avatarUrl

      const { data, error } = await supabase
        .from('profiles')
        .update(patch)
        .eq('id', user.id)
        .select('*')
        .single()
      if (error) throw new Error(authErrorMessage(error))

      // Keep the sign-up metadata in step, so a future trigger run agrees.
      if (typeof patch.display_name === 'string') {
        await supabase.auth.updateUser({ data: { display_name: patch.display_name } })
      }

      return data
    },
    onSuccess: (profile) => {
      queryClient.setQueryData(qk.profile(profile.id), profile)
      // Attribution across the app reads from the members list.
      void queryClient.invalidateQueries({ queryKey: ['members'] })
    },
  })
}
