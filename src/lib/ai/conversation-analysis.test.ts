import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./config', () => ({ loadCopilotConfig: vi.fn() }))
vi.mock('./generate', () => ({ generateReply: vi.fn() }))
vi.mock('./usage', () => ({ logAiUsage: vi.fn() }))

import { loadCopilotConfig } from './config'
import { generateReply } from './generate'
import { AiError } from './types'
import { analyzeConversation } from './conversation-analysis'

const CONFIG = { provider: 'openai', model: 'm', apiKey: 'k' }

/** Cliente de teste: devolve a conversa (ou null) e as mensagens dadas. */
function fakeDb(opts: { conversation: boolean; messages: unknown[] }) {
  const chain = (data: unknown) => {
    const q: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'order', 'limit']) q[m] = () => q
    q.maybeSingle = async () => ({ data })
    q.then = (resolve: (v: unknown) => void) => resolve({ data })
    return q
  }
  return {
    from: (table: string) => (table === 'conversations' ? chain(opts.conversation ? { id: 'c1' } : null) : chain(opts.messages)),
  } as never
}

const msg = (sender: string, text: string, at: string) => ({ sender_type: sender, content_text: text, created_at: at })
const TWO = [msg('customer', 'oi, quero preço', '2026-10-01T10:00:00Z'), msg('agent', 'olá!', '2026-10-01T10:10:00Z')]

beforeEach(() => {
  vi.mocked(loadCopilotConfig).mockReset()
  vi.mocked(generateReply).mockReset()
  vi.mocked(loadCopilotConfig).mockResolvedValue(CONFIG as never)
})

describe('analyzeConversation', () => {
  it('404 quando a conversa não é da conta', async () => {
    const r = await analyzeConversation(fakeDb({ conversation: false, messages: TWO }), 'acc', 'c1')
    expect(r).toMatchObject({ ok: false, status: 404 })
    expect(generateReply).not.toHaveBeenCalled()
  })

  it('503 sem chave de IA e 422 com poucas mensagens', async () => {
    vi.mocked(loadCopilotConfig).mockResolvedValueOnce(null as never)
    expect(await analyzeConversation(fakeDb({ conversation: true, messages: TWO }), 'acc', 'c1')).toMatchObject({ status: 503 })
    const few = await analyzeConversation(fakeDb({ conversation: true, messages: [TWO[0]] }), 'acc', 'c1')
    expect(few).toMatchObject({ ok: false, status: 422 })
    expect(generateReply).not.toHaveBeenCalled()
  })

  it('devolve a ficha da IA com as métricas calculadas em código', async () => {
    vi.mocked(generateReply).mockResolvedValue({
      text: '{"summary":"Quer preço","intent":"preço","outcome":"em_andamento","quality":4,"objections":[],"failures":[],"next_action":"enviar proposta"}',
      usage: null,
    } as never)
    const r = await analyzeConversation(fakeDb({ conversation: true, messages: TWO }), 'acc', 'c1', new Date('2026-10-01T12:10:00Z'))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.analysis).toMatchObject({ outcome: 'em_andamento', quality: 4, nextAction: 'enviar proposta' })
      expect(r.value.metrics.firstResponseMin).toBe(10)
      expect(r.value.messagesRead).toBe(2)
    }
  })

  it('502 quando a IA falha ou responde fora do formato', async () => {
    vi.mocked(generateReply).mockRejectedValueOnce(new AiError('boom', { code: 'x', status: 500 }))
    expect(await analyzeConversation(fakeDb({ conversation: true, messages: TWO }), 'acc', 'c1')).toMatchObject({ status: 502 })
    vi.mocked(generateReply).mockResolvedValueOnce({ text: 'não sei', usage: null } as never)
    expect(await analyzeConversation(fakeDb({ conversation: true, messages: TWO }), 'acc', 'c1')).toMatchObject({ status: 502 })
  })
})
