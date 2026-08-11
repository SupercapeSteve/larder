/**
 * Image handling for avatars.
 *
 * The final upload is always a 256×256 JPEG — an avatar renders at 64px, so a
 * 4000px phone photo would be spending the user's data on pixels nobody sees.
 *
 * Re-encoding through a canvas also strips EXIF entirely, which matters: a
 * photo straight from the camera roll can carry the GPS coordinates where it
 * was taken, and the avatars bucket is public-read.
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

/** Decode a picked file into something we can measure and draw. */
export function loadImageFromFile(file: File): Promise<HTMLImageElement> {
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

/** A square region of the source image, in the source's own pixel space. */
export type SourceCrop = {
  sx: number
  sy: number
  size: number
}

/**
 * Render the chosen square of the source image to a 256×256 JPEG.
 * Typically lands around 15–30 KB.
 */
export async function cropToAvatarBlob(
  image: HTMLImageElement,
  crop: SourceCrop,
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = AVATAR_SIZE_PX
  canvas.height = AVATAR_SIZE_PX

  const context = canvas.getContext('2d')
  if (!context) throw new ImageDecodeError()

  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'

  // Clamp defensively — a rect that runs off the edge of the source draws
  // transparent pixels, which become black in a JPEG.
  const size = Math.max(1, Math.min(crop.size, image.naturalWidth, image.naturalHeight))
  const sx = Math.max(0, Math.min(crop.sx, image.naturalWidth - size))
  const sy = Math.max(0, Math.min(crop.sy, image.naturalHeight - size))

  context.drawImage(image, sx, sy, size, size, 0, 0, AVATAR_SIZE_PX, AVATAR_SIZE_PX)

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, MIME, QUALITY)
  })

  if (!blob) throw new ImageDecodeError()
  return blob
}
