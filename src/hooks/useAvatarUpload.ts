import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { qk } from '@/lib/queryClient'
import { rpcErrorMessage } from '@/lib/authErrors'
import { useUser } from '@/hooks/useAuth'
import { ImageDecodeError, resizeToAvatar } from '@/lib/imageResize'
import type { Profile } from '@/types/database'

const BUCKET = 'avatars'
/** Refuse absurd files before spending time decoding them. */
const MAX_INPUT_BYTES = 15 * 1024 * 1024

export function useUploadAvatar() {
  const user = useUser()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (file: File): Promise<Profile> => {
      if (!user) throw new Error('Your session expired. Sign in again.')
      if (!file.type.startsWith('image/')) {
        throw new Error('Pick an image file — a JPEG, PNG or WebP.')
      }
      if (file.size > MAX_INPUT_BYTES) {
        throw new Error('That image is enormous. Pick one under 15 MB.')
      }

      // Downscale first: the upload is ~20 KB instead of several megabytes,
      // and re-encoding through a canvas strips any EXIF location data.
      let blob: Blob
      try {
        blob = await resizeToAvatar(file)
      } catch (error) {
        throw new Error(
          error instanceof ImageDecodeError
            ? error.message
            : 'That image could not be processed. Try a different one.',
        )
      }

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
