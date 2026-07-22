import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// The Coexistence path (`isCoexistence: true`) must never call Meta's
// /register — the number is already registered to the customer's WhatsApp
// Business app, and re-registering it would conflict with that registration
// rather than being a harmless no-op (unlike the standard path, where
// /register genuinely is idempotent). This also checks the standard path is
// unaffected by the new branch.
// ---------------------------------------------------------------------------

const { verifyPhoneNumber, registerPhoneNumber, subscribeWabaToApp } = vi.hoisted(() => ({
  verifyPhoneNumber: vi.fn(async () => ({
    id: 'PNID-1',
    display_phone_number: '+15551234567',
  })),
  registerPhoneNumber: vi.fn(async () => ({ success: true, alreadyRegistered: false })),
  subscribeWabaToApp: vi.fn(async () => {}),
}))

vi.mock('@/lib/whatsapp/meta-api', () => ({
  verifyPhoneNumber,
  registerPhoneNumber,
  subscribeWabaToApp,
}))

// The admin client (service-role) is only used for the cross-account
// phone_number_id claim check — always report "not claimed" here.
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: () => {
      const b: Record<string, unknown> = {}
      const chain = () => b
      b.select = vi.fn(chain)
      b.eq = vi.fn(chain)
      b.neq = vi.fn(chain)
      b.maybeSingle = vi.fn(async () => ({ data: null, error: null }))
      return b
    },
  })),
}))

import { saveVerifiedWhatsAppConfig } from './persist-config'

const insertCalls: Array<Record<string, unknown>> = []
const updateCalls: Array<Record<string, unknown>> = []
let existingRow: Record<string, unknown> | null = null

function makeUserSupabase() {
  function builder() {
    let mode: 'select' | 'insert' | 'update' = 'select'
    let payload: Record<string, unknown> = {}
    const b: Record<string, unknown> = {}
    const chain = () => b
    b.select = vi.fn(chain)
    b.eq = vi.fn(chain)
    b.insert = vi.fn((p: Record<string, unknown>) => {
      mode = 'insert'
      payload = p
      return b
    })
    b.update = vi.fn((p: Record<string, unknown>) => {
      mode = 'update'
      payload = p
      return b
    })
    b.maybeSingle = vi.fn(() => Promise.resolve({ data: existingRow, error: null }))
    b.then = (resolve: (v: unknown) => unknown) => {
      if (mode === 'insert') insertCalls.push(payload)
      if (mode === 'update') updateCalls.push(payload)
      return resolve({ data: null, error: null })
    }
    return b
  }
  return { from: vi.fn(() => builder()) }
}

const BASE_ARGS = {
  accountId: 'acct-1',
  userId: 'user-1',
  phoneNumberId: 'PNID-1',
  wabaId: 'WABA-1',
  accessToken: 'plain-access-token',
}

describe('saveVerifiedWhatsAppConfig', () => {
  beforeEach(() => {
    insertCalls.length = 0
    updateCalls.length = 0
    existingRow = null
    vi.clearAllMocks()
    verifyPhoneNumber.mockResolvedValue({
      id: 'PNID-1',
      display_phone_number: '+15551234567',
    })
    registerPhoneNumber.mockResolvedValue({ success: true, alreadyRegistered: false })
    subscribeWabaToApp.mockResolvedValue(undefined)
  })

  describe('Coexistence path', () => {
    it('skips /register and marks the row as coexistence on first save', async () => {
      const result = await saveVerifiedWhatsAppConfig({
        supabase: makeUserSupabase() as never,
        ...BASE_ARGS,
        isCoexistence: true,
      })

      expect(registerPhoneNumber).not.toHaveBeenCalled()
      expect(result.registered).toBe(true)
      expect(result.registration_skipped).toBeFalsy()

      expect(insertCalls).toHaveLength(1)
      expect(insertCalls[0]).toMatchObject({ is_coexistence: true })
      expect(insertCalls[0].onboarded_at).toEqual(expect.any(String))
      expect(insertCalls[0].registered_at).toEqual(expect.any(String))
    })

    it('preserves the original onboarded_at on a repeat coexistence save', async () => {
      existingRow = {
        id: 'row-1',
        registered_at: '2026-01-01T00:00:00.000Z',
        phone_number_id: 'PNID-1',
        onboarded_at: '2026-01-01T00:00:00.000Z',
      }

      await saveVerifiedWhatsAppConfig({
        supabase: makeUserSupabase() as never,
        ...BASE_ARGS,
        isCoexistence: true,
      })

      expect(registerPhoneNumber).not.toHaveBeenCalled()
      expect(updateCalls).toHaveLength(1)
      expect(updateCalls[0].onboarded_at).toBe('2026-01-01T00:00:00.000Z')
    })
  })

  describe('Standard path (unaffected by the coexistence branch)', () => {
    it('skips /register when no PIN is supplied, without treating it as coexistence', async () => {
      const result = await saveVerifiedWhatsAppConfig({
        supabase: makeUserSupabase() as never,
        ...BASE_ARGS,
      })

      expect(registerPhoneNumber).not.toHaveBeenCalled()
      expect(result.registration_skipped).toBe(true)
      expect(result.registered).toBe(false)
      expect(insertCalls[0]).not.toMatchObject({ is_coexistence: true })
    })

    it('calls /register when a PIN is supplied', async () => {
      const result = await saveVerifiedWhatsAppConfig({
        supabase: makeUserSupabase() as never,
        ...BASE_ARGS,
        pin: '123456',
      })

      expect(registerPhoneNumber).toHaveBeenCalledTimes(1)
      expect(result.registered).toBe(true)
    })
  })
})
