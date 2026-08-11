import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import { Check, Minus, Plus, RotateCcw, X } from 'lucide-react'
import { ErrorBanner, Spinner } from '@/components/ui'
import { useScrollLock } from '@/hooks/useScrollLock'
import {
  cropToAvatarBlob,
  loadImageFromFile,
  ImageDecodeError,
  type SourceCrop,
} from '@/lib/imageResize'

const MAX_ZOOM = 5
const ZOOM_STEP = 0.25

type ImageCropperProps = {
  file: File | null
  busy?: boolean
  onCancel: () => void
  onConfirm: (blob: Blob) => void
}

type Transform = {
  /** Multiplier on top of the cover-fit scale. 1 = image exactly fills frame. */
  zoom: number
  /** Image top-left offset from the frame's top-left, in CSS pixels. */
  tx: number
  ty: number
}

/**
 * Square pan-and-zoom cropper.
 *
 * The image is always constrained to cover the frame, so the crop can never
 * include empty space — which would come out as black in a JPEG. That
 * invariant is enforced in `clampTransform`, and every gesture routes through
 * it rather than each handler re-deriving the limits.
 *
 * Built from pointer events rather than a library: the stack is fixed, and the
 * whole behaviour is one clamp function plus some arithmetic.
 */
export function ImageCropper({ file, busy = false, onCancel, onConfirm }: ImageCropperProps) {
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [frame, setFrame] = useState(0)
  const [transform, setTransform] = useState<Transform>({ zoom: 1, tx: 0, ty: 0 })

  const frameRef = useRef<HTMLDivElement>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinchStart = useRef<{ distance: number; zoom: number } | null>(null)

  useScrollLock(file !== null)

  /** Scale at which the image exactly covers the frame. */
  const baseScale =
    image && frame > 0 ? Math.max(frame / image.naturalWidth, frame / image.naturalHeight) : 1

  const clampTransform = useCallback(
    (next: Transform, img: HTMLImageElement, frameSize: number): Transform => {
      const zoom = Math.min(MAX_ZOOM, Math.max(1, next.zoom))
      const scale = Math.max(frameSize / img.naturalWidth, frameSize / img.naturalHeight) * zoom
      const width = img.naturalWidth * scale
      const height = img.naturalHeight * scale

      // Left/top may not exceed 0, and right/bottom may not fall short of the
      // frame — together that means the image always covers it.
      return {
        zoom,
        tx: Math.min(0, Math.max(frameSize - width, next.tx)),
        ty: Math.min(0, Math.max(frameSize - height, next.ty)),
      }
    },
    [],
  )

  const centre = useCallback(
    (img: HTMLImageElement, frameSize: number, zoom = 1): Transform => {
      const scale = Math.max(frameSize / img.naturalWidth, frameSize / img.naturalHeight) * zoom
      return {
        zoom,
        tx: (frameSize - img.naturalWidth * scale) / 2,
        ty: (frameSize - img.naturalHeight * scale) / 2,
      }
    },
    [],
  )

  // Decode the picked file.
  useEffect(() => {
    if (!file) {
      setImage(null)
      setError(null)
      return
    }

    let active = true
    setLoading(true)
    setError(null)

    loadImageFromFile(file)
      .then((loaded) => {
        if (!active) return
        setImage(loaded)
        setLoading(false)
      })
      .catch((e) => {
        if (!active) return
        setError(e instanceof ImageDecodeError ? e.message : 'That image could not be opened.')
        setLoading(false)
      })

    return () => {
      active = false
    }
  }, [file])

  // Measure the frame, and re-measure on rotation or resize.
  useEffect(() => {
    if (!file) return
    const element = frameRef.current
    if (!element) return

    function measure() {
      const size = element?.clientWidth ?? 0
      if (size > 0) setFrame(size)
    }
    measure()

    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [file, image])

  // Start centred once both the image and the frame size are known.
  useEffect(() => {
    if (!image || frame <= 0) return
    setTransform(centre(image, frame))
  }, [image, frame, centre])

  function applyZoom(nextZoom: number, anchorX: number, anchorY: number) {
    if (!image || frame <= 0) return
    setTransform((current) => {
      const clampedZoom = Math.min(MAX_ZOOM, Math.max(1, nextZoom))
      const ratio = clampedZoom / current.zoom
      // Keep whatever is under the anchor point pinned there while zooming.
      return clampTransform(
        {
          zoom: clampedZoom,
          tx: anchorX - (anchorX - current.tx) * ratio,
          ty: anchorY - (anchorY - current.ty) * ratio,
        },
        image,
        frame,
      )
    })
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!image) return
    event.currentTarget.setPointerCapture(event.pointerId)
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinchStart.current = {
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        zoom: transform.zoom,
      }
    }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!image || frame <= 0) return
    const previous = pointers.current.get(event.pointerId)
    if (!previous) return

    const current = { x: event.clientX, y: event.clientY }
    pointers.current.set(event.pointerId, current)

    if (pointers.current.size >= 2 && pinchStart.current) {
      const [a, b] = [...pointers.current.values()]
      const distance = Math.hypot(a.x - b.x, a.y - b.y)
      if (pinchStart.current.distance > 0) {
        const rect = frameRef.current?.getBoundingClientRect()
        const midX = (a.x + b.x) / 2 - (rect?.left ?? 0)
        const midY = (a.y + b.y) / 2 - (rect?.top ?? 0)
        applyZoom(pinchStart.current.zoom * (distance / pinchStart.current.distance), midX, midY)
      }
      return
    }

    const dx = current.x - previous.x
    const dy = current.y - previous.y
    setTransform((t) => clampTransform({ ...t, tx: t.tx + dx, ty: t.ty + dy }, image, frame))
  }

  function endPointer(event: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId)
    if (pointers.current.size < 2) pinchStart.current = null
  }

  function onWheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (!image) return
    const rect = frameRef.current?.getBoundingClientRect()
    const anchorX = event.clientX - (rect?.left ?? 0)
    const anchorY = event.clientY - (rect?.top ?? 0)
    applyZoom(transform.zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12), anchorX, anchorY)
  }

  /** Convert the on-screen transform into a rect in the source image. */
  function currentCrop(): SourceCrop | null {
    if (!image || frame <= 0) return null
    const scale = baseScale * transform.zoom
    return {
      sx: -transform.tx / scale,
      sy: -transform.ty / scale,
      size: frame / scale,
    }
  }

  async function confirm() {
    const crop = currentCrop()
    if (!image || !crop) return
    try {
      const blob = await cropToAvatarBlob(image, crop)
      onConfirm(blob)
    } catch (e) {
      setError(e instanceof ImageDecodeError ? e.message : 'That image could not be processed.')
    }
  }

  useEffect(() => {
    if (!file) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [file, onCancel])

  if (!file) return null

  const scale = baseScale * transform.zoom
  const width = image ? image.naturalWidth * scale : 0
  const height = image ? image.naturalHeight * scale : 0

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Cancel"
        className="animate-backdrop-in absolute inset-0 bg-black/60"
        onClick={onCancel}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cropper-title"
        className="safe-bottom animate-sheet-in relative w-full max-w-md rounded-t-3xl bg-white p-5 shadow-2xl dark:bg-larder-900 sm:m-3 sm:rounded-2xl"
      >
        <div
          aria-hidden
          className="mx-auto mb-4 h-1 w-9 rounded-full bg-larder-300 dark:bg-larder-700 sm:hidden"
        />

        <div className="mb-4 flex items-center justify-between">
          <h2 id="cropper-title" className="text-lg font-semibold text-larder-950 dark:text-larder-50">
            Position your photo
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="tap -mr-2 rounded-xl text-larder-500"
            aria-label="Cancel"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {error ? (
          <div className="mb-4">
            <ErrorBanner>{error}</ErrorBanner>
          </div>
        ) : null}

        {/* ── Crop frame ────────────────────────────────────────────────── */}
        <div
          ref={frameRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          onWheel={onWheel}
          className="relative mx-auto aspect-square w-full max-w-[320px] cursor-grab touch-none select-none overflow-hidden rounded-2xl bg-larder-950 active:cursor-grabbing"
        >
          {loading || !image ? (
            <div className="flex h-full items-center justify-center">
              <Spinner className="h-6 w-6 text-larder-400" />
            </div>
          ) : (
            <>
              <img
                src={image.src}
                alt=""
                draggable={false}
                className="absolute max-w-none select-none"
                style={{
                  width: `${width}px`,
                  height: `${height}px`,
                  left: `${transform.tx}px`,
                  top: `${transform.ty}px`,
                }}
              />
              {/* Circular mask showing the avatar shape, without clipping the
                  square that actually gets saved. */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-2xl"
                style={{
                  boxShadow: 'inset 0 0 0 9999px rgba(0,0,0,0.45)',
                  clipPath:
                    'polygon(0% 0%, 0% 100%, 100% 100%, 100% 0%, 0% 0%, 50% 0%, 100% 50%, 50% 100%, 0% 50%, 50% 0%)',
                }}
              />
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-full border-2 border-white/80"
              />
            </>
          )}
        </div>

        <p className="mt-3 text-center text-xs text-larder-600 dark:text-larder-400">
          Drag to move · pinch or use the slider to zoom
        </p>

        {/* ── Zoom ──────────────────────────────────────────────────────── */}
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => applyZoom(transform.zoom - ZOOM_STEP, frame / 2, frame / 2)}
            disabled={!image || transform.zoom <= 1}
            className="tap shrink-0 rounded-xl text-larder-600 disabled:opacity-30 dark:text-larder-400"
            aria-label="Zoom out"
          >
            <Minus className="h-5 w-5" aria-hidden />
          </button>

          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={transform.zoom}
            disabled={!image}
            onChange={(e) => applyZoom(Number(e.target.value), frame / 2, frame / 2)}
            aria-label="Zoom"
            className="h-11 flex-1 accent-larder-600 dark:accent-larder-400"
          />

          <button
            type="button"
            onClick={() => applyZoom(transform.zoom + ZOOM_STEP, frame / 2, frame / 2)}
            disabled={!image || transform.zoom >= MAX_ZOOM}
            className="tap shrink-0 rounded-xl text-larder-600 disabled:opacity-30 dark:text-larder-400"
            aria-label="Zoom in"
          >
            <Plus className="h-5 w-5" aria-hidden />
          </button>

          <button
            type="button"
            onClick={() => image && frame > 0 && setTransform(centre(image, frame))}
            disabled={!image}
            className="tap shrink-0 rounded-xl text-larder-600 disabled:opacity-30 dark:text-larder-400"
            aria-label="Reset position"
          >
            <RotateCcw className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="mt-5 flex gap-2">
          <button type="button" onClick={onCancel} className="btn-secondary flex-1">
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={!image || busy}
            className="btn-primary flex-1 gap-2"
          >
            {busy ? <Spinner /> : <Check className="h-4 w-4" aria-hidden />}
            Use photo
          </button>
        </div>
      </div>
    </div>
  )
}
