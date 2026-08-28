import { describe, it, expect } from 'vitest'
import {
  buildCopilotSystemPrompt,
  parseCopilotInsight,
  type CopilotContext,
} from './copilot'

const baseContext: CopilotContext = {
  businessPrompt: null,
  stageNames: ['Novo Lead', 'Qualificado', 'Proposta', 'Fechado'],
  deal: null,
  contactTags: [],
  knowledge: [],
}

const validJson = JSON.stringify({
  temperature: 'hot',
  temperature_reason: 'pediu link de pagamento',
  customer_wants: 'fechar o plano anual',
  open_questions: ['qual o prazo de implantação?'],
  suggested_stage: 'Proposta',
  next_actions: [
    { label: 'Enviar o link de pagamento', kind: 'reply', draft_hint: 'mandar link + prazo' },
    { label: 'Mover o card para Proposta', kind: 'move_stage' },
  ],
})

describe('parseCopilotInsight', () => {
  it('parses a well-formed object', () => {
    const out = parseCopilotInsight(validJson, baseContext.stageNames)
    expect(out.temperature).toBe('hot')
    expect(out.customerWants).toBe('fechar o plano anual')
    expect(out.openQuestions).toEqual(['qual o prazo de implantação?'])
    expect(out.suggestedStage).toBe('Proposta')
    expect(out.nextActions).toHaveLength(2)
    expect(out.nextActions[0]).toEqual({
      label: 'Enviar o link de pagamento',
      kind: 'reply',
      draftHint: 'mandar link + prazo',
    })
  })

  it('unwraps a ```json fenced block', () => {
    const out = parseCopilotInsight('```json\n' + validJson + '\n```')
    expect(out.temperature).toBe('hot')
  })

  it('degrades to an empty insight on non-JSON', () => {
    const out = parseCopilotInsight('desculpe, não consegui analisar')
    expect(out.temperature).toBe('cold')
    expect(out.nextActions).toEqual([])
    expect(out.openQuestions).toEqual([])
    expect(out.suggestedStage).toBeNull()
  })

  it('nulls a hallucinated stage not in the allowed list', () => {
    const raw = JSON.stringify({ ...JSON.parse(validJson), suggested_stage: 'Enviado pra Marte' })
    const out = parseCopilotInsight(raw, baseContext.stageNames)
    expect(out.suggestedStage).toBeNull()
  })

  it('keeps a stage when no allow-list is supplied', () => {
    const out = parseCopilotInsight(validJson, [])
    expect(out.suggestedStage).toBe('Proposta')
  })

  it('coerces a bad temperature to cold and drops invalid actions', () => {
    const raw = JSON.stringify({
      temperature: 'boiling',
      open_questions: 'não é um array',
      next_actions: [
        { label: '', kind: 'reply' },
        { kind: 'reply' },
        { label: 'ok', kind: 'inventado' },
      ],
    })
    const out = parseCopilotInsight(raw)
    expect(out.temperature).toBe('cold')
    expect(out.openQuestions).toEqual([])
    expect(out.nextActions).toEqual([{ label: 'ok', kind: 'info' }])
  })

  it('caps next_actions at 3', () => {
    const raw = JSON.stringify({
      temperature: 'warm',
      next_actions: Array.from({ length: 6 }, (_, i) => ({ label: `a${i}`, kind: 'info' })),
    })
    expect(parseCopilotInsight(raw).nextActions).toHaveLength(3)
  })

  it('drops draft_hint for non-reply kinds', () => {
    const raw = JSON.stringify({
      temperature: 'warm',
      next_actions: [{ label: 'x', kind: 'reminder', draft_hint: 'ignore me' }],
    })
    expect(parseCopilotInsight(raw).nextActions[0]).toEqual({
      label: 'x',
      kind: 'reminder',
    })
  })
})

describe('buildCopilotSystemPrompt', () => {
  it('lists the account stages the model may suggest', () => {
    const p = buildCopilotSystemPrompt(baseContext)
    expect(p).toContain('"Novo Lead"')
    expect(p).toContain('"Fechado"')
  })

  it('states there is no pipeline when stageNames is empty', () => {
    const p = buildCopilotSystemPrompt({ ...baseContext, stageNames: [] })
    expect(p).toMatch(/não tem funil/i)
    expect(p).toMatch(/suggested_stage.*null/i)
  })

  it('includes the linked deal stage + value', () => {
    const p = buildCopilotSystemPrompt({
      ...baseContext,
      deal: { stageName: 'Qualificado', value: 5000, currency: 'BRL' },
    })
    expect(p).toContain('Qualificado')
    expect(p).toContain('5000')
  })

  it('folds in business context, tags and knowledge when present', () => {
    const p = buildCopilotSystemPrompt({
      ...baseContext,
      businessPrompt: 'Vendemos software de gestão.',
      contactTags: ['quente', 'indústria'],
      knowledge: ['O plano anual custa R$ 1.200.'],
    })
    expect(p).toContain('Vendemos software de gestão.')
    expect(p).toContain('quente, indústria')
    expect(p).toContain('O plano anual custa R$ 1.200.')
  })
})
