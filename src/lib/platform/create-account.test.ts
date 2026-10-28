import { describe, expect, it, vi } from 'vitest'
import {
  CreateAccountError,
  buildSetupLink,
  createAccountWithOwner,
  validateCreateAccountInput,
} from './create-account'

describe('validateCreateAccountInput', () => {
  it('trims, lowercases the e-mail and accepts optional fields', () => {
    expect(
      validateCreateAccountInput({
        companyName: '  Padaria do Bairro ',
        ownerEmail: ' Dono@Padaria.com ',
        ownerName: ' Maria ',
        trialDays: '14',
      }),
    ).toEqual({
      companyName: 'Padaria do Bairro',
      ownerEmail: 'dono@padaria.com',
      ownerName: 'Maria',
      trialDays: 14,
    })
  })

  it('leaves owner name and trial days empty when not given', () => {
    const v = validateCreateAccountInput({ companyName: 'Loja', ownerEmail: 'a@b.co' })
    expect(v.ownerName).toBeNull()
    expect(v.trialDays).toBeNull()
  })

  it.each([
    [{ ownerEmail: 'a@b.co' }, /nome da empresa/i],
    [{ companyName: 'X', ownerEmail: 'a@b.co' }, /nome da empresa/i],
    [{ companyName: 'Loja', ownerEmail: 'sem-arroba' }, /e-mail/i],
    [{ companyName: 'Loja' }, /e-mail/i],
    [{ companyName: 'Loja', ownerEmail: 'a@b.co', trialDays: 0 }, /dias de teste/i],
    [{ companyName: 'Loja', ownerEmail: 'a@b.co', trialDays: 400 }, /dias de teste/i],
    [{ companyName: 'Loja', ownerEmail: 'a@b.co', trialDays: 2.5 }, /dias de teste/i],
    [{ companyName: 'L'.repeat(81), ownerEmail: 'a@b.co' }, /no máximo/i],
  ])('rejects %j', (body, message) => {
    expect(() => validateCreateAccountInput(body)).toThrow(CreateAccountError)
    expect(() => validateCreateAccountInput(body)).toThrow(message)
  })

  it('rejects a non-object body', () => {
    expect(() => validateCreateAccountInput(null)).toThrow(CreateAccountError)
  })
})

describe('buildSetupLink', () => {
  it('points at the app callback with the recovery token and the reset page', () => {
    expect(buildSetupLink('https://crm.exemplo.com/', 'abc 123')).toBe(
      'https://crm.exemplo.com/auth/callback?token_hash=abc%20123&type=recovery&next=/reset-password',
    )
  })
})

// ---------------------------------------------------------------
// Minimal fake of the service-role client: just what the flow calls.
// ---------------------------------------------------------------
interface FakeOpts {
  existingProfile?: boolean
  createUserError?: { message: string }
  triggerCreatesAccount?: boolean
  linkError?: boolean
}

function fakeAdmin(opts: FakeOpts = {}) {
  const { triggerCreatesAccount = true } = opts
  const calls = {
    updates: [] as { table: string; patch: Record<string, unknown>; eq: [string, unknown] }[],
    inserts: [] as { table: string; row: Record<string, unknown> }[],
    deletedUsers: [] as string[],
  }

  const from = (table: string) => {
    const q = {
      filter: null as [string, unknown] | null,
      patch: null as Record<string, unknown> | null,
      select() {
        return q
      },
      eq(col: string, val: unknown) {
        q.filter = [col, val]
        return q
      },
      update(patch: Record<string, unknown>) {
        q.patch = patch
        return q
      },
      insert(row: Record<string, unknown>) {
        calls.inserts.push({ table, row })
        return Promise.resolve({ error: null })
      },
      maybeSingle() {
        if (table === 'profiles') {
          return Promise.resolve({ data: opts.existingProfile ? { user_id: 'u-old' } : null })
        }
        if (table === 'accounts') {
          return Promise.resolve({ data: triggerCreatesAccount ? { id: 'acc-1' } : null })
        }
        return Promise.resolve({ data: null })
      },
      // awaited directly for UPDATEs
      then(resolve: (v: { error: null }) => unknown) {
        if (q.patch && q.filter) calls.updates.push({ table, patch: q.patch, eq: q.filter })
        return Promise.resolve({ error: null }).then(resolve)
      },
    }
    return q
  }

  const auth = {
    admin: {
      createUser: vi.fn(async () =>
        opts.createUserError
          ? { data: { user: null }, error: opts.createUserError }
          : { data: { user: { id: 'user-1' } }, error: null },
      ),
      deleteUser: vi.fn(async (id: string) => {
        calls.deletedUsers.push(id)
        return { error: null }
      }),
      generateLink: vi.fn(async () =>
        opts.linkError
          ? { data: { properties: null }, error: { message: 'boom' } }
          : { data: { properties: { hashed_token: 'tok-xyz' } }, error: null },
      ),
    },
  }

  return { client: { from, auth } as never, calls, auth }
}

