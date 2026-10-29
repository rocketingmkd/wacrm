import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { recordLeadAttribution } from './record'

interface Fake {
  db: SupabaseClient
  upserts: Record<string, unknown>[]
}

/** Minimal stand-in for the two tables the recorder touches. */
function fakeDb(opts: {
  existingAttribution?: boolean
  session?: Record<string, unknown> | null
  upsertError?: string
}): Fake {
  const upserts: Record<string, unknown>[] = []
  const db = {
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => {
          if (table === 'lead_attribution') {
            return { data: opts.existingAttribution ? { id: 'x' } : null }
          }
          return { data: opts.session ?? null }
        },
        upsert: async (row: Record<string, unknown>) => {
          upserts.push(row)
          return { error: opts.upsertError ? { message: opts.upsertError } : null }
        },
      }
      return chain
    },
  } as unknown as SupabaseClient
  return { db, upserts }
}

const base = { accountId: 'acc', contactId: 'ct', conversationId: 'cv' }

describe('recordLeadAttribution', () => {
  it('stores a Click to WhatsApp referral', async () => {
    const { db, upserts } = fakeDb({})
    const out = await recordLeadAttribution({
      ...base,
      db,
      referral: { source_id: 'AD1', ctwa_clid: 'CLID', headline: 'Oferta' },
      messageText: 'Oi',
    })
    expect(out).toBe('recorded')
    expect(upserts[0]).toMatchObject({
      account_id: 'acc',
      contact_id: 'ct',
      conversation_id: 'cv',
      source: 'meta_ctwa',
      ad_id: 'AD1',
      ctwa_clid: 'CLID',
    })
  })

  it('stores a landing page session found through the code', async () => {
    const { db, upserts } = fakeDb({
      session: { utm_source: 'google', utm_campaign: 'black', gclid: 'G1' },
    })
    const out = await recordLeadAttribution({
      ...base,
      db,
      referral: undefined,
      messageText: 'Quero saber mais\n[#ABCD2345]',
    })
    expect(out).toBe('recorded')
    expect(upserts[0]).toMatchObject({
      source: 'google',
      session_code: 'ABCD2345',
      utm_campaign: 'black',
      gclid: 'G1',
    })
  })

  it('keeps the first touch', async () => {
    const { db, upserts } = fakeDb({ existingAttribution: true })
    const out = await recordLeadAttribution({
      ...base,
      db,
      referral: { source_id: 'AD2' },
      messageText: 'Oi',
    })
    expect(out).toBe('already')
    expect(upserts).toHaveLength(0)
  })

  it('does nothing for a plain message', async () => {
    const { db, upserts } = fakeDb({})
    const out = await recordLeadAttribution({ ...base, db, referral: undefined, messageText: 'Oi' })
    expect(out).toBe('none')
    expect(upserts).toHaveLength(0)
  })

  it('ignores a code that matches no session', async () => {
    const { db, upserts } = fakeDb({ session: null })
    const out = await recordLeadAttribution({
      ...base,
      db,
      referral: undefined,
      messageText: '[#ZZZZ9999]',
    })
    expect(out).toBe('none')
    expect(upserts).toHaveLength(0)
  })

  it('ignores a session without campaign data', async () => {
    const { db, upserts } = fakeDb({ session: { landing_url: 'https://x.com' } })
    const out = await recordLeadAttribution({
      ...base,
      db,
      referral: undefined,
      messageText: '[#ABCD2345]',
    })
    expect(out).toBe('none')
    expect(upserts).toHaveLength(0)
  })

  it('reports an error without throwing', async () => {
    const { db } = fakeDb({ upsertError: 'boom' })
    const out = await recordLeadAttribution({
      ...base,
      db,
      referral: { source_id: 'AD3' },
      messageText: 'Oi',
    })
    expect(out).toBe('error')
  })
})

/** Fake with the phrase rules table; counts how often it is read. */
function fakeDbWithRules(rules: Record<string, unknown>[]) {
  const upserts: Record<string, unknown>[] = []
  let ruleReads = 0
  const db = {
    from(table: string) {
      if (table === 'attribution_phrase_rules') {
        const chain = {
          select: () => chain,
          eq: (col: string) => {
            if (col === 'active') {
              ruleReads += 1
              return Promise.resolve({ data: rules, error: null })
            }
            return chain
          },
        }
        return chain
      }
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: null }),
        upsert: async (row: Record<string, unknown>) => {
          upserts.push(row)
          return { error: null }
        },
      }
      return chain
    },
  } as unknown as SupabaseClient
  return { db, upserts, reads: () => ruleReads }
}

describe('recordLeadAttribution: phrase rules', () => {
  const rules = [{ id: 'r1', phrase: 'vim pelo site', source: 'meta_site', label: 'Promo Site' }]

  it('tags a new conversation whose message matches an active rule', async () => {
    const { db, upserts } = fakeDbWithRules(rules)
    const out = await recordLeadAttribution({
      ...base,
      db,
      referral: undefined,
      messageText: 'Olá! VIM pelo site e quero orçamento',
      seenAt: '2026-03-01T12:00:00.000Z',
      isNewConversation: true,
    })
    expect(out).toBe('recorded')
    expect(upserts[0]).toMatchObject({
      account_id: 'acc',
      contact_id: 'ct',
      source: 'meta_site',
      utm_campaign: 'Promo Site',
      session_code: null,
      first_seen_at: '2026-03-01T12:00:00.000Z',
    })
  })

  it('does not read the rules for an existing conversation', async () => {
    const { db, upserts, reads } = fakeDbWithRules(rules)
    const out = await recordLeadAttribution({
      ...base,
      db,
      referral: undefined,
      messageText: 'vim pelo site',
      isNewConversation: false,
    })
    expect(out).toBe('none')
    expect(reads()).toBe(0)
    expect(upserts).toHaveLength(0)
  })

  it('leaves a CTWA referral alone: the rules are not consulted', async () => {
    const { db, upserts, reads } = fakeDbWithRules(rules)
    const out = await recordLeadAttribution({
      ...base,
      db,
      referral: { source_id: 'AD1' },
      messageText: 'vim pelo site',
      isNewConversation: true,
    })
    expect(out).toBe('recorded')
    expect(reads()).toBe(0)
    expect(upserts[0]).toMatchObject({ source: 'meta_ctwa' })
  })

  it('keeps today\'s behaviour when there is no rule', async () => {
    const { db, upserts } = fakeDbWithRules([])
    const out = await recordLeadAttribution({
      ...base,
      db,
      referral: undefined,
      messageText: 'vim pelo site',
      isNewConversation: true,
    })
    expect(out).toBe('none')
    expect(upserts).toHaveLength(0)
  })
})
