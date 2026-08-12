import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { qk } from '@/lib/queryClient'
import { rpcErrorMessage } from '@/lib/authErrors'
import { useUser } from '@/hooks/useAuth'
import { LAST_HOUSEHOLD_KEY, writeLocal } from '@/lib/storage'
import { toRole, type Role } from '@/lib/permissions'
import { isCreatedHousehold, type CreatedHousehold, type Household, type List } from '@/types/database'

export type HouseholdRole = Role

export type HouseholdSummary = Household & {
  role: HouseholdRole
  memberCount: number
}

export type MemberWithProfile = {
  userId: string
  role: HouseholdRole
  joinedAt: string
  displayName: string
  avatarEmoji: string | null
  avatarColor: string | null
  avatarUrl: string | null
  isYou: boolean
}


/**
 * Every household the signed-in user belongs to.
 *
 * `select('*')` on households is already scoped by RLS to the caller's
 * memberships, so there is no client-side filter to get wrong.
 */
export function useHouseholds() {
  const user = useUser()

  return useQuery({
    queryKey: qk.households(),
    enabled: Boolean(user),
    queryFn: async (): Promise<HouseholdSummary[]> => {
      const [householdsResult, membershipsResult] = await Promise.all([
        supabase.from('households').select('*').order('created_at', { ascending: true }),
        supabase.from('household_members').select('household_id, user_id, role'),
      ])

      if (householdsResult.error) throw householdsResult.error
      if (membershipsResult.error) throw membershipsResult.error

      const memberships = membershipsResult.data ?? []
      const counts = new Map<string, number>()
      const myRole = new Map<string, HouseholdRole>()

      for (const m of memberships) {
        counts.set(m.household_id, (counts.get(m.household_id) ?? 0) + 1)
        if (m.user_id === user?.id) myRole.set(m.household_id, toRole(m.role))
      }

      return (householdsResult.data ?? []).map((h) => ({
        ...h,
        role: myRole.get(h.id) ?? 'member',
        memberCount: counts.get(h.id) ?? 1,
      }))
    },
  })
}

/** Members of one household, with display names resolved for attribution. */
export function useMembers(householdId: string | undefined) {
  const user = useUser()

  return useQuery({
    queryKey: qk.members(householdId ?? 'none'),
    enabled: Boolean(householdId && user),
    // Belt and braces alongside the realtime subscription: if the socket is
    // down (backgrounded on iOS, flaky signal in a shop), coming back to the
    // tab still picks up somebody's new avatar or name.
    refetchOnWindowFocus: true,
    staleTime: 0,
    queryFn: async (): Promise<MemberWithProfile[]> => {
      if (!householdId) return []

      const { data: members, error } = await supabase
        .from('household_members')
        .select('*')
        .eq('household_id', householdId)
        .order('joined_at', { ascending: true })
      if (error) throw error

      const ids = (members ?? []).map((m) => m.user_id)
      if (ids.length === 0) return []

      const { data: profiles, error: profileError } = await supabase
        .from('profiles')
        .select('id, display_name, avatar_emoji, avatar_color, avatar_url')
        .in('id', ids)
      if (profileError) throw profileError

      const byId = new Map((profiles ?? []).map((p) => [p.id, p]))

      return (members ?? []).map((m) => {
        const profile = byId.get(m.user_id)
        return {
          userId: m.user_id,
          role: toRole(m.role),
          joinedAt: m.joined_at,
          displayName: profile?.display_name ?? 'Someone',
          avatarEmoji: profile?.avatar_emoji ?? null,
          avatarColor: profile?.avatar_color ?? null,
          avatarUrl: profile?.avatar_url ?? null,
          isYou: m.user_id === user?.id,
        }
      })
    },
  })
}

/** Lists belonging to a household. Every household has exactly one default. */
export function useLists(householdId: string | undefined) {
  return useQuery({
    queryKey: qk.lists(householdId ?? 'none'),
    enabled: Boolean(householdId),
    queryFn: async (): Promise<List[]> => {
      if (!householdId) return []
      const { data, error } = await supabase
        .from('lists')
        .select('*')
        .eq('household_id', householdId)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: true })
      if (error) throw error
      return data ?? []
    },
  })
}

export function useDefaultList(householdId: string | undefined) {
  const query = useLists(householdId)
  const list = query.data?.find((l) => l.is_default) ?? query.data?.[0] ?? null
  return { ...query, list }
}

/* ── Mutations ────────────────────────────────────────────────────────────── */

