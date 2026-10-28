// ============================================================
// "Nova conta" (platform admin): create a customer account for an
// owner that has not signed up yet.
//
// An account cannot exist without an owner (accounts.owner_user_id is
// NOT NULL and invitations can never carry the owner role), so the way
// in is the same one a self-signup takes: create the owner's login
// through the Supabase Admin API and let the `handle_new_user` trigger
// (migration 042) provision the account, profile and trial. We then
// rename the account to the company and hand the staff member a one-off
// link so the OWNER picks their own password. No password is ever
// generated or shown here.
//
// The link goes straight to the app's own /auth/callback with a
// token_hash (the shape that route already verifies server-side), so it
// does not depend on GoTrue redirects or on outgoing e-mail.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

export type CreateAccountErrorCode = 'invalid' | 'conflict' | 'failed'

export class CreateAccountError extends Error {
  constructor(
    readonly code: CreateAccountErrorCode,
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'CreateAccountError'
  }
}

export interface ValidatedCreateAccount {
  companyName: string
  ownerEmail: string
  ownerName: string | null
  /** Overrides the platform default trial length when set. */
  trialDays: number | null
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_NAME = 80
const MAX_EMAIL = 254

const invalid = (message: string) => new CreateAccountError('invalid', message, 400)

/** Hand validation of the POST body (no zod in this repo). */
export function validateCreateAccountInput(raw: unknown): ValidatedCreateAccount {
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>

  const companyName = typeof body.companyName === 'string' ? body.companyName.trim() : ''
  if (companyName.length < 2) throw invalid('Informe o nome da empresa.')
  if (companyName.length > MAX_NAME) {
    throw invalid(`O nome da empresa deve ter no máximo ${MAX_NAME} caracteres.`)
  }

  const ownerEmail = typeof body.ownerEmail === 'string' ? body.ownerEmail.trim().toLowerCase() : ''
  if (!ownerEmail || ownerEmail.length > MAX_EMAIL || !EMAIL_RE.test(ownerEmail)) {
    throw invalid('Informe um e-mail válido para o dono.')
  }

  let ownerName: string | null = null
  if (typeof body.ownerName === 'string' && body.ownerName.trim()) {
    ownerName = body.ownerName.trim()
    if (ownerName.length > MAX_NAME) {
      throw invalid(`O nome do dono deve ter no máximo ${MAX_NAME} caracteres.`)
    }
  }

  let trialDays: number | null = null
  if (body.trialDays !== undefined && body.trialDays !== null && body.trialDays !== '') {
    const n = Number(body.trialDays)
    if (!Number.isInteger(n) || n < 1 || n > 365) {
      throw invalid('Os dias de teste devem ser um número inteiro entre 1 e 365.')
    }
    trialDays = n
  }

  return { companyName, ownerEmail, ownerName, trialDays }
}

export interface CreateAccountResult {
  accountId: string
  ownerUserId: string
  ownerEmail: string
  /** One-off link for the owner to set a password; null if it could not be generated. */
  setupLink: string | null
}

/** Link the owner opens to land on "Definir nova senha". */
export function buildSetupLink(siteUrl: string, hashedToken: string): string {
  const base = siteUrl.replace(/\/+$/, '')
  return `${base}/auth/callback?token_hash=${encodeURIComponent(hashedToken)}&type=recovery&next=/reset-password`
}

export async function createAccountWithOwner(
  admin: SupabaseClient,
  input: ValidatedCreateAccount,
  opts: { siteUrl: string; actorUserId: string; now?: Date },
): Promise<CreateAccountResult> {
  const { companyName, ownerEmail, ownerName, trialDays } = input
  const now = opts.now ?? new Date()

  // Friendlier than the Auth error, and covers a login that already has
  // an account (one account per user).
  const { data: existing } = await admin
    .from('profiles')
    .select('user_id')
    .eq('email', ownerEmail)
    .maybeSingle()
  if (existing) {
    throw new CreateAccountError('conflict', 'Já existe um acesso com este e-mail.', 409)
  }

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: ownerEmail,
    email_confirm: true,
    user_metadata: { full_name: ownerName ?? companyName },
  })
  if (createErr || !created?.user) {
    const msg = (createErr?.message ?? '').toLowerCase()
    if (msg.includes('already') || msg.includes('registered') || msg.includes('exists')) {
      throw new CreateAccountError('conflict', 'Já existe um acesso com este e-mail.', 409)
    }
    console.error('[platform/create-account] createUser failed:', createErr?.message)
    throw new CreateAccountError('failed', 'Não foi possível criar o acesso do dono.', 502)
  }
  const ownerUserId = created.user.id

  // The trigger provisions the account. If it silently failed, do not
  // leave a login without an account behind.
  const { data: account } = await admin
    .from('accounts')
    .select('id')
    .eq('owner_user_id', ownerUserId)
    .maybeSingle()
  if (!account) {
    await admin.auth.admin.deleteUser(ownerUserId).catch(() => undefined)
    console.error('[platform/create-account] trigger did not create an account for', ownerUserId)
    throw new CreateAccountError('failed', 'Não foi possível criar a conta. Tente novamente.', 500)
  }
  const accountId = (account as { id: string }).id

  await admin.from('accounts').update({ name: companyName }).eq('id', accountId)

  if (trialDays !== null) {
    await admin
      .from('account_billing')
      .update({ trial_ends_at: new Date(now.getTime() + trialDays * 86_400_000).toISOString() })
      .eq('account_id', accountId)
  }

  let setupLink: string | null = null
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email: ownerEmail,
  })
  const hashed = link?.properties?.hashed_token
  if (linkErr || !hashed) {
    console.error('[platform/create-account] generateLink failed:', linkErr?.message)
  } else {
    setupLink = buildSetupLink(opts.siteUrl, hashed)
  }

  await admin.from('platform_audit_log').insert({
    actor_user_id: opts.actorUserId,
    account_id: accountId,
    action: 'account.created',
    before: null,
    after: { company_name: companyName, owner_email: ownerEmail, trial_days: trialDays },
  })

  return { accountId, ownerUserId, ownerEmail, setupLink }
}
