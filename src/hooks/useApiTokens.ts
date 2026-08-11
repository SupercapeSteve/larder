import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { qk } from '@/lib/queryClient'
import { rpcErrorMessage } from '@/lib/authErrors'
import { useUser } from '@/hooks/useAuth'
import { generateToken, hashToken } from '@/lib/tokens'
import type { ApiToken } from '@/types/database'

export function useApiTokens(listId: string | undefined) {
  const user = useUser()

  return useQuery({
    queryKey: [...qk.tokens(), listId ?? 'none'],
    enabled: Boolean(listId && user),
    queryFn: async (): Promise<ApiToken[]> => {
      if (!listId) return []
      const { data, error } = await supabase
        .from('api_tokens')
        .select('*')
        .eq('list_id', listId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
  })
}

export type MintedToken = {
  plaintext: string
  row: ApiToken
}

export function useCreateApiToken(listId: string) {
  const queryClient = useQueryClient()
  const user = useUser()

  return useMutation({
    mutationFn: async (label: string): Promise<MintedToken> => {
      if (!user) throw new Error('Your session expired. Sign in again.')

      const plaintext = generateToken()
      const token_hash = await hashToken(plaintext)

      const { data, error } = await supabase
        .from('api_tokens')
        .insert({
          user_id: user.id,
          list_id: listId,
          token_hash,
          label: label.trim().length > 0 ? label.trim().slice(0, 60) : 'Siri Shortcut',
        })
        .select('*')
        .single()
      if (error) throw new Error(rpcErrorMessage(error))

      return { plaintext, row: data }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.tokens() })
    },
  })
}

export function useRevokeApiToken() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (tokenId: string): Promise<void> => {
      // A hard delete, not a revoked_at stamp: there is no audit requirement
      // here, and a row that cannot be redeemed is better than one that can be
      // un-revoked by whoever holds the account.
      const { error } = await supabase.from('api_tokens').delete().eq('id', tokenId)
      if (error) throw new Error(rpcErrorMessage(error))
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.tokens() })
    },
  })
}
