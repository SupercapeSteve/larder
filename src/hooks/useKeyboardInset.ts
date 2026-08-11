import { useEffect, useState } from 'react'

/**
 * How many pixels of the layout viewport the on-screen keyboard is covering.
 *
 * iOS does not resize the layout viewport when the keyboard appears — it
 * shrinks the *visual* viewport and leaves the layout alone. A `sticky` or
 * `fixed` footer is positioned against the layout viewport, so the add-item bar
 * ends up underneath the keyboard: you tap the field, the keyboard covers the
 * thing you were typing into, and the app feels broken.
 *
 * VisualViewport gives us the overlap so the shell can shrink by exactly that
 * much. Returns 0 on browsers without the API, where the keyboard resizes the
 * layout viewport anyway and no correction is needed.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)

  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return

    function update() {
      if (!viewport) return
      const overlap = window.innerHeight - (viewport.height + viewport.offsetTop)
      // Round to avoid a jittery sub-pixel loop as Safari settles.
      const next = Math.max(0, Math.round(overlap))
      setInset((current) => (Math.abs(current - next) > 1 ? next : current))
    }

    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
    }
  }, [])

  return inset
}
