import type { PostgrestError } from '@supabase/supabase-js'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { pgErrorToResponse, type PgErrorMapping } from './pg-error'

const err = (code: string, message = 'raised by the rpc'): PostgrestError =>
  ({ code, message, details: '', hint: '', name: 'PostgrestError' }) as PostgrestError

const mapping: PgErrorMapping = {
  label: 'test route',
  fallbackMessage: 'Something went wrong',
  statuses: { '42501': 403, '22023': 400 },
}

describe('pgErrorToResponse', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('passes the Postgres message through with the mapped status', async () => {
    const res = pgErrorToResponse(err('42501', 'not allowed'), mapping)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'not allowed' })

    const res2 = pgErrorToResponse(err('22023', 'bad input'), mapping)
    expect(res2.status).toBe(400)
    expect(await res2.json()).toEqual({ error: 'bad input' })
  })

  it('uses the per-route status for the same code', () => {
    const invite: PgErrorMapping = { ...mapping, statuses: { '42501': 401, '23505': 409 } }
    expect(pgErrorToResponse(err('42501'), invite).status).toBe(401)
    expect(pgErrorToResponse(err('23505'), invite).status).toBe(409)
  })

  it('logs and answers a generic 500 for an unmapped code without leaking the message', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = pgErrorToResponse(err('XX000', 'relation "secret_table" does not exist'), mapping)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Something went wrong' })
    expect(spy).toHaveBeenCalledOnce()
    expect(spy.mock.calls[0][0]).toBe('[test route] unexpected RPC error:')
  })
})
