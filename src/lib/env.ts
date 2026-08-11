/**
 * Environment access with loud, actionable failure.
 *
 * Vite replaces `import.meta.env.VITE_*` at build time. Anything not prefixed
 * `VITE_` is silently `undefined`, which historically produces a blank page and
 * an inscrutable Supabase error.
 *
 * Deliberately does *not* throw at module scope. A throw during import happens
 * before React exists, so nothing can catch it and the user still gets a white
 * screen — exactly the failure we are trying to prevent. Instead the problem is
 * recorded here and `main.tsx` renders an explanation instead of mounting the
 * app, which also stops the Supabase client from ever being constructed with
 * junk values.
 */

export class MissingEnvError extends Error {
  readonly missing: readonly string[]

  constructor(missing: readonly string[]) {
    super(
      `Larder cannot start — missing environment variable${missing.length > 1 ? 's' : ''}: ` +
        `${missing.join(', ')}.\n\n` +
        `Running locally? Create .env.local in the project root:\n` +
        `  VITE_SUPABASE_URL=https://<project-ref>.supabase.co\n` +
        `  VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...\n` +
        `then restart the dev server — Vite only reads that file at startup.\n\n` +
        `Deployed? Add both as environment variables in your host (Vercel:\n` +
        `Settings → Environment Variables → Production), then REDEPLOY.\n` +
        `Vite inlines these at build time, so setting them without a fresh\n` +
        `build changes nothing — the old bundle still has the empty values.\n\n` +
        `Either way both names must keep the VITE_ prefix, or Vite will not\n` +
        `expose them to the client and they arrive as undefined.`,
    )
    this.name = 'MissingEnvError'
    this.missing = missing
  }
}

type Env = {
  supabaseUrl: string
  supabasePublishableKey: string
}

function readEnv(): { env: Env; error: MissingEnvError | null } {
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

  const missing: string[] = []
  if (typeof url !== 'string' || url.trim().length === 0) missing.push('VITE_SUPABASE_URL')
  if (typeof key !== 'string' || key.trim().length === 0) missing.push('VITE_SUPABASE_PUBLISHABLE_KEY')

  if (missing.length > 0) {
    return { env: { supabaseUrl: '', supabasePublishableKey: '' }, error: new MissingEnvError(missing) }
  }

  return {
    env: { supabaseUrl: url.trim(), supabasePublishableKey: key.trim() },
    error: null,
  }
}

const result = readEnv()

export const env: Env = result.env
export const envError: MissingEnvError | null = result.error

/**
 * Base URL of the deployed Edge Functions, derived from the project URL.
 * Used to pre-fill the Shortcut setup instructions in Settings.
 */
export const functionsBaseUrl = `${env.supabaseUrl.replace(/\/$/, '')}/functions/v1`
