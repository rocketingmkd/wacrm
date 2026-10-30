import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/account', () => ({
  requireRole: vi.fn(async () => ({ accountId: 'acc-1', userId: 'user-1' })),
  toErrorResponse: (e: unknown) => new Response(JSON.stringify({ error: String(e) }), { status: 500 }),
}))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => new Response('limit', { status: 429 }),
  RATE_LIMITS: { phraseScan: {}, phraseScanAccount: {} },
}))
vi.mock('@/lib/ai/admin-client', () => ({ supabaseAdmin: () => ({}) }))
vi.mock('@/lib/tracking/phrase-rules', async (orig) => ({
  ...(await orig<typeof import('@/lib/tracking/phrase-rules')>()),
  findPhraseMatches: vi.fn(),
  applyPhraseMatches: vi.fn(),
}))

import { applyPhraseMatches, findPhraseMatches } from '@/lib/tracking/phrase-rules'
import { POST } from './route'

const match = (id: string) => ({
  contactId: id,
  conversationId: `conv-${id}`,
  name: `Nome ${id}`,
  phone: `55${id}`,
  excerpt: 'vim pelo site',
  matchedAt: '2026-10-01T10:00:00Z',
})

const post = (body: unknown) =>
  POST(new Request('http://x/api/tracking/manual-origin', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  vi.mocked(findPhraseMatches).mockReset()
  vi.mocked(applyPhraseMatches).mockReset()
  vi.mocked(findPhraseMatches).mockResolvedValue({ matches: [match('a'), match('b'), match('c')], truncated: false })
  vi.mocked(applyPhraseMatches).mockImplementation(async (_db, _acc, _rule, m) => m.length)
})

describe('POST /api/tracking/manual-origin', () => {
  it('rejeita frase curta sem buscar nada', async () => {
    const res = await post({ action: 'search', phrase: 'oi' })
    expect(res.status).toBe(400)
    expect(findPhraseMatches).not.toHaveBeenCalled()
  })

  it('busca na conta da sessão e devolve a lista', async () => {
    const res = await post({ action: 'search', phrase: 'vim pelo site', accountId: 'outra-conta' })
    const json = await res.json()
    expect(findPhraseMatches).toHaveBeenCalledWith(expect.anything(), 'acc-1', 'vim pelo site')
    expect(json.total).toBe(3)
    expect(json.contacts).toHaveLength(3)
  })

  it('só marca contatos que também aparecem na busca da frase', async () => {
    const res = await post({
      action: 'apply',
      phrase: 'vim pelo site',
      label: 'Search Marca',
      contactIds: ['a', 'c', 'contato-de-outra-conta'],
    })
    const json = await res.json()
    expect(res.status).toBe(200)
    const [, accountId, rule, applied] = vi.mocked(applyPhraseMatches).mock.calls[0]
    expect(accountId).toBe('acc-1')
    expect(rule).toEqual({ source: 'google', label: 'Search Marca' })
    expect(applied.map((m) => m.contactId)).toEqual(['a', 'c'])
    expect(json).toMatchObject({ requested: 3, matched: 2, written: 2 })
  })

  it('exige nome da campanha e ao menos um contato', async () => {
    expect((await post({ action: 'apply', phrase: 'vim pelo site', label: '', contactIds: ['a'] })).status).toBe(400)
    expect((await post({ action: 'apply', phrase: 'vim pelo site', label: 'X', contactIds: [] })).status).toBe(400)
    expect(applyPhraseMatches).not.toHaveBeenCalled()
  })

  it('recusa ação desconhecida', async () => {
    expect((await post({ action: 'apagar', phrase: 'vim pelo site' })).status).toBe(400)
  })
})
