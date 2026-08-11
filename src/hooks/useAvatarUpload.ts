import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { qk } from '@/lib/queryClient'
import { rpcErrorMessage } from '@/lib/authErrors'
import { useUser } from '@/hooks/useAuth'
import type { Profile } from '@/types/database'

const BUCKET = 'avatars'

export function useUploadAvatar() {
  const user = useUser()
  const queryClient = useQueryClient()

  return useMutation({
    // Takes an already-cropped 256×256 JPEG from ImageCropper, not a raw file:
    // the user chooses the framing, so the crop cannot be decided here.
    mutationFn: async (blob: Blob): Promise<Profile> => {
      if (!user) throw new Error('Your session expired. Sign in again.')

      // One object per user, overwritten in place. Keeps storage from growing
      // without bound as somebody tries six photos in a row.
      const path = `${user.id}/avatar.jpg`

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, blob, { contentType: 'image/jpeg', upsert: true, cacheControl: '3600' })
      if (uploadError) throw new Error(rpcErrorMessage(uploadError))

      const {
        data: { publicUrl },
      } = supabase.storage.from(BUCKET).getPublicUrl(path)

      // A cache-buster: the path never changes, so without this the browser
      // and the CDN would both keep serving the previous picture.
      const versioned = `${publicUrl}?v=${Date.now()}`

      const { data, error } = await supabase
        .from('profiles')
        .update({ avatar_url: versioned })
        .eq('id', user.id)
        .select('*')
        .single()
      if (error) throw new Error(rpcErrorMessage(error))

      return data
    },
    onSuccess: (profile) => {
      queryClient.setQueryData(qk.profile(profile.id), profile)
      void queryClient.invalidateQueries({ queryKey: ['members'] })
    },
  })
}

export function useRemoveAvatar() {
  const user = useUser()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (): Promise<Profile> => {
      if (!user) throw new Error('Your session expired. Sign in again.')

      // Clear the pointer first. If the object delete fails we are left with an
      // orphaned file, which is harmless; the reverse would leave a profile
      // pointing at a 404.
      const { data, error } = await supabase
        .from('profiles')
        .update({ avatar_url: null })
        .eq('id', user.id)
        .select('*')
        .single()
      if (error) throw new Error(rpcErrorMessage(error))

      await supabase.storage.from(BUCKET).remove([`${user.id}/avatar.jpg`])

      return data
    },
    onSuccess: (profile) => {
      queryClient.setQueryData(qk.profile(profile.id), profile)
      void queryClient.invalidateQueries({ queryKey: ['members'] })
    },
  })
}
