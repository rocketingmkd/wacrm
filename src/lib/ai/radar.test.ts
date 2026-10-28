import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./config', () => ({ loadReceptionistAgent: vi.fn() }))
vi.mock('./generate', () => ({ generateReply: vi.fn() }))
vi.mock('./context', () => ({ buildConversationContext: vi.fn() }))
vi.mock('./usage', () => ({ logAiUsage: vi.fn() }))

import { loadReceptionistAgent } from './config'
import { generateReply } from './generate'
import { buildConversationContext } from './context'
import { AiError } from './types'
import { buildRadarSystemPrompt, parseRadarSignals, runRadarScan } from './radar'

// ---------------------------------------------------------------
// Tiny in-memory stand-in for the Supabase query builder: just the
// calls radar.ts makes (select/eq/in/is/not/gte/lte/order/limit,
// insert/update/upsert, maybeSingle/single, head counts). Embeds such
// as `contact:contacts(...)` are stored directly on the fixture row.
// ---------------------------------------------------------------
type Row = Record<string, unknown>

class Query {
  private filters: ((r: Row) => boolean)[] = []
  private mode: 'select' | 'insert' | 'update' | 'upsert' = 'select'
  private payload: Row | null = null
  private orderBy: { col: string; asc: boolean } | null = null
  private max = Infinity
  private head = false
  private wantCount = false
  private returning = false
  private upsertKey: string | null = null

  constructor(
    private tables: Record<string, Row[]>,
    private name: string,
  ) {
    if (!tables[name]) tables[name] = []
  }

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (this.mode === 'select') {
      this.head = Boolean(opts?.head)
      this.wantCount = opts?.count === 'exact'
    } else {
      this.returning = true
    }
    return this
  }
  insert(row: Row) {
    this.mode = 'insert'
    this.payload = row
    return this
  }
  update(patch: Row) {
    this.mode = 'update'
    this.payload = patch
    return this
  }
  upsert(row: Row, opts: { onConflict: string }) {
    this.mode = 'upsert'
    this.payload = row
    this.upsertKey = opts.onConflict
    return this
  }
  eq(col: string, v: unknown) {
    this.filters.push((r) => r[col] === v)
    return this
  }
  in(col: string, vs: unknown[]) {
    this.filters.push((r) => vs.includes(r[col]))
    return this
  }
  is(col: string, v: null) {
    this.filters.push((r) => (r[col] ?? null) === v)
    return this
  }
  not(col: string, _op: string, v: null) {
    this.filters.push((r) => (r[col] ?? null) !== v)
    return this
  }
  gte(col: string, v: string) {
    this.filters.push((r) => String(r[col]) >= v)
    return this
  }
  lte(col: string, v: string) {
    this.filters.push((r) => String(r[col]) <= v)
    return this
  }
  order(col: string, o: { ascending: boolean }) {
    this.orderBy = { col, asc: o.ascending }
    return this
  }
  limit(n: number) {
    this.max = n
    return this
  }

  private run(): { data: unknown; error: { code?: string; message: string } | null; count?: number } {
    const table = this.tables[this.name]
    const match = () => table.filter((r) => this.filters.every((f) => f(r)))

    if (this.mode === 'insert') {
      const row: Row = { id: `${this.name}-${table.length + 1}`, ...this.payload! }
      if (this.name === 'copilot_insights') {
        const dup = table.some(
          (r) =>
            r.conversation_id === row.conversation_id && r.kind === row.kind && (r.resolved_at ?? null) === null,
        )
        if (dup) return { data: null, error: { code: '23505', message: 'duplicate' } }
      }
      table.push(row)
      return { data: row, error: null }
    }
    if (this.mode === 'update') {
      const rows = match()
      rows.forEach((r) => Object.assign(r, this.payload))
      return { data: rows, error: null }
    }
    if (this.mode === 'upsert') {
      const key = this.upsertKey!
      const existing = table.find((r) => r[key] === this.payload![key])
      if (existing) Object.assign(existing, this.payload)
      else table.push({ ...this.payload! })
      return { data: null, error: null }
    }

    let rows = match()
    if (this.orderBy) {
      const { col, asc } = this.orderBy
      rows = [...rows].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1))
    }
    const count = rows.length
    rows = rows.slice(0, this.max)
    return { data: this.head ? null : rows, error: null, count: this.wantCount ? count : undefined }
  }

  maybeSingle() {
    const r = this.run()
    const data = Array.isArray(r.data) ? (r.data[0] ?? null) : r.data
    return Promise.resolve({ ...r, data })
  }
  single() {
    return this.maybeSingle()
  }
  then<T>(resolve: (v: ReturnType<Query['run']>) => T) {
    return Promise.resolve(this.run()).then(resolve)
  }
}

