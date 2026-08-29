// ============================================================
// Rocketing Pay billing webhook — the I/O half. Pure decision logic
// lives in ./rocketing-pay.ts (fully unit-tested); this file is the
// thin, harder-to-test glue that talks to Postgres. Called from
// src/app/api/billing/webhook/route.ts inside `after()`.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  normalizeRocketingPayPayload,
  buildIdempotencyKey,
  decideBillingAction,
  type CurrentBillingRow,
} from './rocketing-pay'

interface LogFields {
  account_id?: string | null
  email?: string | null
  event?: string | null
  resolved_status?: string | null
  action: string
  outcome: 'success' | 'ignored' | 'error'
  error_message?: string | null
  idempotency_key?: string | null
  external_transaction_id?: string | null
  external_product_id?: string | null
  amount?: number | null
  payload?: unknown
  headers?: unknown
}

function insertLog(db: SupabaseClient, fields: LogFields) {
  return db.from('billing_webhook_logs').insert(fields).select('id').single()
}

/**
 * Resolve which account a checkout email belongs to. Two independent,
 * schema-cache-safe point lookups (no embedded FK join — see the
 * PGRST200 rationale in src/lib/auth/account.ts): first the account
 * whose OWNER's profile has this email, then — for a checkout linked
 * manually via /platform, or by a prior webhook — account_billing's
 * external_customer_email.
 */
async function findAccountByEmail(
  db: SupabaseClient,
  email: string,
): Promise<string | null> {
  const { data: ownerProfile } = await db
    .from('profiles')
    .select('account_id')
    .eq('email', email)
    .maybeSingle()
  if (ownerProfile?.account_id) return ownerProfile.account_id as string

  const { data: billingMatch } = await db
    .from('account_billing')
    .select('account_id')
    .eq('external_customer_email', email)
    .maybeSingle()
  if (billingMatch?.account_id) return billingMatch.account_id as string

  return null
}

function maskHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  headers.forEach((value, key) => {
    out[key] =
      key.toLowerCase() === 'authorization' ? value.slice(0, 14) + '...' : value.slice(0, 120)
  })
  return out
}

export async function processBillingWebhook(
  db: SupabaseClient,
  rawPayload: unknown,
  requestHeaders: Headers,
): Promise<void> {
  const headers = maskHeaders(requestHeaders)
  const ev = normalizeRocketingPayPayload(rawPayload)

  if (!ev) {
    await insertLog(db, { action: 'invalid', outcome: 'ignored', payload: rawPayload, headers })
    return
  }

  const idempotencyKey = buildIdempotencyKey(ev)
  const baseFields = {
    email: ev.email,
    event: ev.rawEvent,
    resolved_status: ev.resolvedStatus,
    external_transaction_id: ev.transactionId || null,
    external_product_id: ev.productId,
    amount: ev.amount || null,
    payload: rawPayload,
    headers,
  }

  // Claim the idempotency key up front — the unique partial index on
  // billing_webhook_logs.idempotency_key IS the lock. A 23505 means
  // this exact state-changing event was already processed; log the
  // duplicate (without the key, so it doesn't collide again) and stop
  // WITHOUT reapplying the patch. One row is then updated in place
  // below with the real outcome, rather than inserting a second row —
  // keeps exactly one log entry per real webhook delivery.
  let logId: string | null = null
  if (idempotencyKey) {
    const { data: claimed, error: claimErr } = await insertLog(db, {
      ...baseFields,
      action: 'processing',
      outcome: 'success',
      idempotency_key: idempotencyKey,
    })
    if (claimErr) {
      if (claimErr.code === '23505') {
        await insertLog(db, { ...baseFields, action: 'duplicate', outcome: 'ignored' })
        return
      }
      console.error('[billing-webhook] failed to log webhook:', claimErr)
      return
    }
    logId = claimed?.id ?? null
  }

  async function finish(fields: Omit<LogFields, keyof typeof baseFields | 'idempotency_key'>) {
    if (logId) {
      await db.from('billing_webhook_logs').update(fields).eq('id', logId)
    } else {
      await insertLog(db, { ...baseFields, ...fields })
    }
  }

  if (!ev.email) {
    await finish({ action: 'invalid', outcome: 'error', error_message: 'Payload has no comprador email' })
    return
  }

  const accountId = await findAccountByEmail(db, ev.email)

  if (!accountId) {
    // Never auto-create an account here — the customer signs up
    // first (see 041's header). The /platform/webhooks page surfaces
    // this action prominently so staff can link the right account
    // manually — a mismatched checkout email is the common cause.
    await finish({ action: 'no_account', outcome: 'ignored' })
    return
  }

  const { data: current } = await db
    .from('account_billing')
    .select('status, plan, external_subscription_id, external_product_id, past_due_since')
    .eq('account_id', accountId)
    .maybeSingle<CurrentBillingRow>()

  // Global default trial length — used only for `trial` events with
  // no explicit trial_days / event-name convention.
  const { data: settings } = await db
    .from('platform_settings')
    .select('default_trial_days')
    .eq('id', 1)
    .maybeSingle()

  const decision = decideBillingAction(ev, current, {
    defaultTrialDays: settings?.default_trial_days ?? 7,
  })

  if (decision.patch) {
    const { error: patchErr } = await db
      .from('account_billing')
      .update({ ...decision.patch, external_customer_email: ev.email })
      .eq('account_id', accountId)

    if (patchErr) {
      console.error('[billing-webhook] failed to apply patch:', patchErr)
      await finish({
        account_id: accountId,
        action: decision.action,
        outcome: 'error',
        error_message: patchErr.message,
      })
      return
    }
  }

  await finish({ account_id: accountId, action: decision.action, outcome: 'success' })
}
