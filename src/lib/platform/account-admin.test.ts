import { describe, expect, it, vi } from 'vitest'
import {
  AccountAdminError,
  deleteAccountAndUsers,
  generateTempPassword,
  resetOwnerPassword,
} from './account-admin'

const ACC = { id: 'acc1', name: 'Padaria', owner_user_id: 'owner1' }

function makeAdmin(opts: { members?: string[]; delAccError?: boolean; failUser?: string } = {}) {
  const calls: string[] = []
  const audit: unknown[] = []
  const raw = {
    from(table: string) {
      return {
        select: () => ({
          eq: () => {
            if (table === 'accounts') {
              return { maybeSingle: async () => ({ data: ACC, error: null }) }
            }
            return Promise.resolve({
              data: (opts.members ?? ['owner1']).map((user_id) => ({ user_id })),
              error: null,
            })
          },
        }),
        delete: () => ({
          eq: async () => {
            calls.push('delete-account')
            return { error: opts.delAccError ? { message: 'x' } : null }
          },
        }),
        insert: async (row: unknown) => {
          audit.push(row)
          return { error: null }
        },
      }
    },
    auth: {
      admin: {
        getUserById: vi.fn(async () => ({ data: { user: { email: 'Dono@Padaria.com' } }, error: null })),
        updateUserById: vi.fn(async () => ({ error: null })),
        generateLink: vi.fn(async () => ({ data: { properties: { hashed_token: 'tok' } }, error: null })),
        deleteUser: vi.fn(async (id: string) => {
          calls.push(`delete-user:${id}`)
          return { error: opts.failUser === id ? { message: 'x' } : null }
        }),
      },
    },
  }
  return { admin: raw as never, calls, audit, raw }
}

describe('generateTempPassword', () => {
  it('gera senhas fortes e diferentes', () => {
    const a = generateTempPassword()
    expect(a).toMatch(/^Rkt-[A-Za-z0-9]{10}\d!$/)
    expect(generateTempPassword()).not.toBe(a)
  })
})

describe('resetOwnerPassword', () => {
  it('modo senha: troca a senha e não grava a senha no log', async () => {
    const { admin, audit, raw } = makeAdmin()
    const r = await resetOwnerPassword(admin, 'acc1', 'password', {
      siteUrl: 'https://x.com',
      actorUserId: 'staff',
    })
    expect(r.password).toBeTruthy()
    expect(r.setupLink).toBeNull()
    expect(raw.auth.admin.updateUserById).toHaveBeenCalledWith('owner1', { password: r.password })
    expect(JSON.stringify(audit)).not.toContain(r.password as string)
    expect(audit[0]).toMatchObject({ action: 'account.password_reset' })
  })

  it('modo link: devolve o link de redefinição', async () => {
    const { admin } = makeAdmin()
    const r = await resetOwnerPassword(admin, 'acc1', 'link', {
      siteUrl: 'https://x.com/',
      actorUserId: 'staff',
    })
    expect(r.password).toBeNull()
    expect(r.setupLink).toBe(
      'https://x.com/auth/callback?token_hash=tok&type=recovery&next=/reset-password',
    )
  })
})

describe('deleteAccountAndUsers', () => {
  it('exige o e-mail do dono digitado', async () => {
    const { admin, calls } = makeAdmin()
    await expect(
      deleteAccountAndUsers(admin, 'acc1', 'outro@x.com', { actorUserId: 'staff' }),
    ).rejects.toThrow(/não confere/)
    expect(calls).toEqual([])
  })

  it('não apaga a própria conta do staff', async () => {
    const { admin, calls } = makeAdmin()
    await expect(
      deleteAccountAndUsers(admin, 'acc1', 'dono@padaria.com', { actorUserId: 'owner1' }),
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(calls).toEqual([])
  })

  it('apaga a conta primeiro e o dono por último', async () => {
    const { admin, calls, audit } = makeAdmin({ members: ['owner1', 'm1', 'm2'] })
    const r = await deleteAccountAndUsers(admin, 'acc1', ' DONO@padaria.com ', {
      actorUserId: 'staff',
    })
    expect(calls).toEqual(['delete-account', 'delete-user:m1', 'delete-user:m2', 'delete-user:owner1'])
    expect(r.deletedLogins).toBe(3)
    expect(audit[0]).toMatchObject({ action: 'account.deleted', account_id: null })
  })

  it('se apagar a conta falha, não mexe em nenhum login', async () => {
    const { admin, calls } = makeAdmin({ delAccError: true })
    await expect(
      deleteAccountAndUsers(admin, 'acc1', 'dono@padaria.com', { actorUserId: 'staff' }),
    ).rejects.toBeInstanceOf(AccountAdminError)
    expect(calls).toEqual(['delete-account'])
  })

  it('reporta logins que não saíram', async () => {
    const { admin } = makeAdmin({ failUser: 'owner1' })
    const r = await deleteAccountAndUsers(admin, 'acc1', 'dono@padaria.com', {
      actorUserId: 'staff',
    })
    expect(r.failedLogins).toEqual(['owner1'])
  })
})