function fakeDb(tables: Record<string, Row[]>) {
  return { from: (name: string) => new Query(tables, name) } as never
}

// ---------------------------------------------------------------
const ACCOUNT = 'acc-1'
const NOW = new Date('2026-10-28T12:00:00Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString()

function conv(id: string, lastHoursAgo: number, contact: Row, extra: Row = {}): Row {
  return {
    id,
    account_id: ACCOUNT,
    status: 'open',
    last_message_at: hoursAgo(lastHoursAgo),
    contact,
    ...extra,
  }
}
const person = (name: string) => ({ id: `c-${name}`, name, phone: '5511999990000', is_group: false })
const msg = (conversation_id: string, sender_type: string, h: number, content_type = 'text'): Row => ({
  conversation_id,
  sender_type,
  content_type,
  created_at: hoursAgo(h),
})

function baseTables(): Record<string, Row[]> {
  return {
    conversations: [
      conv('waiting', 5, person('Ana')),
      conv('answered', 5, person('Bia')),
      conv('group', 5, { id: 'g', name: 'Grupo', phone: '1', is_group: true }),
      conv('fresh', 1, person('Caio')),
      conv('closed', 5, person('Davi'), { status: 'closed' }),
    ],
    messages: [
      msg('waiting', 'customer', 5),
      msg('answered', 'agent', 5),
      msg('group', 'customer', 5),
      msg('fresh', 'customer', 1),
      msg('closed', 'customer', 5),
    ],
    copilot_insights: [],
    copilot_radar_state: [],
    copilot_scan_runs: [],
  }
}

beforeEach(() => {
  vi.mocked(loadReceptionistAgent).mockReset().mockResolvedValue(null)
  vi.mocked(generateReply).mockReset()
  vi.mocked(buildConversationContext).mockReset().mockResolvedValue([])
})

describe('parseRadarSignals', () => {
  it('parses plain JSON and coerces booleans', () => {
    const s = parseRadarSignals(
      '{"dissatisfied": true, "opportunity": "true", "cooling": false, "summary": " Reclamou ", "suggested_action": "Ligar"}',
    )
    expect(s).toEqual({
      dissatisfied: true,
      opportunity: true,
      cooling: false,
      summary: 'Reclamou',
      suggestedAction: 'Ligar',
    })
  })

  it('accepts a fenced block and surrounding text', () => {
    const s = parseRadarSignals('Aqui vai:\n```json\n{"opportunity": true, "summary": "x"}\n```')
    expect(s?.opportunity).toBe(true)
    expect(s?.dissatisfied).toBe(false)
  })

  it('returns null for unusable replies', () => {
    expect(parseRadarSignals('não sei')).toBeNull()
    expect(parseRadarSignals('{quebrado')).toBeNull()
  })
})

describe('buildRadarSystemPrompt', () => {
  it('adds the timing context only when known', () => {
    expect(buildRadarSystemPrompt({ lastFrom: null, hoursAgo: null })).not.toContain('Contexto de tempo')
    const p = buildRadarSystemPrompt({ lastFrom: 'customer', hoursAgo: 5 })
    expect(p).toContain('do cliente')
    expect(p).toContain('5 hora')
  })
})

describe('runRadarScan: bottlenecks (no AI)', () => {
  it('flags only open, non-group threads whose last message is the customer, 2h+ old', async () => {
    const t = baseTables()
    const res = await runRadarScan(fakeDb(t), ACCOUNT, { now: NOW })

    expect(res.bottlenecks).toBe(1)
    expect(res.created).toBe(1)
    const rows = t.copilot_insights
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      conversation_id: 'waiting',
      kind: 'bottleneck',
      severity: 'warn',
      title: 'Sem resposta há 5h',
    })
    expect(res.aiStatus).toBe('skipped')
    expect(t.copilot_scan_runs).toHaveLength(1)
  })

  it('goes critical after 24h and reads in days', async () => {
    const t = baseTables()
    t.messages = [msg('waiting', 'customer', 50)]
    t.conversations = [conv('waiting', 50, person('Ana'))]
    await runRadarScan(fakeDb(t), ACCOUNT, { now: NOW })
    expect(t.copilot_insights[0]).toMatchObject({ severity: 'critical', title: 'Cliente aguardando há 2 dias' })
  })

  it('refreshes the open insight instead of duplicating it', async () => {
    const t = baseTables()
    await runRadarScan(fakeDb(t), ACCOUNT, { now: NOW })
    const later = new Date(NOW.getTime() + 3 * 3_600_000)
    await runRadarScan(fakeDb(t), ACCOUNT, { now: later })
    // 3h later the "fresh" thread (Caio) also crossed 2h, so it gets its own
    // alert; the one for "waiting" is refreshed, not duplicated.
    const forWaiting = t.copilot_insights.filter((r) => r.conversation_id === 'waiting')
    expect(forWaiting).toHaveLength(1)
    expect(forWaiting[0].title).toBe('Sem resposta há 8h')
    expect(t.copilot_insights).toHaveLength(2)
  })

  it('closes the insight when the team answered', async () => {
    const t = baseTables()
    await runRadarScan(fakeDb(t), ACCOUNT, { now: NOW })
    t.messages.push(msg('waiting', 'agent', 0.5))
    const res = await runRadarScan(fakeDb(t), ACCOUNT, { now: NOW })
    expect(res.resolved).toBe(1)
    expect(t.copilot_insights[0].resolved_at).toBeTruthy()
    expect(t.copilot_insights[0].resolved_by ?? null).toBeNull()
  })

  it('does not bring back an alert a person resolved after the customer wrote', async () => {
    const t = baseTables()
    t.copilot_insights.push({
      id: 'old',
      account_id: ACCOUNT,
      conversation_id: 'waiting',
      kind: 'bottleneck',
      resolved_at: hoursAgo(1),
      resolved_by: 'user-1',
    })
    const res = await runRadarScan(fakeDb(t), ACCOUNT, { now: NOW })
    expect(res.created).toBe(0)
    expect(t.copilot_insights).toHaveLength(1)
  })

  it('raises it again if the customer wrote after the person resolved it', async () => {
    const t = baseTables()
    t.copilot_insights.push({
      id: 'old',
      account_id: ACCOUNT,
      conversation_id: 'waiting',
      kind: 'bottleneck',
      resolved_at: hoursAgo(10),
      resolved_by: 'user-1',
    })
    const res = await runRadarScan(fakeDb(t), ACCOUNT, { now: NOW })
    expect(res.created).toBe(1)
  })
})

