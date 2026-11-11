// ============================================================
// /platform: redefinir a senha do dono e apagar uma conta inteira.
//
// Lógica separada da rota para ser testável com um cliente falso.
//
// Apagar: accounts.owner_user_id é ON DELETE RESTRICT, então o login do
// dono só pode sair DEPOIS da conta. Apagar a conta leva em cascata
// perfis, contatos, conversas, funis, automações e integrações. Os ids
// dos membros são lidos ANTES, porque o cascade apaga os perfis.
// ============================================================

import { randomInt } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildSetupLink } from './create-account'

export type AccountAdminErrorCode = 'invalid' | 'not_found' | 'forbidden' | 'failed'

export class AccountAdminError extends Error {
  constructor(
    public code: AccountAdminErrorCode,
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'AccountAdminError'
  }
}

const ALNUM = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'

/** Senha temporária legível: Rkt-xxxxxxxxxx9! (sem caracteres ambíguos). */
export function generateTempPassword(): string {
  let body = ''
  for (let i = 0; i < 10; i++) body += ALNUM[randomInt(ALNUM.length)]
  return `Rkt-${body}${randomInt(10)}!`
}

interface AccountRow {
  id: string
  name: string
  owner_user_id: string
}

async function loadAccount(admin: SupabaseClient, accountId: string): Promise<AccountRow> {
  const { data, error } = await admin
    .from('accounts')
    .select('id, name, owner_user_id')
    .eq('id', accountId)
    .maybeSingle()
  if (error) {
    console.error('[platform/account-admin] load account failed:', error.message)
    throw new AccountAdminError('failed', 'Não foi possível carregar a conta.', 500)
  }
  if (!data) throw new AccountAdminError('not_found', 'Conta não encontrada.', 404)
  return data as AccountRow
}

async function ownerEmail(admin: SupabaseClient, ownerUserId: string): Promise<string> {
  const { data, error } = await admin.auth.admin.getUserById(ownerUserId)
  const email = data?.user?.email
  if (error || !email) {
    throw new AccountAdminError('failed', 'Não foi possível ler o login do dono.', 502)
  }
  return email.toLowerCase()
}

export interface ResetPasswordResult {
  ownerEmail: string
  /** Só no modo 'password'. Mostrada uma vez, nunca gravada. */
  password: string | null
  /** Só no modo 'link'. */
  setupLink: string | null
}

export async function resetOwnerPassword(
  admin: SupabaseClient,
  accountId: string,
  mode: 'password' | 'link',
  opts: { siteUrl: string; actorUserId: string },
): Promise<ResetPasswordResult> {
  const account = await loadAccount(admin, accountId)
  const email = await ownerEmail(admin, account.owner_user_id)

  let password: string | null = null
  let setupLink: string | null = null

  if (mode === 'password') {
    password = generateTempPassword()
    const { error } = await admin.auth.admin.updateUserById(account.owner_user_id, { password })
    if (error) {
      console.error('[platform/account-admin] updateUserById failed:', error.message)
      throw new AccountAdminError('failed', 'Não foi possível redefinir a senha.', 502)
    }
  } else {
    const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email })
    const hashed = data?.properties?.hashed_token
    if (error || !hashed) {
      console.error('[platform/account-admin] generateLink failed:', error?.message)
      throw new AccountAdminError('failed', 'Não foi possível gerar o link.', 502)
    }
    setupLink = buildSetupLink(opts.siteUrl, hashed)
  }

  // Nunca grava a senha nem o link no log.
  await admin.from('platform_audit_log').insert({
    actor_user_id: opts.actorUserId,
    account_id: accountId,
    action: 'account.password_reset',
    before: null,
    after: { mode, owner_email: email },
  })

  return { ownerEmail: email, password, setupLink }
}

export interface DeleteAccountResult {
  accountName: string
  ownerEmail: string
  deletedLogins: number
  /** Logins que não puderam ser removidos (a conta já foi apagada). */
  failedLogins: string[]
}

export async function deleteAccountAndUsers(
  admin: SupabaseClient,
  accountId: string,
  confirmEmail: unknown,
  opts: { actorUserId: string },
): Promise<DeleteAccountResult> {
  const account = await loadAccount(admin, accountId)

  if (account.owner_user_id === opts.actorUserId) {
    throw new AccountAdminError('forbidden', 'Você não pode apagar a sua própria conta.', 403)
  }

  const email = await ownerEmail(admin, account.owner_user_id)
  const typed = typeof confirmEmail === 'string' ? confirmEmail.trim().toLowerCase() : ''
  if (typed !== email) {
    throw new AccountAdminError(
      'invalid',
      'O e-mail digitado não confere com o do dono da conta.',
      400,
    )
  }

  // Membros (um login só pertence a uma conta). Lidos antes do cascade.
  const { data: profiles, error: profErr } = await admin
    .from('profiles')
    .select('user_id')
    .eq('account_id', accountId)
  if (profErr) {
    console.error('[platform/account-admin] load members failed:', profErr.message)
    throw new AccountAdminError('failed', 'Não foi possível carregar os membros da conta.', 500)
  }
  const memberIds = ((profiles ?? []) as { user_id: string }[])
    .map((p) => p.user_id)
    .filter((id) => id !== account.owner_user_id && id !== opts.actorUserId)

  const { error: delAccErr } = await admin.from('accounts').delete().eq('id', accountId)
  if (delAccErr) {
    console.error('[platform/account-admin] delete account failed:', delAccErr.message)
    throw new AccountAdminError('failed', 'Não foi possível apagar a conta. Nada foi removido.', 500)
  }

  // Dono por último entre os logins (já sem a conta, o RESTRICT não barra).
  const failedLogins: string[] = []
  let deletedLogins = 0
  for (const userId of [...memberIds, account.owner_user_id]) {
    const { error } = await admin.auth.admin.deleteUser(userId)
    if (error) {
      console.error('[platform/account-admin] deleteUser failed:', userId, error.message)
      failedLogins.push(userId)
    } else {
      deletedLogins++
    }
  }

  // account_id vira NULL no log (ON DELETE SET NULL): guarda o que foi apagado.
  await admin.from('platform_audit_log').insert({
    actor_user_id: opts.actorUserId,
    account_id: null,
    action: 'account.deleted',
    before: { account_id: accountId, name: account.name, owner_email: email, members: memberIds.length },
    after: { deleted_logins: deletedLogins, failed_logins: failedLogins.length },
  })

  return { accountName: account.name, ownerEmail: email, deletedLogins, failedLogins }
}
