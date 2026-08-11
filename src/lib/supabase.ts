import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env } from '@/lib/env'
import type { Database } from '@/types/database'

/**
 * The one and only Supabase client.
 *
 * Uses the **publishable** key (`sb_publishable_...`), never a secret key —
 * Supabase deprecates the legacy anon/service JWTs at the end of 2026 and this
 * project starts on the new key format. Everything this client can do is
 * governed by Row Level Security; there is no privileged path from the browser.
 *
 * `detectSessionInUrl` is deliberately false: Larder uses password auth only.
 * Magic links open in Safari on iOS, which lands the session in a different
 * storage container from the installed home-screen app and leaves the user
 * looking permanently logged out.
 */
export const supabase: SupabaseClient<Database> = createClient<Database>(
  env.supabaseUrl,
  env.supabasePublishableKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      // Implicit, not PKCE, and deliberately so. PKCE stores a code verifier in
      // the localStorage of whichever browser *started* the flow. A password
      // reset email opened in Safari, when the flow began in the installed
      // home-screen app, has no verifier and fails with an opaque error — the
      // same storage-container split that makes magic links unusable on iOS.
      // Implicit puts the tokens in the URL fragment, which works in any
      // browser. We never use OAuth, so this costs us nothing; recovery links
      // are consumed explicitly and only by the /update-password route.
      flowType: 'implicit',
      storageKey: 'larder-auth',
    },
    realtime: {
      params: {
        // Plenty of headroom for two people editing one list; keeps the
        // socket from being throttled during a burst of check-offs.
        eventsPerSecond: 20,
      },
    },
    global: {
      headers: { 'x-client-info': 'larder-pwa' },
    },
  },
)