export function useCreateHousehold() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (name: string): Promise<CreatedHousehold> => {
      const { data, error } = await supabase.rpc('create_household', { p_name: name })
      if (error) throw new Error(rpcErrorMessage(error))
      if (!isCreatedHousehold(data)) {
        throw new Error('Larder created the household but got an unexpected reply. Reload and check.')
      }
      return data
    },
    onSuccess: (created) => {
      writeLocal(LAST_HOUSEHOLD_KEY, created.household_id)
      void queryClient.invalidateQueries({ queryKey: qk.households() })
      void queryClient.invalidateQueries({ queryKey: qk.lists(created.household_id) })
    },
  })
}

export function useJoinHousehold() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (code: string): Promise<string> => {
      const trimmed = code.trim().toUpperCase()
      if (trimmed.length !== 6) throw new Error('Join codes are six characters long.')

      const { data, error } = await supabase.rpc('join_household_by_code', { code: trimmed })
      if (error) throw new Error(rpcErrorMessage(error))
      if (typeof data !== 'string') throw new Error('That code didn’t work. Check it and try again.')
      return data
    },
    onSuccess: (householdId) => {
      writeLocal(LAST_HOUSEHOLD_KEY, householdId)
      void queryClient.invalidateQueries({ queryKey: qk.households() })
      void queryClient.invalidateQueries({ queryKey: qk.members(householdId) })
      void queryClient.invalidateQueries({ queryKey: qk.lists(householdId) })
    },
  })
}

/**
 * Rename a household. No RPC needed — `households_update_owner` already gates
 * UPDATE on ownership, so a non-owner's write matches zero rows.
 */
export function useRenameHousehold(householdId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (name: string): Promise<Household> => {
      const trimmed = name.trim()
      if (trimmed.length === 0) throw new Error('Give the household a name.')

      const { data, error } = await supabase
        .from('households')
        .update({ name: trimmed.slice(0, 60) })
        .eq('id', householdId)
        .select('*')
        .maybeSingle()
      if (error) throw new Error(rpcErrorMessage(error))
      if (!data) throw new Error('Only an owner can rename this household.')
      return data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.households() })
    },
  })
}

/** Rotate the invite code. Owner-only, enforced inside the definer RPC. */
export function useRegenerateJoinCode(householdId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (): Promise<string> => {
      const { data, error } = await supabase.rpc('regenerate_join_code', { hid: householdId })
      if (error) throw new Error(rpcErrorMessage(error))
      if (typeof data !== 'string') throw new Error('Couldn’t generate a new code. Try again.')
      return data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.households() })
    },
  })
}

/**
 * Promote or demote a member. Clients hold no UPDATE privilege on
 * household_members — granting it is what re-opens the self-promotion hole —
 * so this goes through a definer RPC that also guards the last-owner case.
 */
export function useSetMemberRole(householdId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: HouseholdRole }): Promise<void> => {
      const { error } = await supabase.rpc('set_member_role', {
        hid: householdId,
        target: userId,
        new_role: role,
      })
      if (error) throw new Error(rpcErrorMessage(error))
    },
    onMutate: async ({ userId, role }) => {
      await queryClient.cancelQueries({ queryKey: qk.members(householdId) })
      const previous = queryClient.getQueryData<MemberWithProfile[]>(qk.members(householdId))
      queryClient.setQueryData<MemberWithProfile[]>(qk.members(householdId), (old) =>
        (old ?? []).map((m) => (m.userId === userId ? { ...m, role } : m)),
      )
      return { previous }
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(qk.members(householdId), context.previous)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.members(householdId) })
      void queryClient.invalidateQueries({ queryKey: qk.households() })
    },
  })
}

export function useLeaveHousehold() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (householdId: string): Promise<void> => {
      const { error } = await supabase.rpc('leave_household', { hid: householdId })
      if (error) throw new Error(rpcErrorMessage(error))
    },
    onSuccess: () => {
      // Membership changes ripple through lists, items and members — a full
      // reset is cheaper to reason about than surgical invalidation here.
      queryClient.clear()
    },
  })
}

export function useRemoveMember(householdId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (userId: string): Promise<void> => {
      const { error } = await supabase
        .from('household_members')
        .delete()
        .eq('household_id', householdId)
        .eq('user_id', userId)
      if (error) throw new Error(rpcErrorMessage(error))
    },
    onMutate: async (userId) => {
      await queryClient.cancelQueries({ queryKey: qk.members(householdId) })
      const previous = queryClient.getQueryData<MemberWithProfile[]>(qk.members(householdId))
      queryClient.setQueryData<MemberWithProfile[]>(qk.members(householdId), (old) =>
        (old ?? []).filter((m) => m.userId !== userId),
      )
      return { previous }
    },
    onError: (_error, _userId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(qk.members(householdId), context.previous)
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.members(householdId) })
      void queryClient.invalidateQueries({ queryKey: qk.households() })
    },
  })
}
