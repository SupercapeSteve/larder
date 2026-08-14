import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { rpcErrorMessage } from '@/lib/authErrors'

export type Staple = {
  nameKey: string
  name: string
  category: string | null
  quantity: string | null
  timesBought: number
  lastBoughtAt: string
}

export const historyKey = (householdId: string) => ['purchase-history', householdId] as const

/**
 * What this household actually buys, most-frequent first.
 *
 * Recorded by a trigger when an item is ticked, so it survives "clear checked"
 * — which hard-deletes and previously destroyed any record of what you buy.
 */
export function usePurchaseHistory(householdId: string | undefined) {
  return useQuery({
    queryKey: historyKey(householdId ?? 'none'),
    enabled: Boolean(householdId),
    staleTime: 60_000,
    queryFn: async (): Promise<Staple[]> => {
      if (!householdId) return []
      const { data, error } = await supabase
        .from('purchase_history')
        .select('name_key, name, category, quantity, times_bought, last_bought_at')
        .eq('household_id', householdId)
        .order('times_bought', { ascending: false })
        .order('last_bought_at', { ascending: false })
        .limit(60)
      if (error) throw error
      return (data ?? []).map((r) => ({
        nameKey: r.name_key,
        name: r.name,
        category: r.category,
        quantity: r.quantity,
        timesBought: r.times_bought,
        lastBoughtAt: r.last_bought_at,
      }))
    },
  })
}

export function useForgetStaple(householdId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (nameKey: string): Promise<void> => {
      const { error } = await supabase
        .from('purchase_history')
        .delete()
        .eq('household_id', householdId)
        .eq('name_key', nameKey)
      if (error) throw new Error(rpcErrorMessage(error))
    },
    onMutate: async (nameKey) => {
      await queryClient.cancelQueries({ queryKey: historyKey(householdId) })
      const previous = queryClient.getQueryData<Staple[]>(historyKey(householdId))
      queryClient.setQueryData<Staple[]>(historyKey(householdId), (old) =>
        (old ?? []).filter((s) => s.nameKey !== nameKey),
      )
      return { previous }
    },
    onError: (_e, _k, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(historyKey(householdId), ctx.previous)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: historyKey(householdId) })
    },
  })
}
