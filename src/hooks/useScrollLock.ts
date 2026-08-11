import { useEffect } from 'react'

/**
 * Freeze the page behind a modal.
 *
 * The app scrolls inside `main.scroll-y`, not on `body`, so the usual
 * `body { overflow: hidden }` trick does nothing here. A class on `body` lets
 * one CSS rule reach whichever scroll container is on screen.
 *
 * Reference-counted: two overlapping modals (an edit sheet that opens a
 * confirm) must not have the first one to close unlock the page.
 */
let lockCount = 0

export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return

    lockCount += 1
    document.body.classList.add('modal-open')

    return () => {
      lockCount -= 1
      if (lockCount <= 0) {
        lockCount = 0
        document.body.classList.remove('modal-open')
      }
    }
  }, [active])
}