describe('runRadarScan: AI reading', () => {
  const config = { id: 'agent-1', provider: 'openai', model: 'm', apiKey: 'k' } as never

  const aiTables = () => {
    const t = baseTables()
    t.messages.push(
      msg('waiting', 'agent', 6),
      msg('waiting', 'customer', 7),
      msg('waiting', 'agent', 8),
    )
    return t
  }
  const chat = [
    { role: 'user', content: 'a' },
    { role: 'assistant', content: 'b' },
    { role: 'user', content: 'c' },
  ] as never

  it('creates quality and opportunity insights from the signals', async () => {
    vi.mocked(loadReceptionistAgent).mockResolvedValue(config)
    vi.mocked(buildConversationContext).mockResolvedValue(chat)
    vi.mocked(generateReply).mockResolvedValue({
      text: '{"dissatisfied": true, "opportunity": true, "cooling": false, "summary": "Reclamou do prazo.", "suggested_action": "Ligar hoje."}',
      usage: null,
    } as never)

    const t = aiTables()
    const res = await runRadarScan(fakeDb(t), ACCOUNT, { now: NOW })

    expect(res.aiStatus).toBe('ok')
    expect(res.analyzed).toBeGreaterThan(0)
    const kinds = t.copilot_insights.filter((r) => r.conversation_id === 'waiting').map((r) => r.kind)
    expect(kinds).toEqual(expect.arrayContaining(['bottleneck', 'quality', 'opportunity']))
    const quality = t.copilot_insights.find((r) => r.kind === 'quality' && r.conversation_id === 'waiting')!
    expect(quality.severity).toBe('critical')
    expect(String(quality.description)).toContain('Ana')
    expect(String(quality.description)).toContain('Ligar hoje.')
  })

  it('uses "lead esfriando" when only cooling is set', async () => {
    vi.mocked(loadReceptionistAgent).mockResolvedValue(config)
    vi.mocked(buildConversationContext).mockResolvedValue(chat)
    vi.mocked(generateReply).mockResolvedValue({
      text: '{"dissatisfied": false, "opportunity": false, "cooling": true, "summary": "", "suggested_action": ""}',
      usage: null,
    } as never)
    const t = aiTables()
    await runRadarScan(fakeDb(t), ACCOUNT, { now: NOW })
    const opp = t.copilot_insights.find((r) => r.kind === 'opportunity')!
    expect(opp).toMatchObject({ severity: 'info', title: 'Lead esfriando' })
  })

  it('skips conversations that did not move since the last reading', async () => {
    vi.mocked(loadReceptionistAgent).mockResolvedValue(config)
    vi.mocked(buildConversationContext).mockResolvedValue(chat)
    vi.mocked(generateReply).mockResolvedValue({
      text: '{"dissatisfied": false, "opportunity": false, "cooling": false}',
      usage: null,
    } as never)
    const t = aiTables()
    await runRadarScan(fakeDb(t), ACCOUNT, { now: NOW })
    const callsAfterFirst = vi.mocked(generateReply).mock.calls.length
    expect(callsAfterFirst).toBeGreaterThan(0)

    await runRadarScan(fakeDb(t), ACCOUNT, { now: NOW })
    expect(vi.mocked(generateReply).mock.calls.length).toBe(callsAfterFirst)
  })

  it('does not call the AI for threads with too few messages', async () => {
    vi.mocked(loadReceptionistAgent).mockResolvedValue(config)
    vi.mocked(buildConversationContext).mockResolvedValue([{ role: 'user', content: 'oi' }] as never)
    await runRadarScan(fakeDb(aiTables()), ACCOUNT, { now: NOW })
    expect(generateReply).not.toHaveBeenCalled()
  })

  it('reports a provider failure but keeps the bottlenecks', async () => {
    vi.mocked(loadReceptionistAgent).mockResolvedValue(config)
    vi.mocked(buildConversationContext).mockResolvedValue(chat)
    vi.mocked(generateReply).mockRejectedValue(new AiError('chave inválida', { code: 'auth', status: 401 }))
    const t = aiTables()
    const res = await runRadarScan(fakeDb(t), ACCOUNT, { now: NOW })
    expect(res.aiStatus).toBe('error')
    expect(res.aiError).toContain('chave inválida')
    expect(t.copilot_insights.some((r) => r.kind === 'bottleneck')).toBe(true)
    expect(t.copilot_scan_runs[0]).toMatchObject({ ai_status: 'error' })
  })
})
