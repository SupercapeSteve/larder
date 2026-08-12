import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { rpcErrorMessage } from '@/lib/authErrors'
import { useUser } from '@/hooks/useAuth'
import type { CategoryRule } from '@/lib/categories'

export const rulesKey = (householdId: string) => ['category-rules', householdId] as const

export type StoredRule = CategoryRule & { updatedAt: string }

export function useCategoryRules(householdId: string | undefined) {
  return useQuery({
    queryKey: rulesKey(householdId ?? 'none'),
    enabled: Boolean(householdId),
    // Rules feed categorisation on every add, so they must not be stale.
    staleTime: 60_000,
    queryFn: async (): Promise<StoredRule[]> => {
      if (!householdId) return []
      const { data, error } = await supabase
        .from('category_rules')
        .select('keyword, category, updated_at')
        .eq('household_id', householdId)
        .order('keyword', { ascending: true })
      if (error) throw error
      return (data ?? []).map((r) => ({
        keyword: r.keyword,
        category: r.category,
        updatedAt: r.updated_at,
      }))
    },
  })
}

/**
 * Teach the household that a phrase belongs in an aisle.
 *
 * Keyed on the item's own name, lowercased — correcting "Red Tortilla Chips"
 * files that exact product next time, without claiming every tortilla is a
 * snack. Broader rules can be trimmed by hand on the Aisles screen.
 */
export function useSaveCategoryRule(householdId: string) {
  const queryClient = useQueryClient()
  const user = useUser()

  return useMutation({
    mutationFn: async ({ keyword, category }: CategoryRule): Promise<void> => {
      const clean = keyword.toLowerCase().trim().slice(0, 100)
      if (clean.length === 0) return

      const { error } = await supabase.from('category_rules').upsert(
        {
          household_id: householdId,
          keyword: clean,
          category,
          created_by: user?.id ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'household_id,keyword' },
      )
      if (error) throw new Error(rpcErrorMessage(error))
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: rulesKey(householdId) })
    },
  })
}

export function useDeleteCategoryRule(householdId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (keyword: string): Promise<void> => {
      const { error } = await supabase
        .from('category_rules')
        .delete()
        .eq('household_id', householdId)
        .eq('keyword', keyword)
      if (error) throw new Error(rpcErrorMessage(error))
    },
    onMutate: async (keyword) => {
      await queryClient.cancelQueries({ queryKey: rulesKey(householdId) })
      const previous = queryClient.getQueryData<StoredRule[]>(rulesKey(householdId))
      queryClient.setQueryData<StoredRule[]>(rulesKey(householdId), (old) =>
        (old ?? []).filter((r) => r.keyword !== keyword),
      )
      return { previous }
    },
    onError: (_e, _keyword, context) => {
      if (context?.previous) queryClient.setQueryData(rulesKey(householdId), context.previous)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: rulesKey(householdId) })
    },
  })
}
