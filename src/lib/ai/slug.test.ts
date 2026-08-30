import { describe, it, expect } from 'vitest'
import { isValidAgentSlug, slugifyAgentName } from './slug'

describe('slugifyAgentName', () => {
  it('lower-cases and hyphenates', () => {
    expect(slugifyAgentName('Suporte Técnico')).toBe('suporte-tecnico')
  })

  it('strips accents', () => {
    expect(slugifyAgentName('Atendimento à Distância')).toBe('atendimento-a-distancia')
  })

  it('collapses repeated separators and trims edges', () => {
    expect(slugifyAgentName('  Vendas & Pós-Venda!! ')).toBe('vendas-pos-venda')
  })

  it('falls back to "agente" for input with no latinizable characters', () => {
    expect(slugifyAgentName('🤖🤖🤖')).toBe('agente')
  })
})

describe('isValidAgentSlug', () => {
  it('accepts lower-case letters, digits, hyphen, underscore', () => {
    expect(isValidAgentSlug('suporte-tecnico_1')).toBe(true)
  })

  it('rejects uppercase, spaces, and empty strings', () => {
    expect(isValidAgentSlug('Suporte')).toBe(false)
    expect(isValidAgentSlug('suporte tecnico')).toBe(false)
    expect(isValidAgentSlug('')).toBe(false)
  })

  it('rejects non-strings', () => {
    expect(isValidAgentSlug(null)).toBe(false)
    expect(isValidAgentSlug(42)).toBe(false)
  })
})
