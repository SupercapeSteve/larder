/**
 * Larder — push sender.
 *
 *   POST /functions/v1/notify
 *   Authorization: Bearer <user JWT | service_role key>
 *   { "list_id": "...", "title": "...", "body": "...", "url": "/h/..." }
 *
 * Fans a notification out to every household member except the person who
 * caused it.
 *
 * Security boundary (hardened by Carbon):
 *  - Never trust `actor_id` or an external `url` from an untrusted body.
 *  - Authenticate the caller's JWT (or verify the platform service-role key for
 *    Siri-originated calls), derive the actor from that identity, and confirm
 *    the actor holds write access (`owner`, `admin` or `member`) on the
 *    household that owns `list_id`. Otherwise any signed-in user on the
 *    project could push arbitrary text and phishing links to strangers.
 *
 * Requires two secrets, set with `supabase secrets set`:
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization') ?? request.headers.get('authorization')
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match && match[1].trim().length > 0 ? match[1].trim() : null
}

/** Same-origin relative path only — never an external URL or protocol-relative `//`. */
function safePath(candidate: string | undefined, fallback: string): string {
  if (!candidate) return fallback
  const trimmed = candidate.trim()
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.includes('\\')) {
    return fallback
  }
  return trimmed.slice(0, 200)
}

type Body = {
  list_id?: string
  actor_id?: string
  title?: string
  body?: string
  url?: string
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  if (request.method !== 'POST') return json({ ok: false, error: 'method' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY')
  const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY')

  if (!supabaseUrl || !serviceRoleKey || !vapidPublic || !vapidPrivate) {
    // Push is optional on self-hosted instances; fail quietly when unconfigured.
    return json({ ok: false, error: 'not configured' }, 503)
  }

  const token = bearerToken(request)
  if (!token) return json({ ok: false, error: 'unauthorized' }, 401)

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return json({ ok: false, error: 'bad json' }, 400)
  }

  if (!body.list_id || typeof body.list_id !== 'string') {
    return json({ ok: false, error: 'list_id required' }, 400)
  }

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Resolve who is calling. Only the internal Siri function may name an
  // actor_id directly, and only by presenting the service-role key itself.
  let actorId: string | null = null
  if (token === serviceRoleKey) {
    actorId = typeof body.actor_id === 'string' ? body.actor_id : null
  } else {
    const { data: userData, error: userError } = await db.auth.getUser(token)
    if (userError || !userData.user) {
      return json({ ok: false, error: 'unauthorized' }, 401)
    }
    actorId = userData.user.id
  }

  if (!actorId) return json({ ok: false, error: 'actor required' }, 401)

  // Derive the household from the list, never from the caller.
  const { data: list } = await db
    .from('lists')
    .select('household_id')
    .eq('id', body.list_id)
    .maybeSingle()
  if (!list) return json({ ok: false, error: 'unknown list' }, 404)

  const householdId = (list as { household_id: string }).household_id

  const { data: members } = await db
    .from('household_members')
    .select('user_id, role')
    .eq('household_id', householdId)

  const roster = (members ?? []) as Array<{ user_id: string; role: string }>
  const callerMembership = roster.find((m) => m.user_id === actorId)
  if (!callerMembership || callerMembership.role === 'viewer') {
    return json({ ok: false, error: 'forbidden' }, 403)
  }

  const recipients = roster.map((m) => m.user_id).filter((id) => id !== actorId)
  if (recipients.length === 0) return json({ ok: true, sent: 0 })

  const { data: subscriptions } = await db
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .in('user_id', recipients)

  if (!subscriptions || subscriptions.length === 0) return json({ ok: true, sent: 0 })

  webpush.setVapidDetails('mailto:larder@example.com', vapidPublic, vapidPrivate)

  const title = (typeof body.title === 'string' && body.title.trim().length > 0
    ? body.title.trim()
    : 'Larder'
  ).slice(0, 60)
  const message = (typeof body.body === 'string' && body.body.trim().length > 0
    ? body.body.trim()
    : 'Your list changed.'
  ).slice(0, 180)

  const payload = JSON.stringify({
    title,
    body: message,
    url: safePath(body.url, `/h/${householdId}`),
    tag: 'larder-list',
  })

  let sent = 0
  const dead: string[] = []

  await Promise.all(
    subscriptions.map(async (row) => {
      const sub = row as { id: string; endpoint: string; p256dh: string; auth: string }
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        )
        sent += 1
      } catch (error) {
        // 404/410 mean the browser threw the subscription away — prune it so
        // the table does not fill with endpoints that can never be delivered.
        const status = (error as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) dead.push(sub.id)
        else console.error('notify: send failed', status, String(error))
      }
    }),
  )

  if (dead.length > 0) {
    await db.from('push_subscriptions').delete().in('id', dead)
  }

  return json({ ok: true, sent, pruned: dead.length })
})
