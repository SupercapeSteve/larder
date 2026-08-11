import { QueryClient } from '@tanstack/react-query'

/**
 * Realtime is the primary freshness mechanism, so aggressive polling would be
 * wasted work. Instead we keep data fresh for a short window and reconcile
 * explicitly on reconnect / tab-visible (see `useRealtimeItems`).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      retry: (failureCount, error) => {
        // Never retry an auth/permission failure — it will never succeed.
        const message = error instanceof Error ? error.message.toLowerCase() : ''
        if (message.includes('jwt') || message.includes('permission')) return false
        return failureCount < 2
      },
    },
    mutations: {
      retry: 0,
    },
  },
})

/* ── Query keys ───────────────────────────────────────────────────────────── */

export const qk = {
  profile: (userId: string) => ['profile', userId] as const,
  households: () => ['households'] as const,
  household: (id: string) => ['household', id] as const,
  members: (householdId: string) => ['members', householdId] as const,
  lists: (householdId: string) => ['lists', householdId] as const,
  items: (listId: string) => ['items', listId] as const,
  tokens: () => ['api-tokens'] as const,
} as const
