import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useUser } from '@/hooks/useAuth'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? ''

export type PushState =
  | 'unsupported'
  | 'needs-install'
  | 'denied'
  | 'unsubscribed'
  | 'subscribed'
  | 'working'

/**
 * VAPID keys are base64url; PushManager wants raw bytes.
 *
 * Returns the ArrayBuffer rather than a Uint8Array view: TypeScript 5.7
 * distinguishes `Uint8Array<ArrayBufferLike>` from `ArrayBufferView<ArrayBuffer>`,
 * and `applicationServerKey` accepts any BufferSource anyway.
 */
function urlBase64ToBuffer(base64: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const normalised = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(normalised)
  const buffer = new ArrayBuffer(raw.length)
  const view = new Uint8Array(buffer)
  for (let i = 0; i < raw.length; i += 1) view[i] = raw.charCodeAt(i)
  return buffer
}

function isStandalone(): boolean {
  if (window.matchMedia('(display-mode: standalone)').matches) return true
  const nav: unknown = window.navigator
  if (typeof nav === 'object' && nav !== null && 'standalone' in nav) {
    return (nav as { standalone?: unknown }).standalone === true
  }
  return false
}

function isIos(): boolean {
  const ua = navigator.userAgent
  return /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

/**
 * Web push for installed PWAs.
 *
 * iOS 16.4+ supports this, but *only* once the app is on the home screen —
 * Safari tabs never receive push, and asking there just burns the permission
 * prompt. That case reports `needs-install` rather than pretending to work.
 */
export function usePushNotifications() {
  const user = useUser()
  const [state, setState] = useState<PushState>('working')

  const refresh = useCallback(async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || VAPID_PUBLIC_KEY === '') {
      setState(isIos() && !isStandalone() ? 'needs-install' : 'unsupported')
      return
    }
    if (isIos() && !isStandalone()) {
      setState('needs-install')
      return
    }
    if (Notification.permission === 'denied') {
      setState('denied')
      return
    }

    const registration = await navigator.serviceWorker.ready
    const existing = await registration.pushManager.getSubscription()
    setState(existing ? 'subscribed' : 'unsubscribed')
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const subscribe = useCallback(async (): Promise<string | null> => {
    if (!user) return 'Sign in first.'
    setState('working')

    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'unsubscribed')
        return permission === 'denied'
          ? 'Notifications are blocked. Turn them back on in your device settings.'
          : null
      }

      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToBuffer(VAPID_PUBLIC_KEY),
      })

      const json = subscription.toJSON()
      const p256dh = json.keys?.p256dh
      const auth = json.keys?.auth
      if (!json.endpoint || !p256dh || !auth) {
        setState('unsubscribed')
        return 'Your browser returned an incomplete subscription.'
      }

      // Replace rather than upsert: the endpoint is unique, and a browser that
      // re-subscribes after a permission reset hands back the same one.
      await supabase.from('push_subscriptions').delete().eq('endpoint', json.endpoint)
      const { error } = await supabase
        .from('push_subscriptions')
        .insert({ user_id: user.id, endpoint: json.endpoint, p256dh, auth })
      if (error) {
        setState('unsubscribed')
        return 'Could not save the subscription. Try again.'
      }

      setState('subscribed')
      return null
    } catch (error) {
      setState('unsubscribed')
      return error instanceof Error ? error.message : 'Could not enable notifications.'
    }
  }, [user])

  const unsubscribe = useCallback(async (): Promise<void> => {
    setState('working')
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      if (subscription) {
        await supabase.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint)
        await subscription.unsubscribe()
      }
    } finally {
      setState('unsubscribed')
    }
  }, [])

  return { state, subscribe, unsubscribe, refresh }
}