const input = {
  companyName: 'Padaria do Bairro',
  ownerEmail: 'dono@padaria.com',
  ownerName: 'Maria',
  trialDays: null,
}
const ctx = { siteUrl: 'https://crm.exemplo.com', actorUserId: 'staff-1', now: new Date('2026-10-28T00:00:00Z') }

describe('createAccountWithOwner', () => {
  it('creates the login, renames the account and returns a set-password link', async () => {
    const { client, calls, auth } = fakeAdmin()
    const res = await createAccountWithOwner(client, input, ctx)

    expect(auth.admin.createUser).toHaveBeenCalledWith({
      email: 'dono@padaria.com',
      email_confirm: true,
      user_metadata: { full_name: 'Maria' },
    })
    expect(res).toEqual({
      accountId: 'acc-1',
      ownerUserId: 'user-1',
      ownerEmail: 'dono@padaria.com',
      setupLink:
        'https://crm.exemplo.com/auth/callback?token_hash=tok-xyz&type=recovery&next=/reset-password',
    })
    expect(calls.updates).toContainEqual({
      table: 'accounts',
      patch: { name: 'Padaria do Bairro' },
      eq: ['id', 'acc-1'],
    })
    expect(calls.inserts).toContainEqual({
      table: 'platform_audit_log',
      row: expect.objectContaining({
        actor_user_id: 'staff-1',
        account_id: 'acc-1',
        action: 'account.created',
      }),
    })
  })

  it('never sets or returns a password', async () => {
    const { client, auth } = fakeAdmin()
    const res = await createAccountWithOwner(client, input, ctx)
    const args = (auth.admin.createUser.mock.calls[0] as unknown[])[0] as Record<string, unknown>
    expect(args).not.toHaveProperty('password')
    expect(Object.keys(res).some((k) => /password|senha/i.test(k))).toBe(false)
  })

  it('falls back to the company name for the owner when no name is given', async () => {
    const { client, auth } = fakeAdmin()
    await createAccountWithOwner(client, { ...input, ownerName: null }, ctx)
    expect(auth.admin.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ user_metadata: { full_name: 'Padaria do Bairro' } }),
    )
  })

  it('sets a custom trial end when trialDays is given', async () => {
    const { client, calls } = fakeAdmin()
    await createAccountWithOwner(client, { ...input, trialDays: 14 }, ctx)
    expect(calls.updates).toContainEqual({
      table: 'account_billing',
      patch: { trial_ends_at: '2026-11-11T00:00:00.000Z' },
      eq: ['account_id', 'acc-1'],
    })
  })

  it('leaves the default trial alone when trialDays is not given', async () => {
    const { client, calls } = fakeAdmin()
    await createAccountWithOwner(client, input, ctx)
    expect(calls.updates.some((u) => u.table === 'account_billing')).toBe(false)
  })

  it('refuses an e-mail that already has a profile, before creating anything', async () => {
    const { client, auth } = fakeAdmin({ existingProfile: true })
    await expect(createAccountWithOwner(client, input, ctx)).rejects.toMatchObject({
      code: 'conflict',
      status: 409,
    })
    expect(auth.admin.createUser).not.toHaveBeenCalled()
  })

  it('maps an "already registered" Auth error to a conflict', async () => {
    const { client } = fakeAdmin({ createUserError: { message: 'A user with this email address has already been registered' } })
    await expect(createAccountWithOwner(client, input, ctx)).rejects.toMatchObject({ code: 'conflict' })
  })

  it('reports other Auth failures as a 502 without leaking the provider message', async () => {
    const { client } = fakeAdmin({ createUserError: { message: 'smtp meltdown secret detail' } })
    const err = await createAccountWithOwner(client, input, ctx).catch((e) => e)
    expect(err).toBeInstanceOf(CreateAccountError)
    expect(err.status).toBe(502)
    expect(err.message).not.toMatch(/smtp|secret/i)
  })

  it('removes the login again when the trigger did not create an account', async () => {
    const { client, calls } = fakeAdmin({ triggerCreatesAccount: false })
    await expect(createAccountWithOwner(client, input, ctx)).rejects.toMatchObject({
      code: 'failed',
      status: 500,
    })
    expect(calls.deletedUsers).toEqual(['user-1'])
  })

  it('still succeeds, with no link, when the link cannot be generated', async () => {
    const { client } = fakeAdmin({ linkError: true })
    const res = await createAccountWithOwner(client, input, ctx)
    expect(res.accountId).toBe('acc-1')
    expect(res.setupLink).toBeNull()
  })
})
