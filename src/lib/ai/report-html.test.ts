import { describe, expect, it } from 'vitest'

import { buildReportHtml, esc, formatMinutes, type ReportHtmlInput } from './report-html'
import { aggregateReport } from './reports'

describe('formatMinutes', () => {
  it('formata minutos, horas e dias', () => {
    expect(formatMinutes(null)).toBe('—')
    expect(formatMinutes(12.5)).toBe('12,5 min')
    expect(formatMinutes(75)).toBe('1h 15min')
    expect(formatMinutes(120)).toBe('2h')
    expect(formatMinutes(60 * 26)).toBe('1d 2h')
  })
})

describe('buildReportHtml', () => {
  const base: ReportHtmlInput = {
    mode: 'keyword',
    keyword: '<script>x</script>',
    sourceFilter: 'google',
    dateFrom: null,
    dateTo: null,
    createdAt: '2026-10-29T12:00:00Z',
    finishedAt: '2026-10-29T12:30:00Z',
    model: 'gpt-x',
    aggregate: aggregateReport([]),
    narrative: { headline: 'Resposta lenta <b>', findings: ['a'], recommendations: ['b'] },
    rows: [
      {
        conversationId: 'abc',
        name: 'Ana "A" <i>',
        phone: null,
        source: 'google',
        campaign: null,
        outcome: 'fechado',
        quality: 5,
        firstResponseMin: 3,
        unanswered: false,
        summary: 'ok',
        nextAction: '',
      },
    ],
  }

  it('escapa texto de cliente e da IA e não traz link de conversa', () => {
    const html = buildReportHtml(base)
    expect(html).not.toContain('<script>x</script>')
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;')
    expect(html).toContain('Ana &quot;A&quot; &lt;i&gt;')
    expect(html).toContain('Resposta lenta &lt;b&gt;')
    expect(html).not.toContain('Abrir conversa')
    expect(html).not.toContain('/inbox')
  })

  it('traz a logo inline e as seis abas com papéis de acessibilidade', () => {
    const html = buildReportHtml(base)
    expect(html).toContain('aria-label="Rocketing IA"')
    expect((html.match(/role="tab"/g) ?? []).length).toBe(6)
    expect((html.match(/role="tabpanel"/g) ?? []).length).toBe(6)
    for (const id of ['tab-resumo', 'tab-resultado', 'tab-origem', 'tab-objecoes', 'tab-acao', 'tab-conversas']) {
      expect(html).toContain(`id="${id}"`)
    }
    // Só a primeira aba começa visível; os ids de gradiente da logo não se repetem.
    expect((html.match(/ hidden>/g) ?? []).length).toBe(5)
    expect(html).toContain('id="goldGradTop"')
    expect(html).toContain('id="goldGradFoot"')
  })

  it('usa a identidade da Rocketing', () => {
    const html = buildReportHtml(base)
    expect(html).toContain('Playfair')
    expect(html).toContain('Inter')
    expect(html).toContain('#B8902A')
    expect(html).toContain('rocketing-report-theme')
  })

  it('não quebra sem resumo da IA nem conversas', () => {
    const html = buildReportHtml({ ...base, narrative: null, rows: [] })
    expect(html).toContain('não foi gerado')
    expect(esc(null)).toBe('')
  })
})
