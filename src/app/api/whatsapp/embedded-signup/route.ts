import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exchangeCodeForToken } from '@/lib/whatsapp/meta-api'
import { saveVerifiedWhatsAppConfig, SaveConfigError } from '@/lib/whatsapp/persist-config'

/**
 * POST /api/whatsapp/embedded-signup
 *
 * Callback for Meta's WhatsApp Embedded Signup (Facebook Login for
 * Business), Coexistence mode. The client-side flow is:
 *   1. `FB.login` with `config_id` + `response_type: 'code'` opens the
 *      popup; on completion the SDK callback delivers `authResponse.code`.
 *   2. The `message` event from the popup (type `WA_EMBEDDED_SIGNUP`)
 *      delivers `phone_number_id` + `waba_id` for the number the user
 *      picked/created inside the flow.
 *   3. The client POSTs both here.
 *
 * This exchanges `code` for a business-integration access token via
 * Meta's /oauth/access_token, then reuses the same verify/encrypt/
 * register/subscribe/persist path as the manual form
 * (`saveVerifiedWhatsAppConfig`). No PIN is supplied here — the popup
 * never returns one, and Meta always requires the /register PIN as a
 * separate server-to-server call regardless of Coexistence vs a new
 * number. /register is left skipped/best-effort on this first save;
 * the user completes it afterwards via the "Registrar com PIN"
 * control in Settings (POST /api/whatsapp/config/register).
 */
async function resolveAccountId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data?.account_id) return null
  return data.account_id as string
}

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

    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    const body = await request.json()
    const { code, phone_number_id, waba_id } = body

    if (!code || !phone_number_id || !waba_id) {
      return NextResponse.json(
        { error: 'code, phone_number_id and waba_id are required' },
        { status: 400 }
      )
    }

    let accessToken: string
    try {
      const exchanged = await exchangeCodeForToken({ code })
      accessToken = exchanged.accessToken
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta API error'
      console.error('Embedded Signup code exchange failed:', message)
      return NextResponse.json(
        { error: `Meta API error: ${message}` },
        { status: 400 }
      )
    }

    try {
      const result = await saveVerifiedWhatsAppConfig({
        supabase,
        accountId,
        userId: user.id,
        phoneNumberId: phone_number_id,
        wabaId: waba_id,
        accessToken,
      })

      return NextResponse.json({ ...result, saved: true })
    } catch (err) {
      if (err instanceof SaveConfigError) {
        return NextResponse.json({ error: err.message }, { status: err.status })
      }
      throw err
    }
  } catch (error) {
    console.error('Error in WhatsApp embedded-signup POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
