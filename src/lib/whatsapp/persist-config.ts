import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import {
  registerPhoneNumber,
  subscribeWabaToApp,
  verifyPhoneNumber,
  type MetaPhoneInfo,
} from '@/lib/whatsapp/meta-api'
import { encrypt } from '@/lib/whatsapp/encryption'

/**
 * Shared save path for `whatsapp_config`, used by both the manual
 * credentials form (POST /api/whatsapp/config) and the Embedded
 * Signup callback (POST /api/whatsapp/embedded-signup). Verifies with
 * Meta, encrypts the token, attempts /register + subscribed_apps
 * (both non-fatal — see inline notes), and upserts the row keyed by
 * account_id.
 */

export class SaveConfigError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'SaveConfigError'
    this.status = status
  }
}

export interface SaveVerifiedWhatsAppConfigArgs {
  /** User-scoped client (RLS applies) — reads/writes the caller's own
   *  account row. */
  supabase: SupabaseClient
  accountId: string
  userId: string
  phoneNumberId: string
  wabaId?: string | null
  accessToken: string
  verifyToken?: string | null
  /**
   * 6-digit 2FA PIN for /register. Omitted by the Embedded Signup
   * callback itself (the popup never returns a PIN); the user
   * supplies it afterwards via the "Registrar com PIN" control in
   * Settings, which calls POST /api/whatsapp/config/register. Not
   * applicable at all when `isCoexistence` is true — see below.
   */
  pin?: string | null
  /**
   * True when this save comes from the Coexistence path
   * (`FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING`) rather than a
   * brand-new/standard WABA connection. The number is already
   * registered to the customer's WhatsApp Business app, so /register
   * must be SKIPPED here — calling it again would conflict with that
   * existing registration instead of being a harmless no-op.
   */
  isCoexistence?: boolean
}

export interface SaveVerifiedWhatsAppConfigResult {
  success: boolean
  registered: boolean
  registration_skipped?: boolean
  registration_error?: string
  phone_info: MetaPhoneInfo
}

// Lazy-initialised service-role client, only used to detect a
// phone_number_id already claimed by a *different* account — under
// RLS, the caller's own session can't see other accounts' rows.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _adminClient
}

