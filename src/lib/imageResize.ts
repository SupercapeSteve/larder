/**
 * Downscale an image in the browser before uploading it.
 *
 * A phone photo is 3–8 MB and 4000px wide; an avatar is displayed at 64px. The
 * upload should reflect the second number, not the first. Resizing client-side
 * means we never spend the user's data on pixels that get thrown away, never
 * store an original that could contain EXIF GPS, and stay well inside the
 * bucket's 2 MB ceiling.
 *
 * Re-encoding through a canvas also strips EXIF entirely, which is the point:
 * a photo straight from the camera roll can carry the location it was taken.
 */

export const AVATAR_SIZE_PX = 256
const MIME = 'image/jpeg'
const QUALITY = 0.85

export class ImageDecodeError extends Error {
  constructor() {
    super('That file could not be read as an image. Try a JPEG or PNG.')
    this.name = 'ImageDecodeError'
  }
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new ImageDecodeError())
    }
    image.src = url
  })
}

/**
 * Square, centre-cropped, 256×256 JPEG. Typically lands around 15–30 KB.
 */
export async function resizeToAvatar(file: File): Promise<Blob> {
  const image = await loadImage(file)

  const canvas = document.createElement('canvas')
  canvas.width = AVATAR_SIZE_PX
  canvas.height = AVATAR_SIZE_PX

  const context = canvas.getContext('2d')
  if (!context) throw new ImageDecodeError()

  // Centre-crop to a square so faces are not squashed by an aspect change.
  const side = Math.min(image.naturalWidth, image.naturalHeight)
  const sx = (image.naturalWidth - side) / 2
  const sy = (image.naturalHeight - side) / 2

  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, sx, sy, side, side, 0, 0, AVATAR_SIZE_PX, AVATAR_SIZE_PX)

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, MIME, QUALITY)
  })

  if (!blob) throw new ImageDecodeError()
  return blob
}
