import { describe, it, expect } from 'vitest'
import { buildPromptSuggestMessages } from './prompt-suggest'

describe('buildPromptSuggestMessages', () => {
  it('generate mode: folds the form fields into the user message', () => {
    const { system, user } = buildPromptSuggestMessages({
      mode: 'generate',
      agentName: 'Agendador',
      role: 'agendar reunião',
      avoids: 'falar preço',
      handoffWhen: 'após confirmar dia e hora',
      tone: 'Direto',
      notes: 'Reuniões só de manhã',
    })
    expect(user).toContain('Nome do agente: Agendador')
    expect(user).toContain('O que ele faz: agendar reunião')
    expect(user).toContain('O que ele NÃO faz: falar preço')
    expect(user).toContain('Quando passar para um humano: após confirmar dia e hora')
    expect(user).toContain('Tom: Direto')
    expect(user).toContain('Observações / regras do negócio: Reuniões só de manhã')
    // the meta-prompt tells the model what the scaffold already owns
    expect(system).toContain('[[HANDOFF]]')
    expect(system).toContain('APPENDED')
    expect(system).toContain('STOP condition')
  })

  it('generate mode: missing fields render as "(não informado)"', () => {
    const { user } = buildPromptSuggestMessages({ mode: 'generate', role: 'x' })
    expect(user).toContain('O que ele NÃO faz: (não informado)')
    expect(user).toContain('Tom: (não informado)')
  })

  it('improve mode: embeds the current prompt for a rewrite', () => {
    const { user } = buildPromptSuggestMessages({
      mode: 'improve',
      agentName: 'Suporte',
      current: 'Você responde tudo e nunca transfere.',
    })
    expect(user).toContain('Reescreva o prompt de agente abaixo')
    expect(user).toContain('Você responde tudo e nunca transfere.')
    expect(user).toContain('--- prompt atual ---')
  })

  it('improve mode: empty current still produces a well-formed message', () => {
    const { user } = buildPromptSuggestMessages({ mode: 'improve', current: '' })
    expect(user).toContain('(vazio)')
  })
})
