/**
 * Larder — push sender.
 *
 *   POST /functions/v1/notify
 *   { "list_id": "...", "actor_id": "...", "title": "...", "body": "..." }
 *
 * Fans a notification out to every household member except the person who
 * caused it. Runs on the service role, so it re-derives the household from the
 * list rather than trusting anything in the request body beyond the ids.
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
    console.error('notify: missing environment')
    return json({ ok: false, error: 'not configured' }, 500)
  }

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return json({ ok: false, error: 'bad json' }, 400)
  }

  if (!body.list_id) return json({ ok: false, error: 'list_id required' }, 400)

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Derive the audience from the list, never from the caller.
  const { data: list } = await db
    .from('lists')
    .select('household_id')
    .eq('id', body.list_id)
    .maybeSingle()
  if (!list) return json({ ok: false, error: 'unknown list' }, 404)

  const { data: members } = await db
    .from('household_members')
    .select('user_id')
    .eq('household_id', (list as { household_id: string }).household_id)

  const recipients = (members ?? [])
    .map((m) => (m as { user_id: string }).user_id)
    .filter((id) => id !== body.actor_id)

  if (recipients.length === 0) return json({ ok: true, sent: 0 })

  const { data: subscriptions } = await db
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .in('user_id', recipients)

  if (!subscriptions || subscriptions.length === 0) return json({ ok: true, sent: 0 })

  webpush.setVapidDetails('mailto:larder@example.com', vapidPublic, vapidPrivate)

  const payload = JSON.stringify({
    title: body.title ?? 'Larder',
    body: body.body ?? 'Your list changed.',
    url: body.url ?? '/',
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