export async function saveVerifiedWhatsAppConfig(
  args: SaveVerifiedWhatsAppConfigArgs
): Promise<SaveVerifiedWhatsAppConfigResult> {
  const {
    supabase,
    accountId,
    userId,
    phoneNumberId,
    wabaId,
    accessToken,
    verifyToken,
    pin,
    isCoexistence,
  } = args

  // Reject if another account has already claimed this phone_number_id.
  // wacrm is single-tenant-per-WhatsApp-number — letting two accounts
  // bind the same number causes the webhook's `.single()` lookup to
  // throw PGRST116 ("multiple rows"), silently dropping every inbound
  // message. See issue #136.
  const { data: claimed, error: claimedError } = await supabaseAdmin()
    .from('whatsapp_config')
    .select('account_id')
    .eq('phone_number_id', phoneNumberId)
    .neq('account_id', accountId)
    .maybeSingle()

  if (claimedError) {
    console.error('Error checking phone_number_id ownership:', claimedError)
    throw new SaveConfigError('Failed to validate configuration', 500)
  }

  if (claimed) {
    throw new SaveConfigError(
      'This WhatsApp phone number is already linked to another account on this instance. Each phone number can only be connected to one wacrm user.',
      409
    )
  }

  // Verify credentials with Meta BEFORE saving.
  let phoneInfo: MetaPhoneInfo
  try {
    phoneInfo = await verifyPhoneNumber({
      phoneNumberId,
      accessToken,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown Meta API error'
    console.error('Meta API verification failed during save:', message)
    throw new SaveConfigError(`Meta API error: ${message}`, 400)
  }

  // Encrypt sensitive tokens before storing.
  let encryptedAccessToken: string
  let encryptedVerifyToken: string | null
  try {
    encryptedAccessToken = encrypt(accessToken)
    encryptedVerifyToken = verifyToken ? encrypt(verifyToken) : null
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown encryption error'
    console.error('Encryption failed:', message)
    throw new SaveConfigError(
      'Failed to encrypt token. Check that ENCRYPTION_KEY is a valid 64-character hex string in your environment variables.',
      500
    )
  }

  // Look up any pre-existing row for this account so we know whether
  // this number is already registered with Meta — if so we can skip
  // /register when the caller didn't supply a PIN this time around.
  const { data: existing } = await supabase
    .from('whatsapp_config')
    .select('id, registered_at, phone_number_id, onboarded_at')
    .eq('account_id', accountId)
    .maybeSingle()

  const sameNumber =
    existing?.phone_number_id === phoneNumberId && existing?.registered_at != null

  // Step 1: register the phone number for inbound webhooks. Attempted
  // on first save AND whenever a fresh PIN is supplied. Skipped when
  // the same number is already registered and no PIN was supplied —
  // re-registering an already-active number with a stale PIN would
  // actually fail and undo the active subscription.
  let registeredAt: string | null = existing?.registered_at ?? null
  let registrationError: string | null = null
  // True when registration was deliberately skipped because no PIN
  // was supplied (Meta test numbers) — distinct from registrationError,
  // this is not a failure.
  let registrationSkipped = false

  if (isCoexistence) {
    // Coexistence numbers are already registered to the customer's
    // WhatsApp Business app — calling /register here would conflict
    // with that registration instead of being a no-op. Events instead
    // reach us via the app-level webhook subscription (App Dashboard),
    // so treat the number as "registered" from this app's POV without
    // ever calling Meta's /register endpoint.
    registeredAt = registeredAt ?? new Date().toISOString()
  } else {
    const needsRegistration = !sameNumber || (typeof pin === 'string' && pin.length > 0)
    if (needsRegistration) {
      if (!pin) {
        registrationSkipped = true
      } else {
        try {
          await registerPhoneNumber({
            phoneNumberId,
            accessToken,
            pin,
          })
          registeredAt = new Date().toISOString()
        } catch (err) {
          registrationError =
            err instanceof Error ? err.message : 'Unknown Meta API error'
          console.error('Phone number /register failed:', registrationError)
          // Deliberately fall through and still save the row so the
          // caller can retry without re-entering everything.
        }
      }
    }
  }

  // Step 2: subscribe the WABA to this app. Idempotent on Meta's side,
  // so we call on every save and persist the timestamp. Skipped only
  // when there's no waba_id.
  let subscribedAppsAt: string | null = null
  if (wabaId) {
    try {
      await subscribeWabaToApp({
        wabaId,
        accessToken,
      })
      subscribedAppsAt = new Date().toISOString()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn('WABA subscribed_apps failed (non-fatal):', message)
    }
  }

  // Persist everything in one shot. If /register failed we still
  // store the credentials and the error so the caller can guide the
  // user through a retry.
  const baseRow = {
    phone_number_id: phoneNumberId,
    waba_id: wabaId || null,
    access_token: encryptedAccessToken,
    verify_token: encryptedVerifyToken,
    status: registrationError ? 'disconnected' : 'connected',
    connected_at: registrationError ? null : new Date().toISOString(),
    registered_at: registrationError ? null : registeredAt,
    subscribed_apps_at: subscribedAppsAt ?? null,
    last_registration_error: registrationError,
    updated_at: new Date().toISOString(),
    ...(isCoexistence
      ? { is_coexistence: true, onboarded_at: existing?.onboarded_at ?? new Date().toISOString() }
      : {}),
  }

  if (existing) {
    const { error: updateError } = await supabase
      .from('whatsapp_config')
      .update(baseRow)
      .eq('account_id', accountId)

    if (updateError) {
      console.error('Error updating whatsapp_config:', updateError)
      throw new SaveConfigError('Failed to update configuration', 500)
    }
  } else {
    // Insert with both columns: `account_id` is the tenancy key
    // (NOT NULL post-017, UNIQUE so duplicates trip the constraint
    // up-front), `user_id` is the audit column identifying which
    // member of the account saved the config.
    const { error: insertError } = await supabase
      .from('whatsapp_config')
      .insert({
        account_id: accountId,
        user_id: userId,
        ...baseRow,
      })

    if (insertError) {
      console.error('Error inserting whatsapp_config:', insertError)
      throw new SaveConfigError('Failed to save configuration', 500)
    }
  }

  if (registrationError) {
    return {
      success: false,
      registered: false,
      registration_error: registrationError,
      phone_info: phoneInfo,
    }
  }

  return {
    success: true,
    registered: registeredAt != null,
    registration_skipped: registrationSkipped,
    phone_info: phoneInfo,
  }
}
