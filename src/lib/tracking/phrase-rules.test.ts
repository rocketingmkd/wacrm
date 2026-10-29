import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  applyPhraseMatches,
  buildAttributionRow,
  ilikePattern,
  loadActiveRules,
  matchesPhrase,
  normalizeText,
  parseRuleInput,
  pickRule,
  selectUnattributed,
  type PhraseMessageRow,
} from './phrase-rules'

const row = (
  contactId: string,
  text: string | null,
  at: string,
  extra: Partial<{ isGroup: boolean }> = {},
): PhraseMessageRow => ({
  created_at: at,
  content_text: text,
  conversation: {
    id: `cv-${contactId}`,
    contact_id: contactId,
    contact: { name: `Nome ${contactId}`, phone: `+55${contactId}`, is_group: extra.isGroup ?? false },
  },
})

describe('normalizeText / matchesPhrase', () => {
  it('ignores case, accents and repeated spaces', () => {
    expect(normalizeText('  Olá,   VIM pelo  Site ')).toBe('ola, vim pelo site')
    expect(matchesPhrase('OLÁ! Vim pelo SITE e quero orçamento', 'vim  pelo site')).toBe(true)
    expect(matchesPhrase('quero orcamento', 'Orçamento')).toBe(true)
  })

  it('does not match a different phrase, an empty message or a too-short phrase', () => {
    expect(matchesPhrase('vim pelo instagram', 'vim pelo site')).toBe(false)
    expect(matchesPhrase(null, 'vim pelo site')).toBe(false)
    expect(matchesPhrase('qualquer coisa', 'a')).toBe(false)
    expect(matchesPhrase('qualquer coisa', '   ')).toBe(false)
  })
})

describe('pickRule', () => {
  it('prefers the longest matching phrase', () => {
    const rules = [
      { phrase: 'vim pelo site', label: 'geral' },
      { phrase: 'vim pelo site da promo', label: 'promo' },
    ]
    expect(pickRule(rules, 'Oi, vim pelo site da promo!')?.label).toBe('promo')
    expect(pickRule(rules, 'Oi, vim pelo site')?.label).toBe('geral')
    expect(pickRule(rules, 'Oi')).toBeNull()
  })
})

describe('ilikePattern', () => {
  it('is a superset of matchesPhrase for accented text', () => {
    expect(ilikePattern('Orçamento já')).toBe('%_r__m__t_%j_%')
    expect(ilikePattern('100% off_x')).toBe('%100\\%%_ff\\_x%')
  })
})

describe('selectUnattributed', () => {
  it('keeps only matching contacts without attribution', () => {
    const rows = [
      row('1', 'vim pelo site', '2026-01-01T10:00:00Z'),
      row('2', 'vim pelo site', '2026-01-02T10:00:00Z'),
      row('3', 'outra coisa', '2026-01-03T10:00:00Z'),
    ]
    const out = selectUnattributed(rows, 'Vim pelo SITE', new Set(['2']))
    expect(out.map((m) => m.contactId)).toEqual(['1'])
  })

  it('takes the earliest matching message of each contact', () => {
    const rows = [
      row('1', 'vim pelo site (primeira)', '2026-01-01T10:00:00Z'),
      row('1', 'vim pelo site (segunda)', '2026-02-01T10:00:00Z'),
    ]
    const out = selectUnattributed(rows, 'vim pelo site', new Set())
    expect(out).toHaveLength(1)
    expect(out[0].matchedAt).toBe('2026-01-01T10:00:00Z')
    expect(out[0].excerpt).toContain('primeira')
  })

  it('skips groups and empty messages', () => {
    const rows = [
      row('1', 'vim pelo site', '2026-01-01T10:00:00Z', { isGroup: true }),
      row('2', null, '2026-01-01T10:00:00Z'),
    ]
    expect(selectUnattributed(rows, 'vim pelo site', new Set())).toEqual([])
  })
})

describe('buildAttributionRow', () => {
  it('writes source and label of the rule, no session code, first message date', () => {
    expect(
      buildAttributionRow(
        'acc',
        { source: 'meta_site', label: 'Black Friday' },
        { contactId: 'c1', conversationId: 'cv1', matchedAt: '2026-01-01T10:00:00Z' },
      ),
    ).toEqual({
      account_id: 'acc',
      contact_id: 'c1',
      conversation_id: 'cv1',
      source: 'meta_site',
      utm_campaign: 'Black Friday',
      session_code: null,
      first_seen_at: '2026-01-01T10:00:00Z',
    })
  })
})

describe('applyPhraseMatches', () => {
  it('upserts with ignoreDuplicates and counts only inserted rows', async () => {
    const calls: { rows: unknown[]; opts: unknown }[] = []
    const db = {
      from: () => ({
        upsert: (rows: unknown[], opts: unknown) => {
          calls.push({ rows, opts })
          // The database skipped one conflicting row.
          return { select: async () => ({ data: rows.slice(1).map(() => ({ contact_id: 'x' })), error: null }) }
        },
      }),
    } as unknown as SupabaseClient
    const matches = [1, 2, 3].map((n) => ({
      contactId: `c${n}`,
      conversationId: `cv${n}`,
      name: null,
      phone: null,
      excerpt: '',
      matchedAt: '2026-01-01T10:00:00Z',
    }))
    const written = await applyPhraseMatches(db, 'acc', { source: 'google', label: 'x' }, matches)
    expect(written).toBe(2)
    expect(calls[0].opts).toEqual({ onConflict: 'account_id,contact_id', ignoreDuplicates: true })
    expect(calls[0].rows).toHaveLength(3)
  })

  it('does not touch the database without matches', async () => {
    const db = { from: () => { throw new Error('no call expected') } } as unknown as SupabaseClient
    expect(await applyPhraseMatches(db, 'acc', { source: 'google', label: 'x' }, [])).toBe(0)
  })
})

describe('loadActiveRules', () => {
  it('filters by account and active', async () => {
    const eqs: [string, unknown][] = []
    const chain = {
      select: () => chain,
      eq: (c: string, v: unknown) => {
        eqs.push([c, v])
        return eqs.length >= 2 ? Promise.resolve({ data: [{ id: 'r' }], error: null }) : chain
      },
    }
    const db = { from: () => chain } as unknown as SupabaseClient
    expect(await loadActiveRules(db, 'acc')).toHaveLength(1)
    expect(eqs).toEqual([['account_id', 'acc'], ['active', true]])
  })
})

describe('parseRuleInput', () => {
  it('accepts a valid rule and trims values', () => {
    expect(parseRuleInput({ phrase: '  vim pelo   site ', source: 'meta_site', label: ' Promo ' })).toEqual({
      ok: true,
      value: { phrase: 'vim pelo site', source: 'meta_site', label: 'Promo' },
    })
  })

  it('rejects short phrase, bad source and empty label', () => {
    expect(parseRuleInput({ phrase: 'ab', source: 'google', label: 'x' }).ok).toBe(false)
    expect(parseRuleInput({ phrase: 'abcd', source: 'tiktok', label: 'x' }).ok).toBe(false)
    expect(parseRuleInput({ phrase: 'abcd', source: 'google', label: '  ' }).ok).toBe(false)
    expect(parseRuleInput(null).ok).toBe(false)
  })
})
