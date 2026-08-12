import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { qk } from '@/lib/queryClient'

/**
 * Keeps names and avatars fresh across devices.
 *
 * Without this, a profile change only reached other devices on a cold start:
 * the members roster is fetched once, `refetchOnWindowFocus` is off, and
 * nothing invalidated it. Someone would upload a photo on their phone and it
 * would never appear on the laptop that already had the household open.
 *
 * No filter on the subscription — a profile row carries no household column to
 * filter by, and RLS already limits the stream to people the caller shares a
 * household with. Anything else simply never arrives.
 */
export function useRealtimeProfiles(householdId: string | undefined): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!householdId) return

    const channel = supabase
      .channel(`profiles:${householdId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles' },
        () => {
          // The roster is small and this fires rarely — a refetch is simpler
          // and less error-prone than patching a nested cache entry, and it
          // picks up display-name changes at the same time.
          void queryClient.invalidateQueries({ queryKey: qk.members(householdId) })
          void queryClient.invalidateQueries({ queryKey: ['profile'] })
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [householdId, queryClient])
}
