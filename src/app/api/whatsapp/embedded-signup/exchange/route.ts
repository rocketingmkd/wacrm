import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exchangeCodeForToken } from '@/lib/whatsapp/meta-api'

/**
 * POST /api/whatsapp/embedded-signup/exchange
 *
 * Exchanges the Embedded Signup `code` for an access token IMMEDIATELY
 * upon receipt — split out from the full save flow in
 * POST /api/whatsapp/embedded-signup because Meta's `code` has only a
 * 30-second TTL. For the Coexistence path the `code` arrives from the
 * OAuth dialog redirect well before the user finishes scanning the QR
 * code with their phone (which can take minutes) — waiting for both
 * the code AND the waba_id/phone_number_id (delivered separately via
 * the WA_EMBEDDED_SIGNUP postMessage) before exchanging meant the code
 * was routinely already expired by the time it got used. The frontend
 * now calls this route the instant the code arrives, then reuses the
 * resulting access token — never a stale code — once the WABA data
 * shows up later.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { code } = body
    if (!code) {
      return NextResponse.json({ error: 'code is required' }, { status: 400 })
    }

    try {
      const { accessToken } = await exchangeCodeForToken({ code })
      return NextResponse.json({ accessToken })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta API error'
      console.error('Embedded Signup immediate code exchange failed:', message)
      return NextResponse.json({ error: `Meta API error: ${message}` }, { status: 400 })
    }
  } catch (error) {
    console.error('Error in WhatsApp embedded-signup/exchange POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
