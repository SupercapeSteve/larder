import { useEffect, useState } from 'react'
import { Share, X } from 'lucide-react'
import { readLocal, writeLocal } from '@/lib/storage'

const DISMISSED_KEY = 'installHintDismissed'

/** iOS exposes standalone mode on a non-standard navigator property. */
function isStandalone(): boolean {
  if (window.matchMedia('(display-mode: standalone)').matches) return true
  const nav: unknown = window.navigator
  if (typeof nav === 'object' && nav !== null && 'standalone' in nav) {
    return (nav as { standalone?: unknown }).standalone === true
  }
  return false
}

function isIosSafari(): boolean {
  const ua = window.navigator.userAgent
  const iosDevice = /iPhone|iPad|iPod/i.test(ua)
  // iPadOS 13+ reports itself as a Mac; touch points give it away.
  const iPadOS = window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1
  if (!iosDevice && !iPadOS) return false
  // Chrome/Firefox/Edge on iOS cannot add to the home screen at all.
  return !/CriOS|FxiOS|EdgiOS|OPiOS|mercury/i.test(ua)
}

/**
 * Apple gives web apps no `beforeinstallprompt`, so the only way an iOS user
 * discovers "Add to Home Screen" is if you tell them. Shown once, to the
 * people it applies to, and never again after it is dismissed.
 */
export function InstallHint() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (readLocal(DISMISSED_KEY) === '1') return
    if (isStandalone()) return
    if (!isIosSafari()) return
    // Let the app paint first — an install nag as the very first thing on
    // screen reads as a popup, not as help.
    const timer = setTimeout(() => setVisible(true), 2500)
    return () => clearTimeout(timer)
  }, [])

  if (!visible) return null

  function dismiss() {
    writeLocal(DISMISSED_KEY, '1')
    setVisible(false)
  }

  return (
    <div className="safe-bottom fixed inset-x-0 bottom-0 z-40 px-3 pb-3">
      <div className="animate-toast-in mx-auto flex max-w-md items-start gap-3 rounded-2xl border border-larder-200 bg-white p-4 shadow-lg dark:border-larder-700 dark:bg-larder-900">
        <Share className="mt-0.5 h-5 w-5 shrink-0 text-larder-600 dark:text-larder-400" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-larder-950 dark:text-larder-50">
            Put Larder on your home screen
          </p>
          <p className="mt-1 text-xs text-larder-600 dark:text-larder-400">
            Tap the <strong>Share</strong> button below, then{' '}
            <strong>Add to Home Screen</strong>. It opens full-screen and stays signed in.
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="tap -mr-2 -mt-2 shrink-0 rounded-xl text-larder-400"
          aria-label="Dismiss install hint"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  )
}
