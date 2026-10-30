import { describe, expect, it } from 'vitest'

import {
  aggregateReport,
  computeMetrics,
  parseAnalysis,
  parseNarrative,
  toChatMessages,
  type ConversationAnalysis,
  type ConversationMetrics,
  type RawMessage,
  type ReportItem,
} from './reports'

const msg = (sender: string, text: string, at: string): RawMessage => ({
  sender_type: sender,
  content_text: text,
  created_at: at,
})

describe('computeMetrics', () => {
  it('mede a primeira resposta e a média das respostas', () => {
    const m = computeMetrics(
      [
        msg('customer', 'oi', '2026-10-01T10:00:00Z'),
        msg('agent', 'olá', '2026-10-01T10:30:00Z'),
        msg('customer', 'preço?', '2026-10-01T11:00:00Z'),
        msg('bot', 'R$ 100', '2026-10-01T11:10:00Z'),
      ],
      new Date('2026-10-01T13:10:00Z'),
    )
    expect(m.firstResponseMin).toBe(30)
    expect(m.avgResponseMin).toBe(20)
    expect(m.customerMessages).toBe(2)
    expect(m.teamMessages).toBe(2)
    expect(m.unanswered).toBe(false)
    expect(m.hoursSinceLast).toBe(2)
  })

  it('marca como sem resposta quando a última mensagem é do cliente', () => {
    const m = computeMetrics([msg('customer', 'oi', '2026-10-01T10:00:00Z')], new Date('2026-10-02T10:00:00Z'))
    expect(m.unanswered).toBe(true)
    expect(m.firstResponseMin).toBeNull()
    expect(m.hoursSinceLast).toBe(24)
  })

  it('ignora mensagens vazias e aguenta lista vazia', () => {
    const m = computeMetrics([msg('customer', '   ', '2026-10-01T10:00:00Z')])
    expect(m.customerMessages).toBe(0)
    expect(m.unanswered).toBe(false)
    expect(computeMetrics([]).lastMessageAt).toBeNull()
  })
})

describe('parseAnalysis', () => {
  it('lê o JSON, limita a nota e troca outcome desconhecido por outro', () => {
    const a = parseAnalysis(
      '```json\n{"summary":"Quer orçamento","intent":"orçamento","outcome":"xyz","quality":9,"objections":["caro"],"failures":[],"next_action":"ligar"}\n```',
    )
    expect(a).toMatchObject({ outcome: 'outro', quality: 5, objections: ['caro'], nextAction: 'ligar' })
  })

  it('devolve null quando não é JSON', () => {
    expect(parseAnalysis('não sei')).toBeNull()
    expect(parseAnalysis('{quebrado')).toBeNull()
  })
})

describe('parseNarrative', () => {
  it('exige ao menos título ou achados', () => {
    expect(parseNarrative('{"headline":"","findings":[],"recommendations":["x"]}')).toBeNull()
    expect(parseNarrative('{"headline":"ok","findings":["a"],"recommendations":["b"]}')).toEqual({
      headline: 'ok',
      findings: ['a'],
      recommendations: ['b'],
    })
  })
})

describe('toChatMessages', () => {
  it('mapeia papéis, corta o tamanho e mantém início e fim das conversas longas', () => {
    const many = Array.from({ length: 100 }, (_, i) =>
      msg(i % 2 ? 'agent' : 'customer', `m${i}`, `2026-10-01T10:${String(i % 60).padStart(2, '0')}:00Z`),
    )
    const out = toChatMessages(many)
    expect(out).toHaveLength(40)
    expect(out[0].content).toBe('m0')
    expect(out[out.length - 1].content).toBe('m99')
    expect(out[0].role).toBe('user')
    expect(toChatMessages([msg('customer', 'x'.repeat(2000), '2026-10-01T10:00:00Z')])[0].content).toHaveLength(600)
  })
})

describe('aggregateReport', () => {
  const metrics = (over: Partial<ConversationMetrics>): ConversationMetrics => ({
    customerMessages: 3,
    teamMessages: 2,
    firstResponseMin: 10,
    avgResponseMin: 10,
    unanswered: false,
    hoursSinceLast: 5,
    firstMessageAt: null,
    lastMessageAt: null,
    source: 'meta_site',
    campaign: null,
    ...over,
  })
  const analysis = (over: Partial<ConversationAnalysis>): ConversationAnalysis => ({
    summary: 's',
    intent: 'i',
    outcome: 'em_andamento',
    quality: 4,
    objections: [],
    failures: [],
    nextAction: '',
    ...over,
  })
  const item = (id: string, m: Partial<ConversationMetrics>, a: Partial<ConversationAnalysis> | null): ReportItem => ({
    conversationId: id,
    metrics: metrics(m),
    analysis: a ? analysis(a) : null,
  })

  it('soma resultados, compara por origem e conta objeções sem repetir por conversa', () => {
    const agg = aggregateReport([
      item('1', { firstResponseMin: 10 }, { outcome: 'fechado', quality: 5, objections: ['Caro', 'caro'] }),
      item('2', { firstResponseMin: 30, source: 'google' }, { outcome: 'perdido', quality: 2, objections: ['caro'], failures: ['demorou'] }),
      item('3', { firstResponseMin: null, unanswered: true, source: 'google', hoursSinceLast: 50 }, { outcome: 'sem_resposta_da_equipe', quality: 1, nextAction: 'retomar' }),
      item('4', {}, null),
    ])
    expect(agg.conversations).toBe(4)
    expect(agg.analyzed).toBe(3)
    expect(agg.skipped).toBe(1)
    expect(agg.closedPct).toBe(33.3)
    expect(agg.unansweredPct).toBe(25)
    expect(agg.avgFirstResponseMin).toBe(16.7)
    expect(agg.medianFirstResponseMin).toBe(10)
    expect(agg.topObjections[0]).toMatchObject({ count: 2 })
    expect(agg.bySource.google).toMatchObject({ conversations: 2, lost: 1, unansweredByTeam: 1 })
    expect(agg.attention.map((a) => a.conversationId)).toEqual(['3'])
  })

  it('não quebra sem nenhuma conversa analisada', () => {
    const agg = aggregateReport([])
    expect(agg).toMatchObject({ conversations: 0, analyzed: 0, unansweredPct: 0, closedPct: 0, avgQuality: null })
  })
})
