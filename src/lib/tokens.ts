/**
 * Siri token minting.
 *
 * The plaintext token exists in exactly two places: the user's clipboard, and
 * this browser tab's memory until it is closed. Only the SHA-256 hash is ever
 * sent to the database, so a leaked table dump yields nothing usable.
 */

export const TOKEN_PREFIX = 'larder_'

export class InsecureContextError extends Error {
  constructor() {
    super(
      'Larder needs a secure context (https, or localhost) to generate a token. ' +
        'Open the app over https and try again.',
    )
    this.name = 'InsecureContextError'
  }
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** `larder_` followed by 32 hex characters — 128 bits of entropy. */
export function generateToken(): string {
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    throw new InsecureContextError()
  }
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return `${TOKEN_PREFIX}${toHex(bytes)}`
}

/** SHA-256, lowercase hex — the exact shape the database CHECK constraint wants. */
export async function hashToken(token: string): Promise<string> {
  if (typeof crypto === 'undefined' || crypto.subtle === undefined) {
    throw new InsecureContextError()
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return toHex(new Uint8Array(digest))
}
