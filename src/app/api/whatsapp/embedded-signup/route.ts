import { NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  exchangeCodeForToken,
  getWabaPhoneNumbers,
  syncSmbAppData,
} from '@/lib/whatsapp/meta-api'
import { saveVerifiedWhatsAppConfig, SaveConfigError } from '@/lib/whatsapp/persist-config'

/**
 * POST /api/whatsapp/embedded-signup
 *
 * Callback for Meta's WhatsApp Embedded Signup (Facebook Login for
 * Business). Two client-side paths land here:
 *
 *   - Standard (create/pick a WABA): popup delivers `phone_number_id`
 *     + `waba_id` via the `FINISH`/`FINISH_ONLY_WABA` postMessage.
 *   - Coexistence (connect a number already live in the customer's
 *     WhatsApp Business app): popup delivers `FINISH_WHATSAPP_BUSINESS_
 *     APP_ONBOARDING` instead, which may carry only `waba_id` — the
 *     phone_number_id is resolved here via getWabaPhoneNumbers.
 *
 * This exchanges `code` for a business-integration access token via
 * Meta's /oauth/access_token, then reuses the same verify/encrypt/
 * subscribe/persist path as the manual form (`saveVerifiedWhatsAppConfig`),
 * passing `isCoexistence` through so /register is skipped for the
 * Coexistence path (the number is already registered to the customer's
 * app — see persist-config.ts).
 *
 * For Coexistence, Meta also requires kicking off the one-time
 * contacts + history sync (`smb_app_data`) within 24h of onboarding.
 * That's fired here via `after()` so it doesn't block the response —
 * the actual data arrives asynchronously through the `smb_app_state_
 * sync` / `history` webhooks (see src/app/api/whatsapp/webhook/route.ts).
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
    const { code, waba_id, is_coexistence } = body
    let { phone_number_id } = body
    const isCoexistence = Boolean(is_coexistence)

    if (!code || !waba_id || (!phone_number_id && !isCoexistence)) {
      return NextResponse.json(
        { error: 'code and waba_id are required (phone_number_id is required unless is_coexistence is set)' },
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

    // Coexistence's FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING event can
    // arrive with only a waba_id — resolve the phone number server-side.
    if (!phone_number_id && isCoexistence) {
      try {
        const numbers = await getWabaPhoneNumbers({ wabaId: waba_id, accessToken })
        if (numbers.length === 0) {
          return NextResponse.json(
            { error: 'No phone numbers found under this WABA.' },
            { status: 400 }
          )
        }
        // Coexistence onboarding always connects exactly one number;
        // multiple numbers under the same WABA would need the customer
        // to pick, which the popup doesn't surface for this event.
        phone_number_id = numbers[0].id
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown Meta API error'
        console.error('getWabaPhoneNumbers failed during Coexistence signup:', message)
        return NextResponse.json(
          { error: `Meta API error: ${message}` },
          { status: 400 }
        )
      }
    }

    try {
      const result = await saveVerifiedWhatsAppConfig({
        supabase,
        accountId,
        userId: user.id,
        phoneNumberId: phone_number_id,
        wabaId: waba_id,
        accessToken,
        isCoexistence,
      })

      if (isCoexistence && result.success) {
        // Fire-and-forget: kick off the one-time contacts/history sync.
        // Both are non-fatal from the caller's POV — the data also
        // arrives via webhooks on Meta's own schedule, and any failure
        // here is logged, not surfaced to the user mid-connect.
        after(async () => {
          try {
            await syncSmbAppData({
              phoneNumberId: phone_number_id,
              accessToken,
              syncType: 'smb_app_state_sync',
            })
          } catch (err) {
            console.error('Coexistence contacts sync failed to start:', err)
          }
          try {
            await syncSmbAppData({
              phoneNumberId: phone_number_id,
              accessToken,
              syncType: 'history',
            })
          } catch (err) {
            console.error('Coexistence history sync failed to start:', err)
          }
        })
      }

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
